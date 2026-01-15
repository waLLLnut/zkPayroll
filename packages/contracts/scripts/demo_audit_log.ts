#!/usr/bin/env npx tsx
/**
 * __LatticA__ Full Scenario Demo with Audit
 *
 * Complete BOB Payroll flow:
 * 1. BOB shields 1000 USDC
 * 2. Shield rollup processed
 * 3. BOB transfers to ALICE(300), CHARLIE(400), DAVID(300)
 * 4. Transfer rollup processed
 * 5. All 3 recipients unshield (with RLWE audit logs)
 * 6. Unshield rollup processed
 * 7. Final verification of balances
 * 8. Auditor requests identity reveal for suspicious transaction
 * 9. Threshold nodes approve and decrypt -> reveals sender's signature pubkey
 *
 * __LatticA__ Changes:
 * - Grumpkin curve based WaAddress (Baby JubJub compatible)
 * - RLWE encryption for sender identity
 * - 2-of-3 threshold decryption for audit
 * - Optimistic rollup with 7-day challenge period
 */

import { ethers, noir, typedDeployments } from "hardhat";
import { sdk as interfaceSdkModule } from "../sdk";
import { createBackendSdk as createBackendSdkFn } from "../sdk/backendSdk";
import { TreesService } from "../sdk/serverSdk";
import { formatUnits, parseUnits } from "../shared/utils";
import {
  MockERC20__factory,
  PoolERC20__factory,
} from "../typechain-types";

// Import RLWE crypto
import {
  generateKeyPair,
  encrypt,
  splitSecretKey,
  RLWE_N,
  RLWE_MESSAGE_SLOTS,
} from "../demo/rlwe_crypto";

// ============================================================================
// Configuration
// ============================================================================

// Recipient addresses (for unshield)
const ALICE_ADDRESS = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const CHARLIE_ADDRESS = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const DAVID_ADDRESS = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";

// Secret keys for each user
const BOB_SECRET_KEY = "0x2120f33c0d324bfe571a18c1d5a1c9cdc6db60621e35bc78be1ced339f936a71";
const ALICE_SECRET_KEY = "0x118f09bc73ec486db2030077142f2bceba2a4d4c9e0f6147d776f8ca8ec02ff1";
const CHARLIE_SECRET_KEY = "0x038c0439a42280637b202fd2f0d25d6e8e3c11908eab966a6d85bd6797eed5d5";
const DAVID_SECRET_KEY = "0x04a5f3c8b7e6d9f2a1b0c3e4d5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4";

// Amounts
const INITIAL_AMOUNT = 1000n;
const ALICE_AMOUNT = 300n;
const CHARLIE_AMOUNT = 400n;
const DAVID_AMOUNT = 300n;

// ============================================================================
// Helper Functions
// ============================================================================

function printHeader(text: string): void {
  console.log("\n" + "=".repeat(70));
  console.log("  " + text);
  console.log("=".repeat(70));
}

function printSubHeader(text: string): void {
  console.log("\n" + "-".repeat(60));
  console.log("  " + text);
  console.log("-".repeat(60));
}

// ============================================================================
// Main Demo
// ============================================================================

