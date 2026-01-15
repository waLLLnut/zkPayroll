#!/usr/bin/env tsx
/**
 * BOB Payroll Scenario Test
 *
 * Scenario:
 * 1. BOB shields tokens into the shielded pool (encryption)
 * 2. BOB transfers to 3 recipients (ALICE, CHARLIE, DAVID)
 * 3. All 3 recipients unshield their tokens
 *    - Each unshield transaction immediately transfers tokens (PoolERC20.sol unshield function)
 *    - Rollup only updates the tree, token transfers are already completed
 *
 * Future Improvements:
 * - Remove immediate transfer from unshield and implement batch transfer in rollup
 * - This will allow 3 unshield transactions to be bundled in a single rollup and processed in one block
 */

import { expect } from "chai";
import { ethers, noir, typedDeployments } from "hardhat";
import { sdk } from "../sdk";
import { createBackendSdk } from "../sdk/backendSdk";
import { parseUnits } from "../shared/utils";
import { MockERC20__factory, PoolERC20__factory } from "../typechain-types";

async function main() {
  console.log("BOB Payroll Scenario Test Started\n");

  // 1. Deploy and initialize contracts
  console.log("Deploying contracts...");
  await typedDeployments.fixture();
  const [deployer, bob, alice, charlie, david] = await ethers.getSigners();
  const pool = PoolERC20__factory.connect(
    (await typedDeployments.get("PoolERC20")).address,
    deployer,
  );

  const usdc = await new MockERC20__factory(deployer).deploy("USD Coin", "USDC");
  await usdc.mintForTests(deployer, await parseUnits(usdc, "1000000"));
  await usdc.connect(deployer).approve(pool, ethers.MaxUint256);

  const coreSdk = sdk.createCoreSdk(pool);
  const trees = new sdk.TreesService(pool);
  const interfaceSdk = sdk.createInterfaceSdk(coreSdk, trees, {
    shield: noir.getCircuitJson("erc20_shield"),
    unshield: noir.getCircuitJson("erc20_unshield"),
    join: noir.getCircuitJson("erc20_join"),
    transfer: noir.getCircuitJson("erc20_transfer"),
    swap: noir.getCircuitJson("lob_router_swap"),
  });
  const backendSdk = createBackendSdk(coreSdk, trees, {
    rollup: noir.getCircuitJson("rollup"),
  });
  console.log("Contract deployment and initialization completed\n");

  // Secret keys
  const bobSecretKey =
    "0x2120f33c0d324bfe571a18c1d5a1c9cdc6db60621e35bc78be1ced339f936a71";
  const aliceSecretKey =
    "0x118f09bc73ec486db2030077142f2bceba2a4d4c9e0f6147d776f8ca8ec02ff1";
  const charlieSecretKey =
    "0x038c0439a42280637b202fd2f0d25d6e8e3c11908eab966a6d85bd6797eed5d5";
  const davidSecretKey =
    "0x048c0439a42280637b202fd2f0d25d6e8e3c11908eab966a6d85bd6797eed5d5";

  const payrollAmount = 1000n; // Total amount BOB will shield
  const aliceSalary = 300n; // Amount to pay ALICE
  const charlieSalary = 400n; // Amount to pay CHARLIE
  const davidSalary = 300n; // Amount to pay DAVID

  // 2. BOB shields tokens into the shielded pool
  console.log("Step 1: BOB shields tokens into the shielded pool");
  console.log(`   - Shield amount: ${payrollAmount} USDC`);
  const { note: bobShieldNote } = await interfaceSdk.poolErc20.shield({
    account: deployer,
    token: usdc,
    amount: payrollAmount,
    secretKey: bobSecretKey,
  });
  console.log("   Shield completed\n");

  // 3. Shield rollup (shield must be processed before transfer is possible)
  console.log("Step 2: Shield rollup processing");
  const shieldRollupTx = await backendSdk.rollup.rollup();
  const shieldRollupReceipt = await shieldRollupTx.wait();
  console.log(`   Rollup completed - Transaction hash: ${shieldRollupTx.hash}`);
  console.log(`   Gas used: ${shieldRollupReceipt?.gasUsed?.toString()}\n`);

  // Check BOB's balance
  const bobBalanceAfterShield = await interfaceSdk.poolErc20.balanceOf(
    usdc,
    bobSecretKey,
  );
  expect(bobBalanceAfterShield).to.equal(payrollAmount);
  console.log(`   BOB's shielded balance: ${bobBalanceAfterShield} USDC\n`);

  // 4. BOB transfers to 3 recipients (rollup needed after each transfer)
  console.log("Step 3: BOB transfers to 3 recipients");
  const bobNotes = await interfaceSdk.poolErc20.getBalanceNotesOf(
    usdc,
    bobSecretKey,
  );
  expect(bobNotes.length).to.be.greaterThan(0);

  // Transfer to ALICE
  console.log(`   - Transfer ${aliceSalary} USDC to ALICE`);
  const aliceWaAddress = await sdk.CompleteWaAddress.fromSecretKey(
    aliceSecretKey,
  );
  const aliceTransferAmount = await sdk.TokenAmount.from({
    token: await usdc.getAddress(),
    amount: aliceSalary,
  });
  const aliceTransferResult = await interfaceSdk.poolErc20.transfer({
    secretKey: bobSecretKey,
    fromNote: bobNotes[0],
    to: aliceWaAddress,
    amount: aliceTransferAmount,
  });
  console.log("   ALICE transfer completed");

  // First transfer rollup (so changeNote is included in Merkle Tree)
  console.log("   - Processing first transfer rollup...");
  await backendSdk.rollup.rollup();
  console.log("   First transfer rollup completed");

  // Transfer to CHARLIE (changeNote available after rollup)
  console.log(`   - Transfer ${charlieSalary} USDC to CHARLIE`);
  const charlieWaAddress = await sdk.CompleteWaAddress.fromSecretKey(
    charlieSecretKey,
  );
  const charlieTransferAmount = await sdk.TokenAmount.from({
    token: await usdc.getAddress(),
    amount: charlieSalary,
  });
  // Get changeNote after rollup
  const bobNotesAfterAlice = await interfaceSdk.poolErc20.getBalanceNotesOf(
    usdc,
    bobSecretKey,
  );
  expect(bobNotesAfterAlice.length).to.be.greaterThan(0);
  const charlieTransferResult = await interfaceSdk.poolErc20.transfer({
    secretKey: bobSecretKey,
    fromNote: bobNotesAfterAlice[0], // Note available after rollup
    to: charlieWaAddress,
    amount: charlieTransferAmount,
  });
  console.log("   CHARLIE transfer completed");

  // Second transfer rollup
  console.log("   - Processing second transfer rollup...");
  await backendSdk.rollup.rollup();
  console.log("   Second transfer rollup completed");

  // Transfer to DAVID
  console.log(`   - Transfer ${davidSalary} USDC to DAVID`);
  const davidWaAddress = await sdk.CompleteWaAddress.fromSecretKey(
    davidSecretKey,
  );
  const davidTransferAmount = await sdk.TokenAmount.from({
    token: await usdc.getAddress(),
    amount: davidSalary,
  });
  // Get changeNote after rollup
  const bobNotesAfterCharlie =
    await interfaceSdk.poolErc20.getBalanceNotesOf(usdc, bobSecretKey);
  expect(bobNotesAfterCharlie.length).to.be.greaterThan(0);
  const davidTransferResult = await interfaceSdk.poolErc20.transfer({
    secretKey: bobSecretKey,
    fromNote: bobNotesAfterCharlie[0], // Note available after rollup
    to: davidWaAddress,
    amount: davidTransferAmount,
  });
  console.log("   DAVID transfer completed");

  // Third transfer rollup
  console.log("   - Processing third transfer rollup...");
  const transferRollupTx = await backendSdk.rollup.rollup();
  const transferRollupReceipt = await transferRollupTx.wait();
  console.log(`   Rollup completed - Transaction hash: ${transferRollupTx.hash}`);
  console.log(
    `   Gas used: ${transferRollupReceipt?.gasUsed?.toString()}\n`,
  );

  // Verify individual balances
  const aliceBalance = await interfaceSdk.poolErc20.balanceOf(
    usdc,
    aliceSecretKey,
  );
  const charlieBalance = await interfaceSdk.poolErc20.balanceOf(
    usdc,
    charlieSecretKey,
  );
  const davidBalance = await interfaceSdk.poolErc20.balanceOf(
    usdc,
    davidSecretKey,
  );
  expect(aliceBalance).to.equal(aliceSalary);
  expect(charlieBalance).to.equal(charlieSalary);
  expect(davidBalance).to.equal(davidSalary);
  console.log(`   ALICE's shielded balance: ${aliceBalance} USDC`);
  console.log(`   CHARLIE's shielded balance: ${charlieBalance} USDC`);
  console.log(`   DAVID's shielded balance: ${davidBalance} USDC\n`);

  // 6. All 3 recipients unshield (withdraw)
  console.log("Step 5: All 3 recipients unshield (withdraw)");
  const aliceAddress = await alice.getAddress();
  const charlieAddress = await charlie.getAddress();
  const davidAddress = await david.getAddress();

  // ALICE unshield
  console.log(`   - ALICE unshields ${aliceSalary} USDC`);
  const aliceNotes = await interfaceSdk.poolErc20.getBalanceNotesOf(
    usdc,
    aliceSecretKey,
  );
  expect(aliceNotes.length).to.be.greaterThan(0);
  const aliceUnshieldTx = await interfaceSdk.poolErc20.unshield({
    secretKey: aliceSecretKey,
    fromNote: aliceNotes[0],
    token: await usdc.getAddress(),
    to: aliceAddress,
    amount: aliceSalary,
  });
  console.log("   ALICE unshield completed");

  // CHARLIE unshield
  console.log(`   - CHARLIE unshields ${charlieSalary} USDC`);
  const charlieNotes = await interfaceSdk.poolErc20.getBalanceNotesOf(
    usdc,
    charlieSecretKey,
  );
  expect(charlieNotes.length).to.be.greaterThan(0);
  const charlieUnshieldTx = await interfaceSdk.poolErc20.unshield({
    secretKey: charlieSecretKey,
    fromNote: charlieNotes[0],
    token: await usdc.getAddress(),
    to: charlieAddress,
    amount: charlieSalary,
  });
  console.log("   CHARLIE unshield completed");

  // DAVID unshield
  console.log(`   - DAVID unshields ${davidSalary} USDC`);
  const davidNotes = await interfaceSdk.poolErc20.getBalanceNotesOf(
    usdc,
    davidSecretKey,
  );
  expect(davidNotes.length).to.be.greaterThan(0);
  const davidUnshieldTx = await interfaceSdk.poolErc20.unshield({
    secretKey: davidSecretKey,
    fromNote: davidNotes[0],
    token: await usdc.getAddress(),
    to: davidAddress,
    amount: davidSalary,
  });
  console.log("   DAVID unshield completed\n");

  // 7. Rollup to update tree state for 3 unshield transactions
  // Note: Each unshield transaction has already transferred tokens (immediate transfer in PoolERC20.sol unshield function)
  // Rollup adds note hashes and nullifiers of pending transactions to Merkle tree to update tree state
  // Future improvement: Remove immediate transfer from unshield and implement batch transfer in rollup
  console.log("Step 6: Rollup to update tree state for 3 unshield transactions");
  console.log("   - Each unshield transaction has already individually transferred tokens");
  console.log("   - Rollup bundles 3 pending unshield transactions into a single rollup to update tree state");
  const unshieldRollupStartTime = Date.now();
  const unshieldRollupTx = await backendSdk.rollup.rollup();
  const unshieldRollupReceipt = await unshieldRollupTx.wait();
  const unshieldRollupEndTime = Date.now();
  const unshieldRollupDuration = unshieldRollupEndTime - unshieldRollupStartTime;

  console.log(`   Rollup completed - Transaction hash: ${unshieldRollupTx.hash}`);
  console.log(`   Gas used: ${unshieldRollupReceipt?.gasUsed?.toString()}`);
  console.log(`   Rollup processing time: ${unshieldRollupDuration}ms\n`);

  // 8. Final verification
  console.log("Step 7: Final verification");
  const aliceFinalBalance = await usdc.balanceOf(aliceAddress);
  const charlieFinalBalance = await usdc.balanceOf(charlieAddress);
  const davidFinalBalance = await usdc.balanceOf(davidAddress);

  expect(aliceFinalBalance).to.equal(aliceSalary);
  expect(charlieFinalBalance).to.equal(charlieSalary);
  expect(davidFinalBalance).to.equal(davidSalary);

  console.log(`   ALICE's final USDC balance: ${aliceFinalBalance.toString()}`);
  console.log(
    `   CHARLIE's final USDC balance: ${charlieFinalBalance.toString()}`,
  );
  console.log(`   DAVID's final USDC balance: ${davidFinalBalance.toString()}`);

  // Verify pending transactions (all should be processed)
  const pendingTxs = await pool.getAllPendingTxs();
  const unrolledTxs = pendingTxs.filter((tx) => !tx.rolledUp);
  console.log(
    `   Unprocessed pending transactions: ${unrolledTxs.length}`,
  );
  expect(unrolledTxs.length).to.equal(0);

  // Each recipient's shielded balance should be 0 (all have unshielded)
  const aliceShieldedBalance = await interfaceSdk.poolErc20.balanceOf(
    usdc,
    aliceSecretKey,
  );
  const charlieShieldedBalance = await interfaceSdk.poolErc20.balanceOf(
    usdc,
    charlieSecretKey,
  );
  const davidShieldedBalance = await interfaceSdk.poolErc20.balanceOf(
    usdc,
    davidSecretKey,
  );
  expect(aliceShieldedBalance).to.equal(0n);
  expect(charlieShieldedBalance).to.equal(0n);
  expect(davidShieldedBalance).to.equal(0n);
  console.log(`   ALICE's shielded balance: ${aliceShieldedBalance}`);
  console.log(`   CHARLIE's shielded balance: ${charlieShieldedBalance}`);
  console.log(`   DAVID's shielded balance: ${davidShieldedBalance}\n`);

  console.log("\nBOB Payroll Scenario Test Completed!");
  console.log("\nSummary:");
  console.log(`   - Shield rollup: ${shieldRollupTx.hash}`);
  console.log(`   - Transfer rollup: ${transferRollupTx.hash}`);
  console.log(
    `   - Unshield rollup (tree state update for 3 unshield transactions): ${unshieldRollupTx.hash}`,
  );
  console.log(
    `   - Unshield rollup processing time: ${unshieldRollupDuration}ms`,
  );
  console.log(
    `   - Each unshield transaction individually transferred tokens, and rollup updated tree state`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
