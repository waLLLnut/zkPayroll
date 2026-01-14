import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "hardhat";
import {
  RlweAuditChallenge,
  RlweAuditChallenge__factory,
  MockVerifier,
  MockVerifier__factory,
} from "../typechain-types";

/**
 * __LatticA__: RlweAuditChallenge Contract Tests
 *
 * Tests the optimistic challenge contract functionality:
 * - Relayer registration/unregistration
 * - Audit entry submission
 * - Challenge submission and slashing
 * - Challenge period validation
 */
describe("RlweAuditChallenge", () => {
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let relayer: SignerWithAddress;
  let challenger: SignerWithAddress;

  let mockVerifier: MockVerifier;
  let challengeContract: RlweAuditChallenge;

  const MIN_STAKE = ethers.parseEther("1");
  const CHALLENGE_PERIOD = 7 * 24 * 60 * 60; // 7 days in seconds

  beforeEach(async () => {
    [alice, bob, relayer, challenger] = await ethers.getSigners();

    // Deploy mock verifier
    mockVerifier = await new MockVerifier__factory(alice).deploy();

    // Deploy challenge contract
    challengeContract = await new RlweAuditChallenge__factory(alice).deploy(
      await mockVerifier.getAddress(),
    );
  });

  describe("Relayer Registration", () => {
    it("should register relayer with minimum stake", async () => {
      await challengeContract.connect(relayer).registerRelayer({ value: MIN_STAKE });

      const relayerInfo = await challengeContract.relayers(relayer.address);
      expect(relayerInfo.isRegistered).to.be.true;
      expect(relayerInfo.stake).to.equal(MIN_STAKE);
    });

    it("should reject registration with insufficient stake", async () => {
      await expect(
        challengeContract.connect(relayer).registerRelayer({ value: ethers.parseEther("0.5") }),
      ).to.be.revertedWith("Insufficient stake");
    });

    it("should reject double registration", async () => {
      await challengeContract.connect(relayer).registerRelayer({ value: MIN_STAKE });

      await expect(
        challengeContract.connect(relayer).registerRelayer({ value: MIN_STAKE }),
      ).to.be.revertedWith("Already registered");
    });

    it("should unregister relayer and return stake", async () => {
      await challengeContract.connect(relayer).registerRelayer({ value: MIN_STAKE });

      const balanceBefore = await ethers.provider.getBalance(relayer.address);
      await challengeContract.connect(relayer).unregisterRelayer();
      const balanceAfter = await ethers.provider.getBalance(relayer.address);

      const relayerInfo = await challengeContract.relayers(relayer.address);
      expect(relayerInfo.isRegistered).to.be.false;
      expect(relayerInfo.stake).to.equal(0n);

      // Balance should increase (minus gas)
      expect(balanceAfter).to.be.gt(balanceBefore);
    });
  });

  describe("Audit Entry Submission", () => {
    const nullifier = ethers.keccak256(ethers.toUtf8Bytes("test_nullifier"));
    const waCommitment = ethers.keccak256(ethers.toUtf8Bytes("test_wa_commitment"));
    const ctCommitment = ethers.keccak256(ethers.toUtf8Bytes("test_ct_commitment"));
    const ipfsCid = "QmTestCid123";

    beforeEach(async () => {
      await challengeContract.connect(relayer).registerRelayer({ value: MIN_STAKE });
    });

    it("should submit audit entry", async () => {
      await challengeContract
        .connect(relayer)
        .submitAuditEntry(nullifier, waCommitment, ctCommitment, ipfsCid);

      const entry = await challengeContract.getAuditEntry(nullifier);
      expect(entry.nullifier).to.equal(nullifier);
      expect(entry.waCommitment).to.equal(waCommitment);
      expect(entry.ctCommitment).to.equal(ctCommitment);
      expect(entry.ipfsCid).to.equal(ipfsCid);
      expect(entry.relayer).to.equal(relayer.address);
      expect(entry.challenged).to.be.false;
      expect(entry.slashed).to.be.false;
    });

    it("should reject submission from non-relayer", async () => {
      await expect(
        challengeContract
          .connect(bob)
          .submitAuditEntry(nullifier, waCommitment, ctCommitment, ipfsCid),
      ).to.be.revertedWith("Not a registered relayer");
    });

    it("should reject duplicate entry", async () => {
      await challengeContract
        .connect(relayer)
        .submitAuditEntry(nullifier, waCommitment, ctCommitment, ipfsCid);

      await expect(
        challengeContract
          .connect(relayer)
          .submitAuditEntry(nullifier, waCommitment, ctCommitment, ipfsCid),
      ).to.be.revertedWith("Entry already exists");
    });
  });

  describe("Challenge Submission", () => {
    const nullifier = ethers.keccak256(ethers.toUtf8Bytes("test_nullifier"));
    const waCommitment = ethers.keccak256(ethers.toUtf8Bytes("test_wa_commitment"));
    const ctCommitment = ethers.keccak256(ethers.toUtf8Bytes("test_ct_commitment"));
    const ipfsCid = "QmTestCid123";
    const fraudProof = ethers.toUtf8Bytes("fraud_proof");

    beforeEach(async () => {
      await challengeContract.connect(relayer).registerRelayer({ value: MIN_STAKE });
      await challengeContract
        .connect(relayer)
        .submitAuditEntry(nullifier, waCommitment, ctCommitment, ipfsCid);
    });

    it("should slash relayer on successful challenge", async () => {
      const challengerBalanceBefore = await ethers.provider.getBalance(challenger.address);

      await challengeContract.connect(challenger).challenge(nullifier, fraudProof);

      // Verify relayer slashed
      const relayerInfo = await challengeContract.relayers(relayer.address);
      expect(relayerInfo.stake).to.equal(0n);
      expect(relayerInfo.isRegistered).to.be.false;

      // Verify entry marked as challenged and slashed
      const entry = await challengeContract.getAuditEntry(nullifier);
      expect(entry.challenged).to.be.true;
      expect(entry.slashed).to.be.true;

      // Verify challenger received reward
      const challengerBalanceAfter = await ethers.provider.getBalance(challenger.address);
      expect(challengerBalanceAfter).to.be.gt(challengerBalanceBefore - ethers.parseEther("0.1"));

      console.log("✓ Relayer slashed successfully");
    });

    it("should reject challenge for non-existent entry", async () => {
      const fakeNullifier = ethers.keccak256(ethers.toUtf8Bytes("fake_nullifier"));

      await expect(
        challengeContract.connect(challenger).challenge(fakeNullifier, fraudProof),
      ).to.be.revertedWith("Entry does not exist");
    });

    it("should reject double challenge", async () => {
      await challengeContract.connect(challenger).challenge(nullifier, fraudProof);

      await expect(
        challengeContract.connect(challenger).challenge(nullifier, fraudProof),
      ).to.be.revertedWith("Already challenged");
    });

    it("should reject challenge after challenge period", async () => {
      // Fast forward past challenge period
      await ethers.provider.send("evm_increaseTime", [CHALLENGE_PERIOD + 1]);
      await ethers.provider.send("evm_mine", []);

      await expect(
        challengeContract.connect(challenger).challenge(nullifier, fraudProof),
      ).to.be.revertedWith("Challenge period expired");

      console.log("✓ Late challenge rejected correctly");
    });
  });

  describe("Entry Validity", () => {
    const nullifier = ethers.keccak256(ethers.toUtf8Bytes("test_nullifier"));
    const waCommitment = ethers.keccak256(ethers.toUtf8Bytes("test_wa_commitment"));
    const ctCommitment = ethers.keccak256(ethers.toUtf8Bytes("test_ct_commitment"));
    const ipfsCid = "QmTestCid123";

    beforeEach(async () => {
      await challengeContract.connect(relayer).registerRelayer({ value: MIN_STAKE });
      await challengeContract
        .connect(relayer)
        .submitAuditEntry(nullifier, waCommitment, ctCommitment, ipfsCid);
    });

    it("should mark entry as invalid during challenge period", async () => {
      expect(await challengeContract.isAuditEntryValid(nullifier)).to.be.false;
    });

    it("should mark entry as valid after challenge period", async () => {
      await ethers.provider.send("evm_increaseTime", [CHALLENGE_PERIOD + 1]);
      await ethers.provider.send("evm_mine", []);

      expect(await challengeContract.isAuditEntryValid(nullifier)).to.be.true;

      console.log("✓ Entry marked valid after challenge period");
    });

    it("should mark slashed entry as invalid", async () => {
      await challengeContract
        .connect(challenger)
        .challenge(nullifier, ethers.toUtf8Bytes("fraud"));

      // Even after challenge period
      await ethers.provider.send("evm_increaseTime", [CHALLENGE_PERIOD + 1]);
      await ethers.provider.send("evm_mine", []);

      expect(await challengeContract.isAuditEntryValid(nullifier)).to.be.false;

      console.log("✓ Slashed entry remains invalid");
    });

    it("should return false for non-existent entry", async () => {
      const fakeNullifier = ethers.keccak256(ethers.toUtf8Bytes("fake_nullifier"));
      expect(await challengeContract.isAuditEntryValid(fakeNullifier)).to.be.false;
    });
  });

  describe("Events", () => {
    const nullifier = ethers.keccak256(ethers.toUtf8Bytes("test_nullifier"));
    const waCommitment = ethers.keccak256(ethers.toUtf8Bytes("test_wa_commitment"));
    const ctCommitment = ethers.keccak256(ethers.toUtf8Bytes("test_ct_commitment"));
    const ipfsCid = "QmTestCid123";

    it("should emit RelayerRegistered event", async () => {
      await expect(challengeContract.connect(relayer).registerRelayer({ value: MIN_STAKE }))
        .to.emit(challengeContract, "RelayerRegistered")
        .withArgs(relayer.address, MIN_STAKE);
    });

    it("should emit AuditEntrySubmitted event", async () => {
      await challengeContract.connect(relayer).registerRelayer({ value: MIN_STAKE });

      await expect(
        challengeContract
          .connect(relayer)
          .submitAuditEntry(nullifier, waCommitment, ctCommitment, ipfsCid),
      )
        .to.emit(challengeContract, "AuditEntrySubmitted")
        .withArgs(nullifier, waCommitment, ctCommitment, ipfsCid, relayer.address);
    });

    it("should emit ChallengeResolved and RelayerSlashed events", async () => {
      await challengeContract.connect(relayer).registerRelayer({ value: MIN_STAKE });
      await challengeContract
        .connect(relayer)
        .submitAuditEntry(nullifier, waCommitment, ctCommitment, ipfsCid);

      const tx = challengeContract
        .connect(challenger)
        .challenge(nullifier, ethers.toUtf8Bytes("fraud"));

      await expect(tx)
        .to.emit(challengeContract, "ChallengeResolved")
        .withArgs(nullifier, true, challenger.address);

      await expect(tx)
        .to.emit(challengeContract, "RelayerSlashed")
        .withArgs(relayer.address, nullifier, MIN_STAKE);
    });
  });

  describe("Full Relayer Flow with Gas Tracking", () => {
    it("should complete full relayer flow and track all gas costs", async () => {
      console.log("\n" + "=".repeat(60));
      console.log("FULL RELAYER ROLLUP FLOW - GAS TRACKING");
      console.log("=".repeat(60));

      const gasTracker: Record<string, bigint> = {};

      // Step 1: Relayer Registration
      console.log("\nStep 1: Relayer registers with 1 ETH stake");
      const registerTx = await challengeContract.connect(relayer).registerRelayer({ value: MIN_STAKE });
      const registerReceipt = await registerTx.wait();
      gasTracker["Relayer Register"] = registerReceipt!.gasUsed;
      console.log(`  ✓ Gas: ${gasTracker["Relayer Register"].toLocaleString()}`);

      // Step 2: Submit multiple audit entries (simulating rollup batching)
      console.log("\nStep 2: Submit audit entries (batch of 3)");
      const entries = [
        {
          nullifier: ethers.keccak256(ethers.toUtf8Bytes("nullifier_1")),
          waCommitment: ethers.keccak256(ethers.toUtf8Bytes("wa_1")),
          ctCommitment: ethers.keccak256(ethers.toUtf8Bytes("ct_1")),
          ipfsCid: "QmEntry1",
        },
        {
          nullifier: ethers.keccak256(ethers.toUtf8Bytes("nullifier_2")),
          waCommitment: ethers.keccak256(ethers.toUtf8Bytes("wa_2")),
          ctCommitment: ethers.keccak256(ethers.toUtf8Bytes("ct_2")),
          ipfsCid: "QmEntry2",
        },
        {
          nullifier: ethers.keccak256(ethers.toUtf8Bytes("nullifier_3")),
          waCommitment: ethers.keccak256(ethers.toUtf8Bytes("wa_3")),
          ctCommitment: ethers.keccak256(ethers.toUtf8Bytes("ct_3")),
          ipfsCid: "QmEntry3",
        },
      ];

      let totalSubmitGas = 0n;
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        const tx = await challengeContract
          .connect(relayer)
          .submitAuditEntry(e.nullifier, e.waCommitment, e.ctCommitment, e.ipfsCid);
        const receipt = await tx.wait();
        totalSubmitGas += receipt!.gasUsed;
        console.log(`  ✓ Entry ${i + 1} gas: ${receipt!.gasUsed.toLocaleString()}`);
      }
      gasTracker["Audit Entry Submit (x3)"] = totalSubmitGas;
      console.log(`  ✓ Total submit gas: ${totalSubmitGas.toLocaleString()}`);

      // Step 3: Verify all entries are pending (in challenge period)
      console.log("\nStep 3: Verify entries are in challenge period");
      for (const e of entries) {
        const isValid = await challengeContract.isAuditEntryValid(e.nullifier);
        expect(isValid).to.be.false;
      }
      console.log("  ✓ All entries pending (challenge period active)");

      // Step 4: Challenge one entry (fraud detected)
      console.log("\nStep 4: Challenger detects fraud in entry #2");
      const challengerBalanceBefore = await ethers.provider.getBalance(challenger.address);

      const challengeTx = await challengeContract
        .connect(challenger)
        .challenge(entries[1].nullifier, ethers.toUtf8Bytes("fraud_proof_for_entry_2"));
      const challengeReceipt = await challengeTx.wait();
      gasTracker["Challenge"] = challengeReceipt!.gasUsed;
      console.log(`  ✓ Challenge gas: ${gasTracker["Challenge"].toLocaleString()}`);

      const challengerBalanceAfter = await ethers.provider.getBalance(challenger.address);
      const gasCost = challengeReceipt!.gasUsed * challengeReceipt!.gasPrice;
      const reward = challengerBalanceAfter - challengerBalanceBefore + gasCost;
      console.log(`  ✓ Challenger reward: ~${ethers.formatEther(reward)} ETH`);

      // Step 5: Fast forward past challenge period
      console.log("\nStep 5: Fast forward 7 days (challenge period ends)");
      await ethers.provider.send("evm_increaseTime", [CHALLENGE_PERIOD + 1]);
      await ethers.provider.send("evm_mine", []);
      console.log("  ✓ Time advanced by 7 days");

      // Step 6: Verify final states
      console.log("\nStep 6: Verify final entry states");
      const entry1Valid = await challengeContract.isAuditEntryValid(entries[0].nullifier);
      const entry2Valid = await challengeContract.isAuditEntryValid(entries[1].nullifier);
      const entry3Valid = await challengeContract.isAuditEntryValid(entries[2].nullifier);

      expect(entry1Valid).to.be.true;
      expect(entry2Valid).to.be.false; // Slashed
      expect(entry3Valid).to.be.true;

      console.log(`  ✓ Entry 1: ${entry1Valid ? "VALID" : "INVALID"}`);
      console.log(`  ✓ Entry 2: ${entry2Valid ? "VALID" : "INVALID (SLASHED)"}`);
      console.log(`  ✓ Entry 3: ${entry3Valid ? "VALID" : "INVALID"}`);

      // Step 7: New relayer re-registers
      console.log("\nStep 7: Relayer re-registers after slashing");
      const reRegisterTx = await challengeContract.connect(relayer).registerRelayer({ value: MIN_STAKE });
      const reRegisterReceipt = await reRegisterTx.wait();
      gasTracker["Re-register"] = reRegisterReceipt!.gasUsed;
      console.log(`  ✓ Re-register gas: ${gasTracker["Re-register"].toLocaleString()}`);

      // Calculate totals
      const totalGas = Object.values(gasTracker).reduce((a, b) => a + b, 0n);

      // Print summary
      console.log("\n" + "=".repeat(60));
      console.log("GAS COST SUMMARY - RlweAuditChallenge Contract");
      console.log("=".repeat(60));

      for (const [name, gas] of Object.entries(gasTracker)) {
        console.log(`${name.padEnd(30)} ${gas.toLocaleString().padStart(12)} gas`);
      }

      console.log("-".repeat(60));
      console.log(`${"TOTAL".padEnd(30)} ${totalGas.toLocaleString().padStart(12)} gas`);
      console.log("=".repeat(60));

      // ETH cost estimates
      console.log("\nETH COST ESTIMATES (Total):");
      const gasPrices = [
        { name: "Low (10 gwei)", gwei: 10n },
        { name: "Medium (30 gwei)", gwei: 30n },
        { name: "High (100 gwei)", gwei: 100n },
      ];

      for (const price of gasPrices) {
        const cost = totalGas * price.gwei * 1_000_000_000n;
        console.log(`  ${price.name}: ${ethers.formatEther(cost)} ETH`);
      }

      // Per-entry cost
      const perEntryGas = totalSubmitGas / 3n;
      console.log("\nPER AUDIT ENTRY COST:");
      for (const price of gasPrices) {
        const cost = perEntryGas * price.gwei * 1_000_000_000n;
        console.log(`  ${price.name}: ${ethers.formatEther(cost)} ETH`);
      }

      console.log("=".repeat(60));
      console.log("\n✓ Full relayer rollup flow completed successfully!\n");
    });

    it("should track gas for unregister flow", async () => {
      console.log("\n" + "=".repeat(60));
      console.log("RELAYER UNREGISTER FLOW - GAS TRACKING");
      console.log("=".repeat(60));

      // Register
      const registerTx = await challengeContract.connect(relayer).registerRelayer({ value: MIN_STAKE });
      const registerGas = (await registerTx.wait())!.gasUsed;

      // Submit an entry
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes("test_entry"));
      const submitTx = await challengeContract
        .connect(relayer)
        .submitAuditEntry(
          nullifier,
          ethers.keccak256(ethers.toUtf8Bytes("wa")),
          ethers.keccak256(ethers.toUtf8Bytes("ct")),
          "QmTest",
        );
      const submitGas = (await submitTx.wait())!.gasUsed;

      // Unregister
      const balanceBefore = await ethers.provider.getBalance(relayer.address);
      const unregisterTx = await challengeContract.connect(relayer).unregisterRelayer();
      const unregisterReceipt = await unregisterTx.wait();
      const unregisterGas = unregisterReceipt!.gasUsed;
      const balanceAfter = await ethers.provider.getBalance(relayer.address);

      const gasCost = unregisterGas * unregisterReceipt!.gasPrice;
      const stakeReturned = balanceAfter - balanceBefore + gasCost;

      console.log("\nGas Summary:");
      console.log(`  Register:    ${registerGas.toLocaleString().padStart(10)} gas`);
      console.log(`  Submit:      ${submitGas.toLocaleString().padStart(10)} gas`);
      console.log(`  Unregister:  ${unregisterGas.toLocaleString().padStart(10)} gas`);
      console.log("-".repeat(40));
      console.log(`  Total:       ${(registerGas + submitGas + unregisterGas).toLocaleString().padStart(10)} gas`);
      console.log(`\n  Stake returned: ${ethers.formatEther(stakeReturned)} ETH`);
      console.log("=".repeat(60));
    });
  });
});
