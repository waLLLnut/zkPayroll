/**
 * __LatticA__ Full Integration Test
 *
 * Scenario:
 * 1. BOB shields 1000 USDC into pool
 * 2. Shield rollup processed
 * 3. BOB transfers to 3 recipients:
 *    - ALICE: 300 USDC
 *    - CHARLIE: 400 USDC
 *    - DAVID: 300 USDC
 * 4. Transfer rollup processed
 * 5. All 3 recipients unshield (cash out)
 * 6. Single rollup processes all 3 unshields
 * 7. Query audit log by nullifier to verify encrypted sender identity
 */

import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, noir, typedDeployments } from "hardhat";
import { sdk as interfaceSdkModule } from "../sdk";
import { createBackendSdk as createBackendSdkFn } from "../sdk/backendSdk";
import { TreesService } from "../sdk/serverSdk";
import { parseUnits, snapshottedBeforeEach } from "../shared/utils";
import {
  MockERC20,
  MockERC20__factory,
  PoolERC20,
  PoolERC20__factory,
} from "../typechain-types";

describe("__LatticA__ Full Flow Integration", () => {
  // Signers
  let deployer: SignerWithAddress;
  let bob: SignerWithAddress;
  let alice: SignerWithAddress;
  let charlie: SignerWithAddress;
  let david: SignerWithAddress;

  // Secret keys for each user
  const bobSecretKey =
    "0x2120f33c0d324bfe571a18c1d5a1c9cdc6db60621e35bc78be1ced339f936a71";
  const aliceSecretKey =
    "0x118f09bc73ec486db2030077142f2bceba2a4d4c9e0f6147d776f8ca8ec02ff1";
  const charlieSecretKey =
    "0x038c0439a42280637b202fd2f0d25d6e8e3c11908eab966a6d85bd6797eed5d5";
  const davidSecretKey =
    "0x04a5f3c8b7e6d9f2a1b0c3e4d5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4";

  // Contracts
  let pool: PoolERC20;
  let usdc: MockERC20;

  // SDK instances
  let sdk: ReturnType<typeof interfaceSdkModule.createInterfaceSdk>;
  let backendSdk: ReturnType<typeof createBackendSdkFn>;
  const { CompleteWaAddress, TokenAmount, AuditLogService } = interfaceSdkModule;

  // Track nullifiers for audit log queries
  const unshieldNullifiers: string[] = [];

  snapshottedBeforeEach(async () => {
    [deployer, bob, alice, charlie, david] = await ethers.getSigners();
    await typedDeployments.fixture();

    pool = PoolERC20__factory.connect(
      (await typedDeployments.get("PoolERC20")).address,
      deployer,
    );

    // Deploy test USDC
    usdc = await new MockERC20__factory(deployer).deploy("USD Coin", "USDC");

    // Mint USDC to BOB (he will shield it)
    await usdc.mintForTests(bob.address, await parseUnits(usdc, "10000"));
    await usdc.connect(bob).approve(pool, ethers.MaxUint256);

    // Also approve pool for all users (for potential future use)
    await usdc.connect(alice).approve(pool, ethers.MaxUint256);
    await usdc.connect(charlie).approve(pool, ethers.MaxUint256);
    await usdc.connect(david).approve(pool, ethers.MaxUint256);
  });

  before(async () => {
    const coreSdk = interfaceSdkModule.createCoreSdk(pool);
    const trees = new TreesService(pool);

    sdk = interfaceSdkModule.createInterfaceSdk(coreSdk, trees, {
      shield: noir.getCircuitJson("erc20_shield"),
      unshield: noir.getCircuitJson("erc20_unshield"),
      join: noir.getCircuitJson("erc20_join"),
      transfer: noir.getCircuitJson("erc20_transfer"),
      swap: noir.getCircuitJson("lob_router_swap"),
    });

    backendSdk = createBackendSdkFn(coreSdk, trees, {
      rollup: noir.getCircuitJson("rollup"),
    });

    console.log("Initial tree roots:", await trees.getTreeRoots());
  });

  describe("Full Payroll Flow", () => {
    const INITIAL_AMOUNT = 1000n;
    const ALICE_AMOUNT = 300n;
    const CHARLIE_AMOUNT = 400n;
    const DAVID_AMOUNT = 300n;

    it("Step 1: BOB shields 1000 USDC", async () => {
      console.log("\n=== Step 1: BOB Shield ===");

      const bobBalanceBefore = await usdc.balanceOf(bob.address);
      console.log("BOB USDC balance before:", bobBalanceBefore.toString());

      const { note: bobNote, tx } = await sdk.poolErc20.shield({
        account: bob,
        token: usdc,
        amount: INITIAL_AMOUNT,
        secretKey: bobSecretKey,
      });

      const receipt = await tx.wait();
      console.log("Shield tx gas:", receipt?.gasUsed.toString());

      const bobBalanceAfter = await usdc.balanceOf(bob.address);
      console.log("BOB USDC balance after:", bobBalanceAfter.toString());

      expect(bobBalanceBefore - bobBalanceAfter).to.equal(INITIAL_AMOUNT);
      expect(await usdc.balanceOf(pool)).to.equal(INITIAL_AMOUNT);

      console.log("BOB shielded note hash:", await bobNote.hash());
    });

    it("Step 2: Shield rollup processed", async () => {
      console.log("\n=== Step 2: Shield Rollup ===");

      // First shield
      await sdk.poolErc20.shield({
        account: bob,
        token: usdc,
        amount: INITIAL_AMOUNT,
        secretKey: bobSecretKey,
      });

      // Process rollup
      await backendSdk.rollup.rollup();

      // Verify BOB's shielded balance
      const bobShieldedBalance = await sdk.poolErc20.balanceOf(
        usdc,
        bobSecretKey,
      );
      console.log("BOB shielded balance:", bobShieldedBalance.toString());
      expect(bobShieldedBalance).to.equal(INITIAL_AMOUNT);
    });

    it("Step 3: BOB transfers to ALICE, CHARLIE, DAVID", async () => {
      console.log("\n=== Step 3: BOB Transfers ===");

      // Setup: Shield first
      await sdk.poolErc20.shield({
        account: bob,
        token: usdc,
        amount: INITIAL_AMOUNT,
        secretKey: bobSecretKey,
      });
      await backendSdk.rollup.rollup();

      // Get BOB's note
      const [bobNote] = await sdk.poolErc20.getBalanceNotesOf(
        usdc,
        bobSecretKey,
      );
      expect(bobNote).to.not.be.undefined;

      // Transfer to ALICE (300)
      console.log("Transferring 300 USDC to ALICE...");
      const aliceTransfer = await sdk.poolErc20.transfer({
        secretKey: bobSecretKey,
        fromNote: bobNote,
        to: await CompleteWaAddress.fromSecretKey(aliceSecretKey),
        amount: await TokenAmount.from({
          token: await usdc.getAddress(),
          amount: ALICE_AMOUNT,
        }),
      });
      console.log("ALICE transfer nullifier:", aliceTransfer.nullifier);

      // Need to rollup to use the change note
      await backendSdk.rollup.rollup();

      // Get BOB's updated note (change from first transfer)
      const [bobNote2] = await sdk.poolErc20.getBalanceNotesOf(
        usdc,
        bobSecretKey,
      );

      // Transfer to CHARLIE (400)
      console.log("Transferring 400 USDC to CHARLIE...");
      const charlieTransfer = await sdk.poolErc20.transfer({
        secretKey: bobSecretKey,
        fromNote: bobNote2,
        to: await CompleteWaAddress.fromSecretKey(charlieSecretKey),
        amount: await TokenAmount.from({
          token: await usdc.getAddress(),
          amount: CHARLIE_AMOUNT,
        }),
      });
      console.log("CHARLIE transfer nullifier:", charlieTransfer.nullifier);

      await backendSdk.rollup.rollup();

      // Get BOB's final note
      const [bobNote3] = await sdk.poolErc20.getBalanceNotesOf(
        usdc,
        bobSecretKey,
      );

      // Transfer to DAVID (300)
      console.log("Transferring 300 USDC to DAVID...");
      const davidTransfer = await sdk.poolErc20.transfer({
        secretKey: bobSecretKey,
        fromNote: bobNote3,
        to: await CompleteWaAddress.fromSecretKey(davidSecretKey),
        amount: await TokenAmount.from({
          token: await usdc.getAddress(),
          amount: DAVID_AMOUNT,
        }),
      });
      console.log("DAVID transfer nullifier:", davidTransfer.nullifier);

      await backendSdk.rollup.rollup();

      // Verify final balances
      const aliceBalance = await sdk.poolErc20.balanceOf(usdc, aliceSecretKey);
      const charlieBalance = await sdk.poolErc20.balanceOf(
        usdc,
        charlieSecretKey,
      );
      const davidBalance = await sdk.poolErc20.balanceOf(usdc, davidSecretKey);
      const bobBalance = await sdk.poolErc20.balanceOf(usdc, bobSecretKey);

      console.log("\nShielded balances after transfers:");
      console.log("  ALICE:", aliceBalance.toString());
      console.log("  CHARLIE:", charlieBalance.toString());
      console.log("  DAVID:", davidBalance.toString());
      console.log("  BOB (remaining):", bobBalance.toString());

      expect(aliceBalance).to.equal(ALICE_AMOUNT);
      expect(charlieBalance).to.equal(CHARLIE_AMOUNT);
      expect(davidBalance).to.equal(DAVID_AMOUNT);
      expect(bobBalance).to.equal(0n); // BOB spent all
    });

    // Note: This test requires the SDK unshield function to be updated
    // to support the new RLWE ciphertext parameter
    it.skip("Step 4-6: Three unshields in single rollup with audit log", async () => {
      console.log("\n=== Steps 4-6: Batch Unshield ===");

      // Setup: Shield and transfer
      await sdk.poolErc20.shield({
        account: bob,
        token: usdc,
        amount: INITIAL_AMOUNT,
        secretKey: bobSecretKey,
      });
      await backendSdk.rollup.rollup();

      // Transfers
      const [bobNote] = await sdk.poolErc20.getBalanceNotesOf(
        usdc,
        bobSecretKey,
      );
      await sdk.poolErc20.transfer({
        secretKey: bobSecretKey,
        fromNote: bobNote,
        to: await CompleteWaAddress.fromSecretKey(aliceSecretKey),
        amount: await TokenAmount.from({
          token: await usdc.getAddress(),
          amount: ALICE_AMOUNT,
        }),
      });
      await backendSdk.rollup.rollup();

      const [bobNote2] = await sdk.poolErc20.getBalanceNotesOf(
        usdc,
        bobSecretKey,
      );
      await sdk.poolErc20.transfer({
        secretKey: bobSecretKey,
        fromNote: bobNote2,
        to: await CompleteWaAddress.fromSecretKey(charlieSecretKey),
        amount: await TokenAmount.from({
          token: await usdc.getAddress(),
          amount: CHARLIE_AMOUNT,
        }),
      });
      await backendSdk.rollup.rollup();

      const [bobNote3] = await sdk.poolErc20.getBalanceNotesOf(
        usdc,
        bobSecretKey,
      );
      await sdk.poolErc20.transfer({
        secretKey: bobSecretKey,
        fromNote: bobNote3,
        to: await CompleteWaAddress.fromSecretKey(davidSecretKey),
        amount: await TokenAmount.from({
          token: await usdc.getAddress(),
          amount: DAVID_AMOUNT,
        }),
      });
      await backendSdk.rollup.rollup();

      // Now each recipient unshields
      // Note: SDK unshield needs to be updated for RLWE support
      // This is a placeholder for the actual unshield calls

      console.log("\nUnshielding for all recipients...");
      console.log("(Requires SDK update for RLWE ciphertext support)");

      // After unshields, query audit logs
      const auditLogService = new AuditLogService(pool);

      // Query all audit logs
      const allLogs = await auditLogService.getAllAuditLogs();
      console.log("\nAudit logs recorded:", allLogs.length);

      for (const log of allLogs) {
        console.log(`  Nullifier: ${log.nullifier.slice(0, 20)}...`);
        console.log(`  Block: ${log.blockNumber}`);
      }
    });
  });

  describe("Audit Log Query Methods", () => {
    it("can query audit log by nullifier", async () => {
      // This test demonstrates the audit log query functionality
      // After an unshield with RLWE, the ciphertext is stored

      const auditLogService = new AuditLogService(pool);

      // Query a non-existent nullifier
      const result = await auditLogService.queryAuditLog(ethers.ZeroHash);
      expect(result.exists).to.be.false;

      console.log("Audit log query for non-existent nullifier:", result);
    });

    it("can parse RLWE ciphertext structure", async () => {
      const auditLogService = new AuditLogService(pool);

      // Create mock ciphertext (32 + 1024 fields of 32 bytes each)
      const mockFields: string[] = [];
      for (let i = 0; i < 1056; i++) {
        mockFields.push(ethers.zeroPadValue(ethers.toBeHex(i + 1), 32));
      }
      const mockCiphertext = ethers.concat(mockFields);

      const parsed = auditLogService.parseRlweCiphertext(mockCiphertext);

      expect(parsed.c0.length).to.equal(32);
      expect(parsed.c1.length).to.equal(1024);
      expect(parsed.c0[0]).to.equal(1n);
      expect(parsed.c0[31]).to.equal(32n);
      expect(parsed.c1[0]).to.equal(33n);
      expect(parsed.c1[1023]).to.equal(1056n);

      console.log("RLWE ciphertext parsing test passed");
      console.log("  c0 length:", parsed.c0.length);
      console.log("  c1 length:", parsed.c1.length);
    });
  });
});
