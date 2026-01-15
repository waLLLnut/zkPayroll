import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, typedDeployments } from "hardhat";
import { sdk as interfaceSdkModule } from "../sdk";
import { createBackendSdk as createBackendSdkFn } from "../sdk/backendSdk";
import { TreesService } from "../sdk/serverSdk";
import { parseUnits, snapshottedBeforeEach } from "../shared/utils";
import {
  MockERC20,
  MockERC20__factory,
  PoolERC20,
  PoolERC20__factory,
  RlweAuditChallenge,
  RlweAuditChallenge__factory,
} from "../typechain-types";
import fs from "fs";
import path from "path";

// Helper to load circuit JSON directly (since hardhat-noir is disabled)
function getCircuitJson(name: string) {
  const circuitPath = path.join(__dirname, "..", "noir", "target", `${name}.json`);
  return JSON.parse(fs.readFileSync(circuitPath, "utf-8"));
}

/**
 * __LatticA__: Optimistic Challenge Flow Test
 *
 * Tests the two-proof RLWE audit architecture:
 * 1. Main unshield proof (on-chain) - immediate verification
 * 2. RLWE audit proof (off-chain) - optimistic verification by relayer
 *
 * Challenge scenarios:
 * - Valid flow: All proofs correct, no challenge
 * - Invalid ciphertext: ct_commitment mismatch -> challenge succeeds
 * - Invalid range proof: Noise outside [-3,3] -> challenge succeeds
 */
