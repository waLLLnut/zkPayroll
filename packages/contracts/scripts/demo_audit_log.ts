#!/usr/bin/env npx tsx
/**
 * Demo script for AuditLog contract interaction
 *
 * This script demonstrates:
 * 1. Storing an RLWE-encrypted sender identity
 * 2. Creating an audit request
 * 3. Approving the request (2-of-3 threshold)
 * 4. Retrieving the encrypted data for decryption
 */

import { ethers } from "hardhat";
import { AuditLog } from "../typechain-types";

// Import RLWE crypto from demo folder
import {
  generateKeyPair,
  encrypt,
  splitSecretKey,
  partialDecrypt,
  combinePartialDecryptions,
  serializeCiphertext,
  RLWE_N,
  RLWE_MESSAGE_SLOTS,
} from "../demo/rlwe_crypto.js";

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("        AuditLog Contract Demo - Testnet Interaction        ");
  console.log("═══════════════════════════════════════════════════════════\n");

  // Get deployed contract
  const auditLog = await ethers.getContract<AuditLog>("AuditLog");
  console.log(`📍 AuditLog Contract: ${await auditLog.getAddress()}`);

  const [deployer] = await ethers.getSigners();
  console.log(`👤 Deployer/Auditor: ${deployer.address}\n`);

  // ==========================================
  // Step 1: Generate RLWE keys and encrypt a message
  // ==========================================
  console.log("📦 STEP 1: Generate RLWE Encryption\n");

  const keyPair = generateKeyPair("testnet_demo_seed_001");
  const shares = splitSecretKey(keyPair.sk, "testnet_shares_001");

  // Demo message: Baby JubJub public key (sender identity)
  const senderPubKey: [bigint, bigint] = [
    0x123456789ABCDEFn,  // x coordinate
    0xFEDCBA987654321n   // y coordinate
  ];

  console.log(`  Sender PK (x): 0x${senderPubKey[0].toString(16)}`);
  console.log(`  Sender PK (y): 0x${senderPubKey[1].toString(16)}`);

  const { ct } = encrypt(
    keyPair.pk_a,
    keyPair.pk_b,
    senderPubKey,
    "testnet_enc_001"
  );

  // Convert ciphertext to bytes for contract
  const c0Bytes = ct.c0.map(v => ethers.zeroPadValue(ethers.toBeHex(v), 32));
  const c1Bytes = ct.c1.map(v => ethers.zeroPadValue(ethers.toBeHex(v), 32));
  const ciphertextBytes = ethers.concat([...c0Bytes, ...c1Bytes]);

  console.log(`\n  Ciphertext c0 length: ${ct.c0.length}`);
  console.log(`  Ciphertext c1 length: ${ct.c1.length}`);
  console.log(`  Total bytes: ${ciphertextBytes.length}`);

  // ==========================================
  // Step 2: Store in AuditLog contract
  // ==========================================
  console.log("\n📦 STEP 2: Store Encrypted Identity in Contract\n");

  const nullifier = ethers.keccak256(
    ethers.toUtf8Bytes("demo_tx_nullifier_001")
  );
  const txHash = ethers.keccak256(
    ethers.toUtf8Bytes("demo_tx_hash_001")
  );

  console.log(`  Nullifier: ${nullifier.slice(0, 30)}...`);
  console.log(`  TX Hash: ${txHash.slice(0, 30)}...`);

  try {
    const tx = await auditLog.storeAuditLog(nullifier, ciphertextBytes, txHash);
    await tx.wait();
    console.log(`  ✅ Stored successfully! TX: ${tx.hash.slice(0, 30)}...`);
  } catch (e: any) {
    if (e.message.includes("already exists")) {
      console.log(`  ⚠️ Audit log already exists (from previous run)`);
    } else {
      throw e;
    }
  }

  // ==========================================
  // Step 3: Create Audit Request
  // ==========================================
  console.log("\n📦 STEP 3: Create Audit Request\n");

  const reason = "Suspicious transaction to flagged address";
  let requestId: string;

  try {
    const tx = await auditLog.createAuditRequest(nullifier, reason);
    const receipt = await tx.wait();

    // Get requestId from event
    const event = receipt?.logs.find(
      (log: any) => log.fragment?.name === "AuditRequestCreated"
    );
    requestId = (event as any)?.args?.[0] || ethers.keccak256(
      ethers.concat([nullifier, deployer.address, ethers.toBeHex(Date.now())])
    );

    console.log(`  Request ID: ${requestId.slice(0, 30)}...`);
    console.log(`  Reason: ${reason}`);
    console.log(`  ✅ Request created! TX: ${tx.hash.slice(0, 30)}...`);
  } catch (e: any) {
    // If request already exists, get the last one
    const count = await auditLog.getRequestCount();
    requestId = await auditLog.requestIds(count - 1n);
    console.log(`  ⚠️ Using existing request: ${requestId.slice(0, 30)}...`);
  }

  // ==========================================
  // Step 4: Approve Request (Threshold: 2-of-3)
  // ==========================================
  console.log("\n📦 STEP 4: Auditor Approvals (2-of-3)\n");

  // In demo, deployer is all 3 auditors
  // In production, 2 different auditors would approve
  try {
    const reqBefore = await auditLog.getAuditRequest(requestId);
    console.log(`  Current approvals: ${reqBefore.approvalCount}/2`);

    if (!reqBefore.completed) {
      // First approval
      console.log(`\n  🔐 Approval 1 (Government Auditor)...`);
      const tx1 = await auditLog.approveAuditRequest(requestId);
      await tx1.wait();
      console.log(`     ✅ Approved!`);

      // In production, a second auditor would approve
      // For demo with single deployer, we can't add more approvals
      console.log(`\n  ⚠️ Demo mode: Single deployer = 1 approval only`);
      console.log(`     In production, 2 different auditors would approve`);
    } else {
      console.log(`  ✅ Request already completed`);
    }
  } catch (e: any) {
    if (e.message.includes("Already approved")) {
      console.log(`  ⚠️ Already approved by this auditor`);
    } else {
      console.log(`  ⚠️ ${e.message}`);
    }
  }

  // ==========================================
  // Step 5: Show Contract State
  // ==========================================
  console.log("\n📦 STEP 5: Contract State\n");

  const pkHash = await auditLog.rlwePublicKeyHash();
  const ctSize = await auditLog.RLWE_CT_SIZE();
  const requestCount = await auditLog.getRequestCount();

  console.log(`  RLWE PK Hash: ${pkHash.slice(0, 30)}...`);
  console.log(`  CT Size: ${ctSize} Field elements`);
  console.log(`  Total Requests: ${requestCount}`);

  // ==========================================
  // Summary
  // ==========================================
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("                        SUMMARY                             ");
  console.log("═══════════════════════════════════════════════════════════\n");

  console.log("  ✅ Contract Interaction Complete:");
  console.log("     - RLWE ciphertext stored on-chain");
  console.log("     - Audit request created");
  console.log("     - Approval process demonstrated");
  console.log("\n  📊 On-chain Data:");
  console.log(`     - Nullifier: ${nullifier.slice(0, 20)}...`);
  console.log(`     - Ciphertext size: ${ciphertextBytes.length} bytes`);
  console.log(`     - Threshold: 2-of-3 required`);

  console.log("\n═══════════════════════════════════════════════════════════\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
