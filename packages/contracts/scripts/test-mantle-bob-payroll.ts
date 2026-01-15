#!/usr/bin/env tsx
/**
 * Mantle Sepolia BOB Payroll Scenario Test
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
import { parseUnits, formatUnits } from "../shared/utils";
import { MockERC20__factory, PoolERC20__factory } from "../typechain-types";

// Recipient addresses for unshield operations
const ALICE_ADDRESS = "0x3D3AB5dA5bD119bF02AD0805c9ECFAc4128cFF8B";
const CHARLIE_ADDRESS = "0x997006319a1f8d98068Ac0bc39FEfacF7F728DcE";
const DAVID_ADDRESS = "0x7A98B203A1c8cE832057a6Cbf28fB2967723f20f";

async function main() {
  console.log("Mantle Sepolia BOB Payroll Scenario Test Started\n");

  // Use deployed contracts
  const [deployer] = await ethers.getSigners();
  console.log(`Deployer: ${await deployer.getAddress()}`);

  const poolDeployment = await typedDeployments.get("PoolERC20");
  const pool = PoolERC20__factory.connect(poolDeployment.address, deployer);
  console.log(`   PoolERC20: ${poolDeployment.address}`);

  const usdcDeployment = await typedDeployments.get("MockUSDC");
  const usdc = MockERC20__factory.connect(usdcDeployment.address, deployer);
  console.log(`   MockUSDC: ${usdcDeployment.address}\n`);

  // USDC configuration
  const balance = await usdc.balanceOf(deployer);
  console.log(`   Deployer USDC balance: ${balance.toString()}`);
  if (balance < 10000n) {
    console.log("   Minting USDC...");
    await usdc.mintForTests(deployer, await parseUnits(usdc, "1000000"));
  }
  await usdc.connect(deployer).approve(pool, ethers.MaxUint256);
  console.log("Contract connection completed\n");

  const coreSdk = sdk.createCoreSdk(pool);
  // Mantle Sepolia eth_getLogs has 10,000 block limit
  // Automatically get deployment block or start from last 10,000 blocks
  let DEPLOYMENT_BLOCK: number | undefined;
  try {
    const poolDeploymentInfo = await typedDeployments.get("PoolERC20");
    if (poolDeploymentInfo.receipt?.blockNumber) {
      DEPLOYMENT_BLOCK = poolDeploymentInfo.receipt.blockNumber;
      console.log(`   Deployment block: ${DEPLOYMENT_BLOCK}`);
    }
  } catch {
    // If deployment info cannot be retrieved, start from current block - 10,000
    const currentBlock = await ethers.provider.getBlockNumber();
    DEPLOYMENT_BLOCK = Math.max(0, currentBlock - 10000);
    console.log(`   Warning: Could not find deployment block, starting from current block - 10,000 (${DEPLOYMENT_BLOCK})`);
  }
  const trees = new sdk.TreesService(pool, { fromBlock: DEPLOYMENT_BLOCK });
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

  // Secret keys
  const bobSecretKey = "0x2120f33c0d324bfe571a18c1d5a1c9cdc6db60621e35bc78be1ced339f936a71";
  const aliceSecretKey = "0x118f09bc73ec486db2030077142f2bceba2a4d4c9e0f6147d776f8ca8ec02ff1";
  const charlieSecretKey = "0x038c0439a42280637b202fd2f0d25d6e8e3c11908eab966a6d85bd6797eed5d5";
  const davidSecretKey = "0x048c0439a42280637b202fd2f0d25d6e8e3c11908eab966a6d85bd6797eed5d5";

  // Amounts in human-readable format (for logging)
  const payrollAmountDisplay = 1000;
  const aliceSalaryDisplay = 300;
  const charlieSalaryDisplay = 400;
  const davidSalaryDisplay = 300;

  // Convert to token units with decimals
  const payrollAmount = await parseUnits(usdc, payrollAmountDisplay.toString());
  const aliceSalary = await parseUnits(usdc, aliceSalaryDisplay.toString());
  const charlieSalary = await parseUnits(usdc, charlieSalaryDisplay.toString());
  const davidSalary = await parseUnits(usdc, davidSalaryDisplay.toString());

  // Step 1: Shield
  console.log("Step 1: BOB shields tokens into the shielded pool");
  console.log(`   - Shield amount: ${payrollAmountDisplay} USDC`);
  await interfaceSdk.poolErc20.shield({
    account: deployer,
    token: usdc,
    amount: payrollAmount,
    secretKey: bobSecretKey,
  });
  console.log("   Shield completed\n");

  // Step 2: Shield rollup
  console.log("Step 2: Shield rollup processing");
  const shieldRollupTx = await backendSdk.rollup.rollup();
  const shieldRollupReceipt = await shieldRollupTx.wait();
  console.log(`   Rollup completed - Transaction hash: ${shieldRollupTx.hash}`);
  console.log(`   Gas used: ${shieldRollupReceipt?.gasUsed?.toString()}\n`);

  const bobBalanceAfterShield = await interfaceSdk.poolErc20.balanceOf(usdc, bobSecretKey);
  const bobBalanceFormatted = await formatUnits(usdc, bobBalanceAfterShield);
  console.log(`   BOB's shielded balance: ${bobBalanceFormatted} USDC\n`);

  // Step 3: Transfers
  console.log("Step 3: BOB transfers to 3 recipients");
  const bobNotes = await interfaceSdk.poolErc20.getBalanceNotesOf(usdc, bobSecretKey);
  expect(bobNotes.length).to.be.greaterThan(0);

  // Helper to find a note with sufficient amount
  const findNoteWithAmount = (notes: typeof bobNotes, requiredAmount: bigint) => {
    return notes.find((n) => n.amount.amount >= requiredAmount);
  };

  // ALICE
  console.log(`   - Transfer ${aliceSalaryDisplay} USDC to ALICE`);
  const aliceWaAddress = await sdk.CompleteWaAddress.fromSecretKey(aliceSecretKey);
  const aliceNote = findNoteWithAmount(bobNotes, aliceSalary);
  if (!aliceNote) {
    throw new Error(`BOB has no sufficient note for ALICE transfer. Available: ${bobNotes.map(n => n.amount.amount.toString()).join(", ")}`);
  }
  await interfaceSdk.poolErc20.transfer({
    secretKey: bobSecretKey,
    fromNote: aliceNote,
    to: aliceWaAddress,
    amount: await sdk.TokenAmount.from({ token: await usdc.getAddress(), amount: aliceSalary }),
  });
  console.log("   ALICE transfer completed");
  await backendSdk.rollup.rollup();
  console.log("   First transfer rollup completed");

  // CHARLIE
  console.log(`   - Transfer ${charlieSalaryDisplay} USDC to CHARLIE`);
  const charlieWaAddress = await sdk.CompleteWaAddress.fromSecretKey(charlieSecretKey);
  const bobNotesAfterAlice = await interfaceSdk.poolErc20.getBalanceNotesOf(usdc, bobSecretKey);
  expect(bobNotesAfterAlice.length).to.be.greaterThan(0);
  const charlieNote = findNoteWithAmount(bobNotesAfterAlice, charlieSalary);
  if (!charlieNote) {
    throw new Error(`BOB has no sufficient note for CHARLIE transfer. Available: ${bobNotesAfterAlice.map(n => n.amount.amount.toString()).join(", ")}`);
  }
  await interfaceSdk.poolErc20.transfer({
    secretKey: bobSecretKey,
    fromNote: charlieNote,
    to: charlieWaAddress,
    amount: await sdk.TokenAmount.from({ token: await usdc.getAddress(), amount: charlieSalary }),
  });
  console.log("   CHARLIE transfer completed");
  await backendSdk.rollup.rollup();
  console.log("   Second transfer rollup completed");

  // DAVID
  console.log(`   - Transfer ${davidSalaryDisplay} USDC to DAVID`);
  const davidWaAddress = await sdk.CompleteWaAddress.fromSecretKey(davidSecretKey);
  const bobNotesAfterCharlie = await interfaceSdk.poolErc20.getBalanceNotesOf(usdc, bobSecretKey);
  expect(bobNotesAfterCharlie.length).to.be.greaterThan(0);
  const davidNote = findNoteWithAmount(bobNotesAfterCharlie, davidSalary);
  if (!davidNote) {
    throw new Error(`BOB has no sufficient note for DAVID transfer. Available: ${bobNotesAfterCharlie.map(n => n.amount.amount.toString()).join(", ")}`);
  }
  await interfaceSdk.poolErc20.transfer({
    secretKey: bobSecretKey,
    fromNote: davidNote,
    to: davidWaAddress,
    amount: await sdk.TokenAmount.from({ token: await usdc.getAddress(), amount: davidSalary }),
  });
  console.log("   DAVID transfer completed");
  const transferRollupTx = await backendSdk.rollup.rollup();
  console.log(`   Rollup completed - Transaction hash: ${transferRollupTx.hash}\n`);

  // Verify balances
  const aliceBalance = await interfaceSdk.poolErc20.balanceOf(usdc, aliceSecretKey);
  const charlieBalance = await interfaceSdk.poolErc20.balanceOf(usdc, charlieSecretKey);
  const davidBalance = await interfaceSdk.poolErc20.balanceOf(usdc, davidSecretKey);
  const aliceBalanceFormatted = await formatUnits(usdc, aliceBalance);
  const charlieBalanceFormatted = await formatUnits(usdc, charlieBalance);
  const davidBalanceFormatted = await formatUnits(usdc, davidBalance);
  console.log(`   ALICE's shielded balance: ${aliceBalanceFormatted} USDC`);
  console.log(`   CHARLIE's shielded balance: ${charlieBalanceFormatted} USDC`);
  console.log(`   DAVID's shielded balance: ${davidBalanceFormatted} USDC\n`);

  // Step 4: Unshields
  console.log("Step 4: All 3 recipients unshield (withdraw)");
  console.log(`   - ALICE recipient address: ${ALICE_ADDRESS}`);
  console.log(`   - CHARLIE recipient address: ${CHARLIE_ADDRESS}`);
  console.log(`   - DAVID recipient address: ${DAVID_ADDRESS}`);

  const aliceNotes = await interfaceSdk.poolErc20.getBalanceNotesOf(usdc, aliceSecretKey);
  const aliceNoteForUnshield = findNoteWithAmount(aliceNotes, aliceSalary);
  if (!aliceNoteForUnshield) {
    throw new Error(`ALICE has no sufficient note for unshield. Available: ${aliceNotes.map(n => n.amount.amount.toString()).join(", ")}`);
  }
  await interfaceSdk.poolErc20.unshield({
    secretKey: aliceSecretKey,
    fromNote: aliceNoteForUnshield,
    token: await usdc.getAddress(),
    to: ALICE_ADDRESS,
    amount: aliceSalary,
  });
  console.log("   ALICE unshield completed");

  const charlieNotes = await interfaceSdk.poolErc20.getBalanceNotesOf(usdc, charlieSecretKey);
  const charlieNoteForUnshield = findNoteWithAmount(charlieNotes, charlieSalary);
  if (!charlieNoteForUnshield) {
    throw new Error(`CHARLIE has no sufficient note for unshield. Available: ${charlieNotes.map(n => n.amount.amount.toString()).join(", ")}`);
  }
  await interfaceSdk.poolErc20.unshield({
    secretKey: charlieSecretKey,
    fromNote: charlieNoteForUnshield,
    token: await usdc.getAddress(),
    to: CHARLIE_ADDRESS,
    amount: charlieSalary,
  });
  console.log("   CHARLIE unshield completed");

  const davidNotes = await interfaceSdk.poolErc20.getBalanceNotesOf(usdc, davidSecretKey);
  const davidNoteForUnshield = findNoteWithAmount(davidNotes, davidSalary);
  if (!davidNoteForUnshield) {
    throw new Error(`DAVID has no sufficient note for unshield. Available: ${davidNotes.map(n => n.amount.amount.toString()).join(", ")}`);
  }
  await interfaceSdk.poolErc20.unshield({
    secretKey: davidSecretKey,
    fromNote: davidNoteForUnshield,
    token: await usdc.getAddress(),
    to: DAVID_ADDRESS,
    amount: davidSalary,
  });
  console.log("   DAVID unshield completed\n");

  // Step 5: Final rollup
  // Note: Each unshield transaction has already transferred tokens (immediate transfer in PoolERC20.sol unshield function)
  // Rollup adds note hashes and nullifiers of pending transactions to Merkle tree to update tree state
  // Future improvement: Remove immediate transfer from unshield and implement batch transfer in rollup
  console.log("Step 5: Rollup to update tree state for 3 unshield transactions");
  console.log("   - Each unshield transaction has already individually transferred tokens");
  console.log("   - Rollup bundles 3 pending unshield transactions into a single rollup to update tree state");
  const unshieldRollupStartTime = Date.now();
  const unshieldRollupTx = await backendSdk.rollup.rollup();
  const unshieldRollupReceipt = await unshieldRollupTx.wait();
  const unshieldRollupDuration = Date.now() - unshieldRollupStartTime;

  console.log(`   Rollup completed - Transaction hash: ${unshieldRollupTx.hash}`);
  console.log(`   Gas used: ${unshieldRollupReceipt?.gasUsed?.toString()}`);
  console.log(`   Rollup processing time: ${unshieldRollupDuration}ms\n`);

  // Step 6: Final verification
  console.log("Step 6: Final verification");
  const aliceFinalBalance = await usdc.balanceOf(ALICE_ADDRESS);
  const charlieFinalBalance = await usdc.balanceOf(CHARLIE_ADDRESS);
  const davidFinalBalance = await usdc.balanceOf(DAVID_ADDRESS);

  const aliceFinalBalanceFormatted = await formatUnits(usdc, aliceFinalBalance);
  const charlieFinalBalanceFormatted = await formatUnits(usdc, charlieFinalBalance);
  const davidFinalBalanceFormatted = await formatUnits(usdc, davidFinalBalance);

  console.log(`   ALICE's final USDC balance: ${aliceFinalBalanceFormatted} USDC`);
  console.log(`   CHARLIE's final USDC balance: ${charlieFinalBalanceFormatted} USDC`);
  console.log(`   DAVID's final USDC balance: ${davidFinalBalanceFormatted} USDC\n`);

  console.log("\nBOB Payroll Scenario Test Completed!");
  console.log("\nSummary:");
  console.log(`   - Shield rollup: ${shieldRollupTx.hash}`);
  console.log(`   - Transfer rollup: ${transferRollupTx.hash}`);
  console.log(`   - Unshield rollup: ${unshieldRollupTx.hash}`);
  console.log(`\nToken recipient addresses:`);
  console.log(`   - ALICE: ${ALICE_ADDRESS} -> ${aliceFinalBalanceFormatted} USDC`);
  console.log(`   - CHARLIE: ${CHARLIE_ADDRESS} -> ${charlieFinalBalanceFormatted} USDC`);
  console.log(`   - DAVID: ${DAVID_ADDRESS} -> ${davidFinalBalanceFormatted} USDC`);
  console.log(`\nMantle Sepolia Explorer:`);
  console.log(`   https://sepolia.mantlescan.xyz/tx/${unshieldRollupTx.hash}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