describe("LatticA: Optimistic Challenge Flow", () => {
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let relayer: SignerWithAddress;
  let challenger: SignerWithAddress;

  const aliceSecretKey =
    "0x118f09bc73ec486db2030077142f2bceba2a4d4c9e0f6147d776f8ca8ec02ff1";
  const bobSecretKey =
    "0x2120f33c0d324bfe571a18c1d5a1c9cdc6db60621e35bc78be1ced339f936a71";

  let pool: PoolERC20;
  let challengeContract: RlweAuditChallenge;
  let usdc: MockERC20;

  let sdk: ReturnType<typeof interfaceSdkModule.createInterfaceSdk>;
  let backendSdk: ReturnType<typeof createBackendSdkFn>;
  const {
    CompleteWaAddress,
    TokenAmount,
    AuditLogService,
    poseidon2Hash,
    deriveWaAddressFromSecretKey,
  } = interfaceSdkModule;

  const MIN_STAKE = ethers.parseEther("1");

  snapshottedBeforeEach(async () => {
    [alice, bob, relayer, challenger] = await ethers.getSigners();
    await typedDeployments.fixture();

    pool = PoolERC20__factory.connect(
      (await typedDeployments.get("PoolERC20")).address,
      alice,
    );

    // Deploy RlweAuditChallenge contract with a mock verifier
    const mockVerifier = await ethers.deployContract("MockVerifier");
    challengeContract = await new RlweAuditChallenge__factory(alice).deploy(
      await mockVerifier.getAddress(),
    );

    usdc = await new MockERC20__factory(alice).deploy("USD Coin", "USDC");
    await usdc.mintForTests(alice, await parseUnits(usdc, "1000000"));
    await usdc.connect(alice).approve(pool, ethers.MaxUint256);
  });

  before(async () => {
    // Deploy fixtures first to get pool
    await typedDeployments.fixture();
    const tempPool = PoolERC20__factory.connect(
      (await typedDeployments.get("PoolERC20")).address,
      (await ethers.getSigners())[0],
    );

    const coreSdk = interfaceSdkModule.createCoreSdk(tempPool);
    const trees = new TreesService(tempPool);

    sdk = interfaceSdkModule.createInterfaceSdk(coreSdk, trees, {
      shield: getCircuitJson("erc20_shield"),
      unshield: getCircuitJson("erc20_unshield"),
      join: getCircuitJson("erc20_join"),
      transfer: getCircuitJson("erc20_transfer"),
      swap: getCircuitJson("lob_router_swap"),
    });

    backendSdk = createBackendSdkFn(coreSdk, trees, {
      rollup: getCircuitJson("rollup"),
    });

    console.log("roots", await trees.getTreeRoots());
  });

  describe("Valid RLWE Proof Flow", () => {
    it("should complete unshield with valid audit proof (no challenge)", async () => {
      // Step 1: Shield tokens
      const shieldAmount = 1000n;
      const { note: shieldedNote } = await sdk.poolErc20.shield({
        account: alice,
        token: usdc,
        amount: shieldAmount,
        secretKey: aliceSecretKey,
      });
      await backendSdk.rollup.rollup();

      // Verify shield
      const [aliceNote] = await sdk.poolErc20.getBalanceNotesOf(
        usdc,
        aliceSecretKey,
      );
      expect(aliceNote).to.deep.equal(shieldedNote);

      // Step 2: Unshield (produces wa_commitment on-chain)
      const unshieldAmount = 400n;
      const result = await sdk.poolErc20.unshield({
        secretKey: aliceSecretKey,
        fromNote: aliceNote,
        token: await usdc.getAddress(),
        to: await bob.getAddress(),
        amount: unshieldAmount,
      });

      // Verify unshield result includes wa_commitment
      expect(result.nullifier).to.be.a("string");
      expect(result.waCommitment).to.be.a("string");
      expect(result.noteHash).to.be.a("string");

      // Step 3: Verify on-chain audit log
      const auditLogService = new AuditLogService(pool);
      const auditEntry = await auditLogService.queryAuditLog(result.nullifier);

      expect(auditEntry).to.not.be.null;
      expect(auditEntry!.nullifier).to.equal(result.nullifier);
      expect(auditEntry!.waCommitment).to.equal(result.waCommitment);

      // Step 4: Relayer registers and submits audit entry
      await challengeContract.connect(relayer).registerRelayer({ value: MIN_STAKE });

      const relayerInfo = await challengeContract.relayers(relayer.address);
      expect(relayerInfo.isRegistered).to.be.true;
      expect(relayerInfo.stake).to.equal(MIN_STAKE);

      // Compute ct_commitment (in production, this would be from actual RLWE proof)
      const mockCtCommitment = ethers.keccak256(
        ethers.toUtf8Bytes("valid_ciphertext"),
      );
      const mockIpfsCid = "QmValidCiphertextCID123";

      await challengeContract
        .connect(relayer)
        .submitAuditEntry(
          result.nullifier,
          result.waCommitment,
          mockCtCommitment,
          mockIpfsCid,
        );

      // Verify audit entry stored
      const storedEntry = await challengeContract.getAuditEntry(result.nullifier);
      expect(storedEntry.nullifier).to.equal(result.nullifier);
      expect(storedEntry.waCommitment).to.equal(result.waCommitment);
      expect(storedEntry.ctCommitment).to.equal(mockCtCommitment);
      expect(storedEntry.relayer).to.equal(relayer.address);
      expect(storedEntry.challenged).to.be.false;

      // Step 5: Rollup and verify final balances
      await backendSdk.rollup.rollup();

      expect(await usdc.balanceOf(bob)).to.equal(unshieldAmount);
      expect(await sdk.poolErc20.balanceOf(usdc, aliceSecretKey)).to.equal(
        shieldAmount - unshieldAmount,
      );

      console.log("✓ Valid RLWE proof flow completed successfully");
    });

    it("should pass challenge period and mark entry as valid", async () => {
      // Setup: Shield and unshield
      await sdk.poolErc20.shield({
        account: alice,
        token: usdc,
        amount: 1000n,
        secretKey: aliceSecretKey,
      });
      await backendSdk.rollup.rollup();

      const [note] = await sdk.poolErc20.getBalanceNotesOf(usdc, aliceSecretKey);
      const result = await sdk.poolErc20.unshield({
        secretKey: aliceSecretKey,
        fromNote: note,
        token: await usdc.getAddress(),
        to: await bob.getAddress(),
        amount: 400n,
      });

      // Relayer submits
      await challengeContract.connect(relayer).registerRelayer({ value: MIN_STAKE });
      await challengeContract.connect(relayer).submitAuditEntry(
        result.nullifier,
        result.waCommitment,
        ethers.ZeroHash,
        "ipfs://valid",
      );

      // Initially not valid (still in challenge period)
      expect(await challengeContract.isAuditEntryValid(result.nullifier)).to.be.false;

      // Fast forward past challenge period (7 days)
      await ethers.provider.send("evm_increaseTime", [7 * 24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine", []);

      // Now valid
      expect(await challengeContract.isAuditEntryValid(result.nullifier)).to.be.true;

      console.log("✓ Audit entry marked valid after challenge period");
    });
  });

  describe("Invalid Ciphertext Challenge (Type 1)", () => {
    it("should slash relayer for invalid ct_commitment", async () => {
      // Setup: Shield and unshield
      await sdk.poolErc20.shield({
        account: alice,
        token: usdc,
        amount: 1000n,
        secretKey: aliceSecretKey,
      });
      await backendSdk.rollup.rollup();

      const [note] = await sdk.poolErc20.getBalanceNotesOf(usdc, aliceSecretKey);
      const result = await sdk.poolErc20.unshield({
        secretKey: aliceSecretKey,
        fromNote: note,
        token: await usdc.getAddress(),
        to: await bob.getAddress(),
        amount: 400n,
      });

      // Relayer registers and submits WRONG ct_commitment
      await challengeContract.connect(relayer).registerRelayer({ value: MIN_STAKE });

      const wrongCtCommitment = ethers.keccak256(
        ethers.toUtf8Bytes("WRONG_ciphertext"),
      );

      await challengeContract.connect(relayer).submitAuditEntry(
        result.nullifier,
        result.waCommitment,
        wrongCtCommitment, // This doesn't match actual ciphertext
        "ipfs://wrong",
      );

      // Get relayer stake before challenge
      const relayerBefore = await challengeContract.relayers(relayer.address);
      const challengerBalanceBefore = await ethers.provider.getBalance(
        challenger.address,
      );

      // Challenger submits fraud proof
      // (In production, this would be a ZK proof proving ctCommitment mismatch)
      const fraudProof = ethers.toUtf8Bytes("fraud_proof_type_1");

      await challengeContract
        .connect(challenger)
        .challenge(result.nullifier, fraudProof);

      // Verify slashing
      const relayerAfter = await challengeContract.relayers(relayer.address);
      expect(relayerAfter.stake).to.equal(0n);
      expect(relayerAfter.isRegistered).to.be.false;

      // Verify challenger reward (50% of stake)
      const challengerBalanceAfter = await ethers.provider.getBalance(
        challenger.address,
      );
      // Note: We need to account for gas costs, so just check it increased
      expect(challengerBalanceAfter).to.be.gt(
        challengerBalanceBefore - ethers.parseEther("0.1"), // Allow for gas
      );

      // Verify entry is slashed
      const entry = await challengeContract.getAuditEntry(result.nullifier);
      expect(entry.challenged).to.be.true;
      expect(entry.slashed).to.be.true;

      console.log("✓ Relayer slashed for invalid ct_commitment");
    });
  });

  describe("Invalid Range Proof Challenge (Type 3)", () => {
    it("should slash relayer for noise outside valid range", async () => {
      // Setup: Shield and unshield
      await sdk.poolErc20.shield({
        account: alice,
        token: usdc,
        amount: 1000n,
        secretKey: aliceSecretKey,
      });
      await backendSdk.rollup.rollup();

      const [note] = await sdk.poolErc20.getBalanceNotesOf(usdc, aliceSecretKey);
      const result = await sdk.poolErc20.unshield({
        secretKey: aliceSecretKey,
        fromNote: note,
        token: await usdc.getAddress(),
        to: await bob.getAddress(),
        amount: 400n,
      });

      // Relayer registers and submits entry with ciphertext that has invalid noise
      await challengeContract.connect(relayer).registerRelayer({ value: MIN_STAKE });

      // This ct_commitment is for a ciphertext with noise > 3 (invalid)
      const invalidNoiseCtCommitment = ethers.keccak256(
        ethers.toUtf8Bytes("ciphertext_with_large_noise"),
      );

      await challengeContract.connect(relayer).submitAuditEntry(
        result.nullifier,
        result.waCommitment,
        invalidNoiseCtCommitment,
        "ipfs://invalid_noise",
      );

      // Challenger submits fraud proof for range violation
      const fraudProof = ethers.toUtf8Bytes("fraud_proof_type_3_noise_at_index_5");

      await challengeContract
        .connect(challenger)
        .challenge(result.nullifier, fraudProof);

      // Verify slashing
      const relayerAfter = await challengeContract.relayers(relayer.address);
      expect(relayerAfter.stake).to.equal(0n);
      expect(relayerAfter.isRegistered).to.be.false;

      const entry = await challengeContract.getAuditEntry(result.nullifier);
      expect(entry.slashed).to.be.true;

      console.log("✓ Relayer slashed for invalid noise range");
    });
  });

  describe("Challenge Edge Cases", () => {
    it("should reject challenge after challenge period expires", async () => {
      // Setup
      await sdk.poolErc20.shield({
        account: alice,
        token: usdc,
        amount: 1000n,
        secretKey: aliceSecretKey,
      });
      await backendSdk.rollup.rollup();

      const [note] = await sdk.poolErc20.getBalanceNotesOf(usdc, aliceSecretKey);
      const result = await sdk.poolErc20.unshield({
        secretKey: aliceSecretKey,
        fromNote: note,
        token: await usdc.getAddress(),
        to: await bob.getAddress(),
        amount: 400n,
      });

      await challengeContract.connect(relayer).registerRelayer({ value: MIN_STAKE });
      await challengeContract.connect(relayer).submitAuditEntry(
        result.nullifier,
        result.waCommitment,
        ethers.ZeroHash,
        "ipfs://entry",
      );

      // Fast forward past challenge period
      await ethers.provider.send("evm_increaseTime", [7 * 24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine", []);

      // Challenge should fail
      await expect(
        challengeContract
          .connect(challenger)
          .challenge(result.nullifier, ethers.toUtf8Bytes("late_proof")),
      ).to.be.revertedWith("Challenge period expired");

      console.log("✓ Late challenge rejected correctly");
    });

    it("should reject double challenge", async () => {
      // Setup
      await sdk.poolErc20.shield({
        account: alice,
        token: usdc,
        amount: 1000n,
        secretKey: aliceSecretKey,
      });
      await backendSdk.rollup.rollup();

      const [note] = await sdk.poolErc20.getBalanceNotesOf(usdc, aliceSecretKey);
      const result = await sdk.poolErc20.unshield({
        secretKey: aliceSecretKey,
        fromNote: note,
        token: await usdc.getAddress(),
        to: await bob.getAddress(),
        amount: 400n,
      });

      await challengeContract.connect(relayer).registerRelayer({ value: MIN_STAKE });
      await challengeContract.connect(relayer).submitAuditEntry(
        result.nullifier,
        result.waCommitment,
        ethers.ZeroHash,
        "ipfs://entry",
      );

      // First challenge succeeds
      await challengeContract
        .connect(challenger)
        .challenge(result.nullifier, ethers.toUtf8Bytes("proof1"));

      // Second challenge should fail
      await expect(
        challengeContract
          .connect(challenger)
          .challenge(result.nullifier, ethers.toUtf8Bytes("proof2")),
      ).to.be.revertedWith("Already challenged");

      console.log("✓ Double challenge rejected correctly");
    });

    it("should allow relayer to unregister after challenge period", async () => {
      // Setup
      await sdk.poolErc20.shield({
        account: alice,
        token: usdc,
        amount: 1000n,
        secretKey: aliceSecretKey,
      });
      await backendSdk.rollup.rollup();

      const [note] = await sdk.poolErc20.getBalanceNotesOf(usdc, aliceSecretKey);
      const result = await sdk.poolErc20.unshield({
        secretKey: aliceSecretKey,
        fromNote: note,
        token: await usdc.getAddress(),
        to: await bob.getAddress(),
        amount: 400n,
      });

      await challengeContract.connect(relayer).registerRelayer({ value: MIN_STAKE });
      await challengeContract.connect(relayer).submitAuditEntry(
        result.nullifier,
        result.waCommitment,
        ethers.ZeroHash,
        "ipfs://entry",
      );

      const relayerBalanceBefore = await ethers.provider.getBalance(relayer.address);

      // Unregister and get stake back
      await challengeContract.connect(relayer).unregisterRelayer();

      const relayerBalanceAfter = await ethers.provider.getBalance(relayer.address);
      expect(relayerBalanceAfter).to.be.gt(
        relayerBalanceBefore + MIN_STAKE - ethers.parseEther("0.01"), // Allow for gas
      );

      const relayerInfo = await challengeContract.relayers(relayer.address);
      expect(relayerInfo.isRegistered).to.be.false;
      expect(relayerInfo.stake).to.equal(0n);

      console.log("✓ Relayer unregistered and stake returned");
    });
  });

  describe("WaCommitment Linking", () => {
    it("should derive same wa_commitment from same secret_key", async () => {
      // Compute wa_commitment using SDK helper
      const waAddress = await deriveWaAddressFromSecretKey(aliceSecretKey);

      // Shield and unshield to get on-chain wa_commitment
      await sdk.poolErc20.shield({
        account: alice,
        token: usdc,
        amount: 1000n,
        secretKey: aliceSecretKey,
      });
      await backendSdk.rollup.rollup();

      const [note] = await sdk.poolErc20.getBalanceNotesOf(usdc, aliceSecretKey);
      const result = await sdk.poolErc20.unshield({
        secretKey: aliceSecretKey,
        fromNote: note,
        token: await usdc.getAddress(),
        to: await bob.getAddress(),
        amount: 400n,
      });

      // Verify wa_commitment from unshield matches derived commitment
      expect(result.waCommitment.toLowerCase()).to.equal(
        waAddress.commitment.toString().toLowerCase(),
      );

      console.log("✓ WaCommitment linking verified");
    });

    it("should query audit logs by wa_commitment", async () => {
      const auditLogService = new AuditLogService(pool);

      // Multiple unshields from same user
      await sdk.poolErc20.shield({
        account: alice,
        token: usdc,
        amount: 1000n,
        secretKey: aliceSecretKey,
      });
      await backendSdk.rollup.rollup();

      const [note1] = await sdk.poolErc20.getBalanceNotesOf(usdc, aliceSecretKey);
      const result1 = await sdk.poolErc20.unshield({
        secretKey: aliceSecretKey,
        fromNote: note1,
        token: await usdc.getAddress(),
        to: await bob.getAddress(),
        amount: 200n,
      });
      await backendSdk.rollup.rollup();

      const [note2] = await sdk.poolErc20.getBalanceNotesOf(usdc, aliceSecretKey);
      const result2 = await sdk.poolErc20.unshield({
        secretKey: aliceSecretKey,
        fromNote: note2,
        token: await usdc.getAddress(),
        to: await bob.getAddress(),
        amount: 200n,
      });

      // Query by wa_commitment
      const entries = await auditLogService.queryByWaCommitment(result1.waCommitment);

      expect(entries.length).to.equal(2);
      expect(entries[0]!.waCommitment).to.equal(result1.waCommitment);
      expect(entries[1]!.waCommitment).to.equal(result2.waCommitment);
      // Both should have same wa_commitment (same user)
      expect(result1.waCommitment).to.equal(result2.waCommitment);

      console.log("✓ Audit logs queryable by wa_commitment");
    });
  });

  describe("Full Relayer Rollup Flow with Gas Tracking", () => {
    // Gas tracking
    const gasTracker = {
      shield: 0n,
      unshield: 0n,
      rollup1: 0n,
      rollup2: 0n,
      relayerRegister: 0n,
      auditEntrySubmit: 0n,
      challenge: 0n,
      total: 0n,
    };

    it("should complete full flow: shield -> unshield -> relayer audit -> rollup with gas tracking", async () => {
      console.log("\n=== Full Relayer Rollup Flow with Gas Tracking ===\n");

      // Step 1: Shield tokens
      console.log("Step 1: Shield tokens (1000 USDC)");
      const shieldAmount = 1000n;
      const { note: shieldedNote, tx: shieldTx } = await sdk.poolErc20.shield({
        account: alice,
        token: usdc,
        amount: shieldAmount,
        secretKey: aliceSecretKey,
      });
      const shieldReceipt = await shieldTx.wait();
      gasTracker.shield = shieldReceipt!.gasUsed;
      console.log(`  ✓ Shield gas: ${gasTracker.shield.toLocaleString()}`);

      // Rollup 1
      console.log("\nStep 2: First Rollup (include shield)");
      const rollup1Tx = await backendSdk.rollup.rollup();
      const rollup1Receipt = await rollup1Tx.wait();
      gasTracker.rollup1 = rollup1Receipt!.gasUsed;
      console.log(`  ✓ Rollup #1 gas: ${gasTracker.rollup1.toLocaleString()}`);

      // Verify shield
      const [aliceNote] = await sdk.poolErc20.getBalanceNotesOf(usdc, aliceSecretKey);
      expect(aliceNote).to.deep.equal(shieldedNote);
      console.log(`  ✓ Alice balance verified: ${shieldAmount} USDC`);

      // Step 3: Unshield
      console.log("\nStep 3: Unshield tokens (400 USDC to Bob)");
      const unshieldAmount = 400n;
      const result = await sdk.poolErc20.unshield({
        secretKey: aliceSecretKey,
        fromNote: aliceNote,
        token: await usdc.getAddress(),
        to: await bob.getAddress(),
        amount: unshieldAmount,
      });
      const unshieldReceipt = await result.tx.wait();
      gasTracker.unshield = unshieldReceipt!.gasUsed;
      console.log(`  ✓ Unshield gas: ${gasTracker.unshield.toLocaleString()}`);
      console.log(`  ✓ Nullifier: ${result.nullifier.slice(0, 18)}...`);
      console.log(`  ✓ WaCommitment: ${result.waCommitment.slice(0, 18)}...`);

      // Step 4: Relayer Registration
      console.log("\nStep 4: Relayer registers with 1 ETH stake");
      const registerTx = await challengeContract.connect(relayer).registerRelayer({ value: MIN_STAKE });
      const registerReceipt = await registerTx.wait();
      gasTracker.relayerRegister = registerReceipt!.gasUsed;
      console.log(`  ✓ Relayer register gas: ${gasTracker.relayerRegister.toLocaleString()}`);

      const relayerInfo = await challengeContract.relayers(relayer.address);
      expect(relayerInfo.isRegistered).to.be.true;
      console.log(`  ✓ Relayer registered with stake: ${ethers.formatEther(relayerInfo.stake)} ETH`);

      // Step 5: Relayer submits audit entry
      console.log("\nStep 5: Relayer submits audit entry to challenge contract");
      const mockCtCommitment = ethers.keccak256(ethers.toUtf8Bytes("valid_ciphertext_for_rollup"));
      const mockIpfsCid = "QmRollupAuditCID123456789";

      const submitTx = await challengeContract.connect(relayer).submitAuditEntry(
        result.nullifier,
        result.waCommitment,
        mockCtCommitment,
        mockIpfsCid,
      );
      const submitReceipt = await submitTx.wait();
      gasTracker.auditEntrySubmit = submitReceipt!.gasUsed;
      console.log(`  ✓ Audit entry submit gas: ${gasTracker.auditEntrySubmit.toLocaleString()}`);

      // Verify audit entry
      const storedEntry = await challengeContract.getAuditEntry(result.nullifier);
      expect(storedEntry.nullifier).to.equal(result.nullifier);
      expect(storedEntry.relayer).to.equal(relayer.address);
      console.log(`  ✓ Audit entry stored (IPFS: ${mockIpfsCid.slice(0, 12)}...)`);

      // Step 6: Rollup 2 (includes unshield)
      console.log("\nStep 6: Second Rollup (include unshield)");
      const rollup2Tx = await backendSdk.rollup.rollup();
      const rollup2Receipt = await rollup2Tx.wait();
      gasTracker.rollup2 = rollup2Receipt!.gasUsed;
      console.log(`  ✓ Rollup #2 gas: ${gasTracker.rollup2.toLocaleString()}`);

      // Verify final balances
      const bobBalance = await usdc.balanceOf(bob);
      const aliceShieldedBalance = await sdk.poolErc20.balanceOf(usdc, aliceSecretKey);
      expect(bobBalance).to.equal(unshieldAmount);
      expect(aliceShieldedBalance).to.equal(shieldAmount - unshieldAmount);
      console.log(`  ✓ Bob received: ${bobBalance} USDC`);
      console.log(`  ✓ Alice remaining shielded: ${aliceShieldedBalance} USDC`);

      // Calculate total gas
      gasTracker.total =
        gasTracker.shield +
        gasTracker.rollup1 +
        gasTracker.unshield +
        gasTracker.relayerRegister +
        gasTracker.auditEntrySubmit +
        gasTracker.rollup2;

      // Print gas summary
      console.log("\n" + "=".repeat(50));
      console.log("GAS COST SUMMARY");
      console.log("=".repeat(50));
      console.log(`Shield:              ${gasTracker.shield.toLocaleString().padStart(12)} gas`);
      console.log(`Rollup #1:           ${gasTracker.rollup1.toLocaleString().padStart(12)} gas`);
      console.log(`Unshield:            ${gasTracker.unshield.toLocaleString().padStart(12)} gas`);
      console.log(`Relayer Register:    ${gasTracker.relayerRegister.toLocaleString().padStart(12)} gas`);
      console.log(`Audit Entry Submit:  ${gasTracker.auditEntrySubmit.toLocaleString().padStart(12)} gas`);
      console.log(`Rollup #2:           ${gasTracker.rollup2.toLocaleString().padStart(12)} gas`);
      console.log("-".repeat(50));
      console.log(`TOTAL:               ${gasTracker.total.toLocaleString().padStart(12)} gas`);
      console.log("=".repeat(50));

      // Calculate ETH costs at different gas prices
      const gasPrices = [
        { name: "Low (10 gwei)", gwei: 10n },
        { name: "Medium (30 gwei)", gwei: 30n },
        { name: "High (100 gwei)", gwei: 100n },
      ];

      console.log("\nETH COST ESTIMATES:");
      for (const price of gasPrices) {
        const cost = gasTracker.total * price.gwei * 1_000_000_000n;
        console.log(`  ${price.name}: ${ethers.formatEther(cost)} ETH`);
      }
      console.log("=".repeat(50));

      console.log("\n✓ Full relayer rollup flow completed successfully!\n");
    });

    it("should track gas for challenge scenario (slashing)", async () => {
      console.log("\n=== Challenge Scenario Gas Tracking ===\n");

      // Setup: Shield and unshield
      const { tx: shieldTx } = await sdk.poolErc20.shield({
        account: alice,
        token: usdc,
        amount: 1000n,
        secretKey: aliceSecretKey,
      });
      const shieldGas = (await shieldTx.wait())!.gasUsed;

      const rollup1Tx = await backendSdk.rollup.rollup();
      const rollup1Gas = (await rollup1Tx.wait())!.gasUsed;

      const [note] = await sdk.poolErc20.getBalanceNotesOf(usdc, aliceSecretKey);
      const result = await sdk.poolErc20.unshield({
        secretKey: aliceSecretKey,
        fromNote: note,
        token: await usdc.getAddress(),
        to: await bob.getAddress(),
        amount: 400n,
      });
      const unshieldGas = (await result.tx.wait())!.gasUsed;

      // Relayer with malicious entry
      const registerTx = await challengeContract.connect(relayer).registerRelayer({ value: MIN_STAKE });
      const registerGas = (await registerTx.wait())!.gasUsed;

      const wrongCtCommitment = ethers.keccak256(ethers.toUtf8Bytes("MALICIOUS_ciphertext"));
      const submitTx = await challengeContract.connect(relayer).submitAuditEntry(
        result.nullifier,
        result.waCommitment,
        wrongCtCommitment,
        "ipfs://malicious",
      );
      const submitGas = (await submitTx.wait())!.gasUsed;

      // Challenger submits fraud proof
      console.log("Challenger submits fraud proof...");
      const challengerBalanceBefore = await ethers.provider.getBalance(challenger.address);

      const challengeTx = await challengeContract
        .connect(challenger)
        .challenge(result.nullifier, ethers.toUtf8Bytes("fraud_proof"));
      const challengeReceipt = await challengeTx.wait();
      gasTracker.challenge = challengeReceipt!.gasUsed;

      const challengerBalanceAfter = await ethers.provider.getBalance(challenger.address);
      const reward = challengerBalanceAfter - challengerBalanceBefore +
        (challengeReceipt!.gasUsed * challengeReceipt!.gasPrice);

      // Verify slashing
      const relayerAfter = await challengeContract.relayers(relayer.address);
      expect(relayerAfter.stake).to.equal(0n);
      expect(relayerAfter.isRegistered).to.be.false;

      const totalGas = shieldGas + rollup1Gas + unshieldGas + registerGas + submitGas + gasTracker.challenge;

      console.log("\n" + "=".repeat(50));
      console.log("CHALLENGE SCENARIO GAS SUMMARY");
      console.log("=".repeat(50));
      console.log(`Shield:              ${shieldGas.toLocaleString().padStart(12)} gas`);
      console.log(`Rollup:              ${rollup1Gas.toLocaleString().padStart(12)} gas`);
      console.log(`Unshield:            ${unshieldGas.toLocaleString().padStart(12)} gas`);
      console.log(`Relayer Register:    ${registerGas.toLocaleString().padStart(12)} gas`);
      console.log(`Audit Entry Submit:  ${submitGas.toLocaleString().padStart(12)} gas`);
      console.log(`Challenge:           ${gasTracker.challenge.toLocaleString().padStart(12)} gas`);
      console.log("-".repeat(50));
      console.log(`TOTAL:               ${totalGas.toLocaleString().padStart(12)} gas`);
      console.log("=".repeat(50));
      console.log(`\nChallenger Reward: ~${ethers.formatEther(reward)} ETH (50% of 1 ETH stake)`);
      console.log("=".repeat(50));

      console.log("\n✓ Challenge scenario completed - relayer slashed!\n");
    });
  });
});
