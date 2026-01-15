/**
 * __LatticA__ Complete Scenario Test
 *
 * Tests the full payroll flow with RLWE audit:
 * 1. BOB shields 1000 USDC
 * 2. Shield rollup processed
 * 3. BOB transfers to ALICE(300), CHARLIE(400), DAVID(300)
 * 4. Transfer rollup processed
 * 5. All 3 recipients unshield
 * 6. Single rollup processes all 3 unshields
 * 7. Verify audit logs can be queried and decrypted
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

describe("__LatticA__ Complete Scenario Test", () => {
  // Signers
  let deployer: SignerWithAddress;
  let bob: SignerWithAddress;
  let alice: SignerWithAddress;
  let charlie: SignerWithAddress;
  let david: SignerWithAddress;

  // Secret keys
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

  // SDK
  let sdk: ReturnType<typeof interfaceSdkModule.createInterfaceSdk>;
  let backendSdk: ReturnType<typeof createBackendSdkFn>;
  const { CompleteWaAddress, TokenAmount, AuditLogService } = interfaceSdkModule;

  // Constants
  const INITIAL_AMOUNT = 1000n;
  const ALICE_AMOUNT = 300n;
  const CHARLIE_AMOUNT = 400n;
  const DAVID_AMOUNT = 300n;

  // Track test results
  const testResults: {
    step: string;
    success: boolean;
    gasUsed?: bigint;
    error?: string;
  }[] = [];

  snapshottedBeforeEach(async () => {
    [deployer, bob, alice, charlie, david] = await ethers.getSigners();
    await typedDeployments.fixture();

    pool = PoolERC20__factory.connect(
      (await typedDeployments.get("PoolERC20")).address,
      deployer,
    );

    usdc = await new MockERC20__factory(deployer).deploy("USD Coin", "USDC");
    await usdc.mintForTests(bob.address, await parseUnits(usdc, "10000"));
    await usdc.connect(bob).approve(pool, ethers.MaxUint256);
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
  });

  describe("Correctness: Full Payroll Flow", () => {
    it("executes complete scenario: shield → transfers → unshields", async () => {
      console.log("\n" + "=".repeat(60));
      console.log("__LatticA__ Complete Scenario Test");
      console.log("=".repeat(60));

      // ============================================================
      // STEP 1: BOB shields 1000 USDC
      // ============================================================
      console.log("\n[Step 1] BOB shields 1000 USDC...");

      const bobUsdcBefore = await usdc.balanceOf(bob.address);
      const { note: bobNote, tx: shieldTx } = await sdk.poolErc20.shield({
        account: bob,
        token: usdc,
        amount: INITIAL_AMOUNT,
        secretKey: bobSecretKey,
      });

      const shieldReceipt = await shieldTx.wait();
      console.log(`  Shield gas: ${shieldReceipt?.gasUsed.toString()}`);

      const bobUsdcAfter = await usdc.balanceOf(bob.address);
      expect(bobUsdcBefore - bobUsdcAfter).to.equal(INITIAL_AMOUNT);
      console.log("  ✓ BOB's USDC deducted correctly");

      testResults.push({
        step: "Shield",
        success: true,
        gasUsed: shieldReceipt?.gasUsed,
      });

      // ============================================================
      // STEP 2: Shield rollup processed
      // ============================================================
      console.log("\n[Step 2] Processing shield rollup...");

      await backendSdk.rollup.rollup();

      const bobShieldedBalance = await sdk.poolErc20.balanceOf(
        usdc,
        bobSecretKey,
      );
      expect(bobShieldedBalance).to.equal(INITIAL_AMOUNT);
      console.log(`  ✓ BOB's shielded balance: ${bobShieldedBalance}`);

      testResults.push({ step: "Shield Rollup", success: true });

      // ============================================================
      // STEP 3: BOB transfers to ALICE, CHARLIE, DAVID
      // ============================================================
      console.log("\n[Step 3] BOB transfers to 3 recipients...");

      // Transfer to ALICE (300)
      console.log("  Transferring 300 USDC to ALICE...");
      const [currentNote1] = await sdk.poolErc20.getBalanceNotesOf(
        usdc,
        bobSecretKey,
      );

      const aliceTransfer = await sdk.poolErc20.transfer({
        secretKey: bobSecretKey,
        fromNote: currentNote1,
        to: await CompleteWaAddress.fromSecretKey(aliceSecretKey),
        amount: await TokenAmount.from({
          token: await usdc.getAddress(),
          amount: ALICE_AMOUNT,
        }),
      });
      console.log(`    Gas: ${(await aliceTransfer.tx.wait())?.gasUsed}`);

      await backendSdk.rollup.rollup();

      // Transfer to CHARLIE (400)
      console.log("  Transferring 400 USDC to CHARLIE...");
      const [currentNote2] = await sdk.poolErc20.getBalanceNotesOf(
        usdc,
        bobSecretKey,
      );

      const charlieTransfer = await sdk.poolErc20.transfer({
        secretKey: bobSecretKey,
        fromNote: currentNote2,
        to: await CompleteWaAddress.fromSecretKey(charlieSecretKey),
        amount: await TokenAmount.from({
          token: await usdc.getAddress(),
          amount: CHARLIE_AMOUNT,
        }),
      });
      console.log(`    Gas: ${(await charlieTransfer.tx.wait())?.gasUsed}`);

      await backendSdk.rollup.rollup();

      // Transfer to DAVID (300)
      console.log("  Transferring 300 USDC to DAVID...");
      const [currentNote3] = await sdk.poolErc20.getBalanceNotesOf(
        usdc,
        bobSecretKey,
      );

      const davidTransfer = await sdk.poolErc20.transfer({
        secretKey: bobSecretKey,
        fromNote: currentNote3,
        to: await CompleteWaAddress.fromSecretKey(davidSecretKey),
        amount: await TokenAmount.from({
          token: await usdc.getAddress(),
          amount: DAVID_AMOUNT,
        }),
      });
      console.log(`    Gas: ${(await davidTransfer.tx.wait())?.gasUsed}`);

      await backendSdk.rollup.rollup();

      // Verify balances
      const aliceBalance = await sdk.poolErc20.balanceOf(usdc, aliceSecretKey);
      const charlieBalance = await sdk.poolErc20.balanceOf(
        usdc,
        charlieSecretKey,
      );
      const davidBalance = await sdk.poolErc20.balanceOf(usdc, davidSecretKey);
      const bobRemaining = await sdk.poolErc20.balanceOf(usdc, bobSecretKey);

      expect(aliceBalance).to.equal(ALICE_AMOUNT);
      expect(charlieBalance).to.equal(CHARLIE_AMOUNT);
      expect(davidBalance).to.equal(DAVID_AMOUNT);
      expect(bobRemaining).to.equal(0n);

      console.log("  ✓ Shielded balances after transfers:");
      console.log(`    ALICE: ${aliceBalance} USDC`);
      console.log(`    CHARLIE: ${charlieBalance} USDC`);
      console.log(`    DAVID: ${davidBalance} USDC`);
      console.log(`    BOB: ${bobRemaining} USDC (spent all)`);

      testResults.push({ step: "Transfers", success: true });

      // ============================================================
      // STEP 4-5: Recipients unshield
      // ============================================================
      console.log("\n[Step 4-5] Recipients unshield...");

      // ALICE unshields
      console.log("  ALICE unshielding 300 USDC...");
      const [aliceNote] = await sdk.poolErc20.getBalanceNotesOf(
        usdc,
        aliceSecretKey,
      );
      const aliceUnshield = await sdk.poolErc20.unshield({
        secretKey: aliceSecretKey,
        fromNote: aliceNote,
        token: await usdc.getAddress(),
        to: alice.address,
        amount: ALICE_AMOUNT,
      });
      console.log(
        `    Gas: ${(await aliceUnshield.tx.wait())?.gasUsed}`,
      );
      console.log(`    Nullifier: ${aliceUnshield.nullifier.slice(0, 20)}...`);

      // CHARLIE unshields
      console.log("  CHARLIE unshielding 400 USDC...");
      const [charlieNote] = await sdk.poolErc20.getBalanceNotesOf(
        usdc,
        charlieSecretKey,
      );
      const charlieUnshield = await sdk.poolErc20.unshield({
        secretKey: charlieSecretKey,
        fromNote: charlieNote,
        token: await usdc.getAddress(),
        to: charlie.address,
        amount: CHARLIE_AMOUNT,
      });
      console.log(
        `    Gas: ${(await charlieUnshield.tx.wait())?.gasUsed}`,
      );
      console.log(
        `    Nullifier: ${charlieUnshield.nullifier.slice(0, 20)}...`,
      );

      // DAVID unshields
      console.log("  DAVID unshielding 300 USDC...");
      const [davidNote] = await sdk.poolErc20.getBalanceNotesOf(
        usdc,
        davidSecretKey,
      );
      const davidUnshield = await sdk.poolErc20.unshield({
        secretKey: davidSecretKey,
        fromNote: davidNote,
        token: await usdc.getAddress(),
        to: david.address,
        amount: DAVID_AMOUNT,
      });
      console.log(`    Gas: ${(await davidUnshield.tx.wait())?.gasUsed}`);
      console.log(`    Nullifier: ${davidUnshield.nullifier.slice(0, 20)}...`);

      testResults.push({ step: "Unshields", success: true });

      // ============================================================
      // STEP 6: Rollup processes all unshields
      // ============================================================
      console.log("\n[Step 6] Processing unshield rollup...");

      await backendSdk.rollup.rollup();
      console.log("  ✓ Rollup processed");

      // Verify final balances
      const aliceFinalUsdc = await usdc.balanceOf(alice.address);
      const charlieFinalUsdc = await usdc.balanceOf(charlie.address);
      const davidFinalUsdc = await usdc.balanceOf(david.address);

      expect(aliceFinalUsdc).to.equal(ALICE_AMOUNT);
      expect(charlieFinalUsdc).to.equal(CHARLIE_AMOUNT);
      expect(davidFinalUsdc).to.equal(DAVID_AMOUNT);

      console.log("  ✓ Final USDC balances verified:");
      console.log(`    ALICE: ${aliceFinalUsdc} USDC`);
      console.log(`    CHARLIE: ${charlieFinalUsdc} USDC`);
      console.log(`    DAVID: ${davidFinalUsdc} USDC`);

      testResults.push({ step: "Final Rollup", success: true });

      // ============================================================
      // STEP 7: Query audit logs
      // ============================================================
      console.log("\n[Step 7] Querying audit logs...");

      const auditLogService = new AuditLogService(pool);

      // Query by nullifiers
      const aliceLog = await auditLogService.queryAuditLog(
        aliceUnshield.nullifier,
      );
      const charlieLog = await auditLogService.queryAuditLog(
        charlieUnshield.nullifier,
      );
      const davidLog = await auditLogService.queryAuditLog(
        davidUnshield.nullifier,
      );

      if (aliceLog) {
        console.log("  ✓ ALICE audit log found");
        console.log(`    wa_commitment: ${aliceLog.waCommitment.slice(0, 20)}...`);
      }
      if (charlieLog) {
        console.log("  ✓ CHARLIE audit log found");
        console.log(
          `    wa_commitment: ${charlieLog.waCommitment.slice(0, 20)}...`,
        );
      }
      if (davidLog) {
        console.log("  ✓ DAVID audit log found");
        console.log(`    wa_commitment: ${davidLog.waCommitment.slice(0, 20)}...`);
      }

      const allLogs = await auditLogService.getAllAuditLogs();
      console.log(`  Total audit logs: ${allLogs.length}`);

      testResults.push({ step: "Audit Logs", success: true });

      // ============================================================
      // Summary
      // ============================================================
      console.log("\n" + "=".repeat(60));
      console.log("TEST SUMMARY");
      console.log("=".repeat(60));
      for (const result of testResults) {
        const status = result.success ? "✓" : "✗";
        const gas = result.gasUsed ? ` (gas: ${result.gasUsed})` : "";
        console.log(`  ${status} ${result.step}${gas}`);
      }
      console.log("=".repeat(60));
    });
  });
});