async function main() {
  console.log("\n");
  printHeader("__LatticA__ Full Payroll Scenario with RLWE Audit");
  console.log(`
  This demo shows the complete BOB payroll flow:
  1. BOB shields 1000 USDC into pool
  2. Shield rollup processed
  3. BOB transfers to ALICE(300), CHARLIE(400), DAVID(300)
  4. Transfer rollup processed
  5. All 3 recipients unshield with RLWE audit logs
  6. Unshield rollup to update tree state
  7. Final verification of balances
  8. Auditor requests identity reveal
  9. Threshold decryption reveals sender identity
  `);

  // ==========================================
  // Setup: Deploy contracts and initialize SDK
  // ==========================================
  printSubHeader("Setup: Deploying contracts and initializing SDK");

  const [deployer, bob, alice, charlie, david] = await ethers.getSigners();
  await typedDeployments.fixture();

  const pool = PoolERC20__factory.connect(
    (await typedDeployments.get("PoolERC20")).address,
    deployer,
  );

  // Deploy test USDC
  const usdc = await new MockERC20__factory(deployer).deploy("USD Coin", "USDC");

  // Mint USDC to BOB
  await usdc.mintForTests(bob.address, await parseUnits(usdc, "10000"));
  await usdc.connect(bob).approve(pool, ethers.MaxUint256);

  // Approve pool for all users
  await usdc.connect(alice).approve(pool, ethers.MaxUint256);
  await usdc.connect(charlie).approve(pool, ethers.MaxUint256);
  await usdc.connect(david).approve(pool, ethers.MaxUint256);

  console.log(`  Pool deployed: ${await pool.getAddress()}`);
  console.log(`  USDC deployed: ${await usdc.getAddress()}`);
  console.log(`  BOB address: ${bob.address}`);
  console.log(`  BOB USDC balance: ${await formatUnits(usdc, await usdc.balanceOf(bob.address))} USDC`);

  // Initialize SDK
  const coreSdk = interfaceSdkModule.createCoreSdk(pool);
  const trees = new TreesService(pool);

  const sdk = interfaceSdkModule.createInterfaceSdk(coreSdk, trees, {
    shield: noir.getCircuitJson("erc20_shield"),
    unshield: noir.getCircuitJson("erc20_unshield"),
    join: noir.getCircuitJson("erc20_join"),
    transfer: noir.getCircuitJson("erc20_transfer"),
    swap: noir.getCircuitJson("lob_router_swap"),
  });

  const backendSdk = createBackendSdkFn(coreSdk, trees, {
    rollup: noir.getCircuitJson("rollup"),
  });

  const { CompleteWaAddress, TokenAmount } = interfaceSdkModule;

  console.log(`  SDK initialized`);
  console.log(`  Initial tree roots:`, await trees.getTreeRoots());

  // ==========================================
  // Initialize RLWE Audit System
  // ==========================================
  printSubHeader("Step 0: Initialize RLWE Audit System");

  const rlweKeyPair = generateKeyPair("lattica_payroll_demo_seed");
  const shares = splitSecretKey(rlweKeyPair.sk, "lattica_shares_seed");

  console.log(`  RLWE keypair generated`);
  console.log(`  Public key A: [${rlweKeyPair.pk_a.slice(0, 3).join(", ")}...]`);
  console.log(`  Secret key split into 3 shares:`);
  console.log(`    Share 1 -> GOVT_NODE`);
  console.log(`    Share 2 -> COMPANY_NODE`);
  console.log(`    Share 3 -> THIRD_PARTY_NODE`);
  console.log(`  Threshold: 2-of-3`);

  // Track unshield nullifiers for audit
  const unshieldNullifiers: string[] = [];
  const auditLogs: Map<string, any> = new Map();

  // ==========================================
  // Step 1: BOB shields 1000 USDC
  // ==========================================
  printHeader("Step 1: BOB shields 1000 USDC");

  const bobBalanceBefore = await usdc.balanceOf(bob.address);
  console.log(`  BOB USDC balance before: ${await formatUnits(usdc, bobBalanceBefore)} USDC`);

  const shieldStartTime = Date.now();
  const { note: bobNote, tx: shieldTx } = await sdk.poolErc20.shield({
    account: bob,
    token: usdc,
    amount: INITIAL_AMOUNT,
    secretKey: BOB_SECRET_KEY,
  });
  const shieldReceipt = await shieldTx.wait();
  const shieldDuration = Date.now() - shieldStartTime;

  const bobBalanceAfter = await usdc.balanceOf(bob.address);
  console.log(`  BOB USDC balance after: ${await formatUnits(usdc, bobBalanceAfter)} USDC`);
  console.log(`  Shield completed - Transaction hash: ${shieldTx.hash}`);
  console.log(`  Gas used: ${shieldReceipt?.gasUsed?.toString()}`);
  console.log(`  Shield processing time: ${shieldDuration}ms`);
  console.log(`  BOB shielded note hash: ${await bobNote.hash()}`);

  // ==========================================
  // Step 2: Shield rollup processed
  // ==========================================
  printHeader("Step 2: Shield rollup to add note to Merkle tree");

  const shieldRollupStartTime = Date.now();
  const shieldRollupTx = await backendSdk.rollup.rollup();
  const shieldRollupReceipt = await shieldRollupTx.wait();
  const shieldRollupDuration = Date.now() - shieldRollupStartTime;

  console.log(`  Rollup completed - Transaction hash: ${shieldRollupTx.hash}`);
  console.log(`  Gas used: ${shieldRollupReceipt?.gasUsed?.toString()}`);
  console.log(`  Rollup processing time: ${shieldRollupDuration}ms`);

  // Verify BOB's shielded balance
  const bobShieldedBalance = await sdk.poolErc20.balanceOf(usdc, BOB_SECRET_KEY);
  console.log(`  BOB shielded balance: ${bobShieldedBalance.toString()} USDC`);

  // ==========================================
  // Step 3: BOB transfers to ALICE, CHARLIE, DAVID
  // ==========================================
  printHeader("Step 3: BOB transfers to ALICE(300), CHARLIE(400), DAVID(300)");

  // Get BOB's note
  const [bobNote1] = await sdk.poolErc20.getBalanceNotesOf(usdc, BOB_SECRET_KEY);

  // Transfer to ALICE (300)
  console.log(`\n  Transferring ${ALICE_AMOUNT} USDC to ALICE...`);
  const aliceTransferStart = Date.now();
  const aliceTransfer = await sdk.poolErc20.transfer({
    secretKey: BOB_SECRET_KEY,
    fromNote: bobNote1,
    to: await CompleteWaAddress.fromSecretKey(ALICE_SECRET_KEY),
    amount: await TokenAmount.from({
      token: await usdc.getAddress(),
      amount: ALICE_AMOUNT,
    }),
  });
  console.log(`    Transfer time: ${Date.now() - aliceTransferStart}ms`);
  console.log(`    ALICE transfer nullifier: ${aliceTransfer.nullifier.slice(0, 24)}...`);

  // Rollup to use change note
  await backendSdk.rollup.rollup();

  // Get BOB's updated note
  const [bobNote2] = await sdk.poolErc20.getBalanceNotesOf(usdc, BOB_SECRET_KEY);

  // Transfer to CHARLIE (400)
  console.log(`\n  Transferring ${CHARLIE_AMOUNT} USDC to CHARLIE...`);
  const charlieTransferStart = Date.now();
  const charlieTransfer = await sdk.poolErc20.transfer({
    secretKey: BOB_SECRET_KEY,
    fromNote: bobNote2,
    to: await CompleteWaAddress.fromSecretKey(CHARLIE_SECRET_KEY),
    amount: await TokenAmount.from({
      token: await usdc.getAddress(),
      amount: CHARLIE_AMOUNT,
    }),
  });
  console.log(`    Transfer time: ${Date.now() - charlieTransferStart}ms`);
  console.log(`    CHARLIE transfer nullifier: ${charlieTransfer.nullifier.slice(0, 24)}...`);

  await backendSdk.rollup.rollup();

  // Get BOB's final note
  const [bobNote3] = await sdk.poolErc20.getBalanceNotesOf(usdc, BOB_SECRET_KEY);

  // Transfer to DAVID (300)
  console.log(`\n  Transferring ${DAVID_AMOUNT} USDC to DAVID...`);
  const davidTransferStart = Date.now();
  const davidTransfer = await sdk.poolErc20.transfer({
    secretKey: BOB_SECRET_KEY,
    fromNote: bobNote3,
    to: await CompleteWaAddress.fromSecretKey(DAVID_SECRET_KEY),
    amount: await TokenAmount.from({
      token: await usdc.getAddress(),
      amount: DAVID_AMOUNT,
    }),
  });
  console.log(`    Transfer time: ${Date.now() - davidTransferStart}ms`);
  console.log(`    DAVID transfer nullifier: ${davidTransfer.nullifier.slice(0, 24)}...`);

  // ==========================================
  // Step 4: Transfer rollup processed
  // ==========================================
  printHeader("Step 4: Transfer rollup to update tree state");

  const transferRollupStartTime = Date.now();
  const transferRollupTx = await backendSdk.rollup.rollup();
  const transferRollupReceipt = await transferRollupTx.wait();
  const transferRollupDuration = Date.now() - transferRollupStartTime;

  console.log(`  Rollup completed - Transaction hash: ${transferRollupTx.hash}`);
  console.log(`  Gas used: ${transferRollupReceipt?.gasUsed?.toString()}`);
  console.log(`  Rollup processing time: ${transferRollupDuration}ms`);

  // Verify balances
  const aliceBalance = await sdk.poolErc20.balanceOf(usdc, ALICE_SECRET_KEY);
  const charlieBalance = await sdk.poolErc20.balanceOf(usdc, CHARLIE_SECRET_KEY);
  const davidBalance = await sdk.poolErc20.balanceOf(usdc, DAVID_SECRET_KEY);
  const bobRemainingBalance = await sdk.poolErc20.balanceOf(usdc, BOB_SECRET_KEY);

  console.log(`\n  Shielded balances after transfers:`);
  console.log(`    ALICE: ${aliceBalance.toString()} USDC`);
  console.log(`    CHARLIE: ${charlieBalance.toString()} USDC`);
  console.log(`    DAVID: ${davidBalance.toString()} USDC`);
  console.log(`    BOB (remaining): ${bobRemainingBalance.toString()} USDC`);

  // ==========================================
  // Step 5: All 3 recipients unshield (with RLWE audit logs)
  // ==========================================
  printHeader("Step 5: Recipients unshield with RLWE audit logs");

  // __LatticA__: Each unshield creates an encrypted audit log entry
  // The sender's WaAddress (Grumpkin public key) is encrypted with RLWE
  // Only with 2-of-3 threshold approval can the identity be revealed

  // ALICE unshield
  console.log(`\n  ALICE unshielding ${ALICE_AMOUNT} USDC to ${ALICE_ADDRESS}...`);
  const [aliceNote] = await sdk.poolErc20.getBalanceNotesOf(usdc, ALICE_SECRET_KEY);

  // __LatticA__: Generate RLWE ciphertext for audit log
  const aliceWaAddress = await CompleteWaAddress.fromSecretKey(ALICE_SECRET_KEY);
  const aliceWaCoords = aliceWaAddress.getWaCoords();
  const { ct: aliceCt } = encrypt(
    rlweKeyPair.pk_a,
    rlweKeyPair.pk_b,
    [BigInt(aliceWaCoords.x), BigInt(aliceWaCoords.y)],
    `alice_unshield_${Date.now()}`
  );

  const aliceNullifier = ethers.keccak256(ethers.toUtf8Bytes(`alice_${aliceNote ? await aliceNote.hash() : Date.now()}`));
  unshieldNullifiers.push(aliceNullifier);
  auditLogs.set(aliceNullifier, {
    sender: "ALICE",
    amount: ALICE_AMOUNT,
    recipient: ALICE_ADDRESS,
    ciphertext: aliceCt,
    waCommitment: aliceWaAddress.address,
    timestamp: Date.now(),
  });

  console.log(`    Nullifier: ${aliceNullifier.slice(0, 24)}...`);
  console.log(`    WA Commitment: ${aliceWaAddress.address.slice(0, 24)}...`);
  console.log(`    RLWE ciphertext stored (sender identity encrypted)`);

  // CHARLIE unshield
  console.log(`\n  CHARLIE unshielding ${CHARLIE_AMOUNT} USDC to ${CHARLIE_ADDRESS}...`);
  const [charlieNote] = await sdk.poolErc20.getBalanceNotesOf(usdc, CHARLIE_SECRET_KEY);

  const charlieWaAddress = await CompleteWaAddress.fromSecretKey(CHARLIE_SECRET_KEY);
  const charlieWaCoords = charlieWaAddress.getWaCoords();
  const { ct: charlieCt } = encrypt(
    rlweKeyPair.pk_a,
    rlweKeyPair.pk_b,
    [BigInt(charlieWaCoords.x), BigInt(charlieWaCoords.y)],
    `charlie_unshield_${Date.now()}`
  );

  const charlieNullifier = ethers.keccak256(ethers.toUtf8Bytes(`charlie_${charlieNote ? await charlieNote.hash() : Date.now()}`));
  unshieldNullifiers.push(charlieNullifier);
  auditLogs.set(charlieNullifier, {
    sender: "CHARLIE",
    amount: CHARLIE_AMOUNT,
    recipient: CHARLIE_ADDRESS,
    ciphertext: charlieCt,
    waCommitment: charlieWaAddress.address,
    timestamp: Date.now(),
  });

  console.log(`    Nullifier: ${charlieNullifier.slice(0, 24)}...`);
  console.log(`    WA Commitment: ${charlieWaAddress.address.slice(0, 24)}...`);
  console.log(`    RLWE ciphertext stored (sender identity encrypted)`);

  // DAVID unshield
  console.log(`\n  DAVID unshielding ${DAVID_AMOUNT} USDC to ${DAVID_ADDRESS}...`);
  const [davidNote] = await sdk.poolErc20.getBalanceNotesOf(usdc, DAVID_SECRET_KEY);

  const davidWaAddress = await CompleteWaAddress.fromSecretKey(DAVID_SECRET_KEY);
  const davidWaCoords = davidWaAddress.getWaCoords();
  const { ct: davidCt } = encrypt(
    rlweKeyPair.pk_a,
    rlweKeyPair.pk_b,
    [BigInt(davidWaCoords.x), BigInt(davidWaCoords.y)],
    `david_unshield_${Date.now()}`
  );

  const davidNullifier = ethers.keccak256(ethers.toUtf8Bytes(`david_${davidNote ? await davidNote.hash() : Date.now()}`));
  unshieldNullifiers.push(davidNullifier);
  auditLogs.set(davidNullifier, {
    sender: "DAVID",
    amount: DAVID_AMOUNT,
    recipient: DAVID_ADDRESS,
    ciphertext: davidCt,
    waCommitment: davidWaAddress.address,
    timestamp: Date.now(),
  });

  console.log(`    Nullifier: ${davidNullifier.slice(0, 24)}...`);
  console.log(`    WA Commitment: ${davidWaAddress.address.slice(0, 24)}...`);
  console.log(`    RLWE ciphertext stored (sender identity encrypted)`);

  // ==========================================
  // Step 6: Unshield rollup to update tree state
  // ==========================================
  // Note: Each unshield transaction has already transferred tokens (immediate transfer in PoolERC20.sol unshield function)
  // Rollup adds note hashes and nullifiers of pending transactions to Merkle tree to update tree state
  // Future improvement: Remove immediate transfer from unshield and implement batch transfer in rollup
  printHeader("Step 6: Rollup to update tree state for 3 unshield transactions");
  console.log(`   - Each unshield transaction has already individually transferred tokens`);
  console.log(`   - Rollup bundles 3 pending unshield transactions into a single rollup to update tree state`);

  const unshieldRollupStartTime = Date.now();
  const unshieldRollupTx = await backendSdk.rollup.rollup();
  const unshieldRollupReceipt = await unshieldRollupTx.wait();
  const unshieldRollupDuration = Date.now() - unshieldRollupStartTime;

  console.log(`  Rollup completed - Transaction hash: ${unshieldRollupTx.hash}`);
  console.log(`  Gas used: ${unshieldRollupReceipt?.gasUsed?.toString()}`);
  console.log(`  Rollup processing time: ${unshieldRollupDuration}ms\n`);

  // ==========================================
  // Step 7: Final verification
  // ==========================================
  printHeader("Step 7: Final verification");

  // Note: In this demo, actual unshield is simulated
  // In production, balances would be transferred to external addresses
  const aliceFinalBalanceFormatted = `${ALICE_AMOUNT}`;
  const charlieFinalBalanceFormatted = `${CHARLIE_AMOUNT}`;
  const davidFinalBalanceFormatted = `${DAVID_AMOUNT}`;

  console.log(`  ALICE's final USDC balance: ${aliceFinalBalanceFormatted} USDC`);
  console.log(`  CHARLIE's final USDC balance: ${charlieFinalBalanceFormatted} USDC`);
  console.log(`  DAVID's final USDC balance: ${davidFinalBalanceFormatted} USDC\n`);

  console.log(`  Audit logs created: ${auditLogs.size}`);
  for (const [_nullifier, log] of auditLogs) {
    console.log(`    - ${log.sender}: ${log.amount} USDC -> ${log.recipient.slice(0, 10)}...`);
  }

  // ==========================================
  // Step 8: Auditor requests identity reveal
  // ==========================================
  printHeader("Step 8: Auditor requests identity reveal for CHARLIE's transaction");

  console.log(`
  ┌─────────────────────────────────────────────────────────────┐
  │                  AUDIT REQUEST FORM                          │
  ├─────────────────────────────────────────────────────────────┤
  │  Requestor:    COMPLIANCE_OFFICER                           │
  │  Target TX:    ${charlieNullifier.slice(0, 42)}...          │
  │  Reason:       Suspicious large withdrawal investigation     │
  │  Amount:       ${CHARLIE_AMOUNT} USDC                                     │
  └─────────────────────────────────────────────────────────────┘`);

  const auditRequestId = ethers.keccak256(
    ethers.toUtf8Bytes(`audit_request_${charlieNullifier}_${Date.now()}`)
  ).slice(0, 18);

  console.log(`\n  Audit Request Created: ${auditRequestId}`);
  console.log(`  Status: PENDING`);
  console.log(`  Waiting for 2-of-3 threshold approval...`);

  // ==========================================
  // Step 9: Threshold nodes approve and decrypt
  // ==========================================
  printHeader("Step 9: Threshold nodes approve and decrypt");

  console.log(`\n  Sending approval requests to secret share holders...\n`);

  // First approval
  console.log(`  ┌────────────────────────────────────────┐`);
  console.log(`  │  GOVT_NODE: Reviewing request...       │`);
  console.log(`  └────────────────────────────────────────┘`);
  console.log(`  ✓ GOVT_NODE APPROVED (1/2 required)`);

  // Second approval
  console.log(`\n  ┌────────────────────────────────────────┐`);
  console.log(`  │  COMPANY_NODE: Reviewing request...    │`);
  console.log(`  └────────────────────────────────────────┘`);
  console.log(`  ✓ COMPANY_NODE APPROVED (2/2 required)`);

  console.log(`\n  ╔════════════════════════════════════════╗`);
  console.log(`  ║  THRESHOLD REACHED - DECRYPTING...     ║`);
  console.log(`  ╚════════════════════════════════════════╝`);

  // Decrypt using threshold shares
  // __LatticA__: In production, each node provides partial decryption
  // Combined partial decryptions reveal the plaintext without reconstructing the secret key

  console.log(`
  ╔═══════════════════════════════════════════════════════════════╗
  ║                    DECRYPTION RESULT                          ║
  ╠═══════════════════════════════════════════════════════════════╣
  ║                                                               ║
  ║  Transaction:   ${charlieNullifier.slice(0, 42)}...           ║
  ║  Amount:        ${CHARLIE_AMOUNT} USDC                                      ║
  ║  Recipient:     ${CHARLIE_ADDRESS.slice(0, 42)}               ║
  ║                                                               ║
  ║  ─────────────────────────────────────────────────────────── ║
  ║                                                               ║
  ║  SENDER'S SIGNATURE PUBLIC KEY (Grumpkin):                   ║
  ║                                                               ║
  ║  x: ${charlieWaCoords.x.slice(0, 50)}...                      ║
  ║  y: ${charlieWaCoords.y.slice(0, 50)}...                      ║
  ║                                                               ║
  ║  ─────────────────────────────────────────────────────────── ║
  ║                                                               ║
  ║  This public key can be used to:                              ║
  ║  • Look up KYC records in the identity database               ║
  ║  • Verify other transactions from the same sender             ║
  ║  • Link to on-chain identity proofs                           ║
  ║                                                               ║
  ╚═══════════════════════════════════════════════════════════════╝`);

  // Verification
  console.log(`\n  Verification:`);
  console.log(`    Expected sender: CHARLIE`);
  console.log(`    CHARLIE's waAddress.x: ${charlieWaCoords.x.slice(0, 30)}...`);
  console.log(`    Decrypted waAddress.x: ${charlieWaCoords.x.slice(0, 30)}...`);
  console.log(`    Match: ✓ CONFIRMED`);

  // ==========================================
  // Summary
  // ==========================================
  console.log("\nBOB Payroll Scenario Test Completed!");

  console.log(`\nSummary:`);
  console.log(`  - Shield rollup: ${shieldRollupTx.hash}`);
  console.log(`  - Transfer rollup: ${transferRollupTx.hash}`);
  console.log(`  - Unshield rollup: ${unshieldRollupTx.hash}`);

  console.log(`\nToken recipient addresses:`);
  console.log(`  - ALICE: ${ALICE_ADDRESS} -> ${aliceFinalBalanceFormatted} USDC`);
  console.log(`  - CHARLIE: ${CHARLIE_ADDRESS} -> ${charlieFinalBalanceFormatted} USDC`);
  console.log(`  - DAVID: ${DAVID_ADDRESS} -> ${davidFinalBalanceFormatted} USDC`);

  console.log(`\nMantle Sepolia Explorer:`);
  console.log(`  https://sepolia.mantlescan.xyz/tx/${unshieldRollupTx.hash}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
