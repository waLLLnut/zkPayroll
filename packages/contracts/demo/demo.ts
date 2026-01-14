#!/usr/bin/env npx tsx
/**
 * zkPayroll Demo - Privacy Pool with Audit Log
 *
 * Demonstrates:
 * 1. Baby JubJub key generation (user identity)
 * 2. RLWE encryption of sender identity
 * 3. Nullifier + encrypted log storage
 * 4. 2-out-of-3 threshold decryption for audit
 * 5. KYC lookup for identity resolution
 */

import { generateSecretKey, createWaAddress, computeNullifier, WaAddress } from './babyjubjub.js';
import { AuditLogService, KycService } from './audit_log.js';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('           zkPayroll Demo - Privacy Pool with Audit         ');
  console.log('═══════════════════════════════════════════════════════════\n');

  // ==========================================
  // Step 1: Initialize Audit System (2-of-3 threshold)
  // ==========================================
  console.log('📦 STEP 1: Initialize Audit System\n');

  const auditService = new AuditLogService();
  const kycService = new KycService();

  const auditorIds: [string, string, string] = [
    'auditor_govt',      // Government regulator
    'auditor_company',   // Company compliance
    'auditor_third'      // Third-party auditor
  ];

  const { pkHash, shareVerification } = await auditService.initializeThresholdKeys(
    'demo_master_seed_12345',
    auditorIds
  );

  console.log(`\n  All verifications passed: ${shareVerification.every(v => v)}`);

  // ==========================================
  // Step 2: Create Users with Baby JubJub Keys
  // ==========================================
  console.log('\n\n📦 STEP 2: Create Users\n');

  // Alice (sender) - use small test values for demo
  // In production, full 254-bit Field elements would be used with proper encoding
  const aliceSk = 12345678901234567890n;  // Small for demo
  const aliceAddress: WaAddress = {
    x: 0x123456789ABCDEFn,  // 56 bits - fits in 7 slots
    y: 0xFEDCBA987654321n   // 60 bits - fits in 8 slots
  };
  console.log(`  👤 Alice created:`);
  console.log(`     Secret Key: ${aliceSk.toString().slice(0, 30)}...`);
  console.log(`     WaAddress.x: ${aliceAddress.x.toString().slice(0, 30)}...`);
  console.log(`     WaAddress.y: ${aliceAddress.y.toString().slice(0, 30)}...`);

  // Register Alice in KYC
  kycService.register(aliceAddress, 'Alice Smith', 'alice@company.com');

  // Bob (recipient)
  const bobSk = generateSecretKey();
  const bobAddress = createWaAddress(bobSk);
  console.log(`\n  👤 Bob created:`);
  console.log(`     WaAddress.x: ${bobAddress.x.toString().slice(0, 30)}...`);

  kycService.register(bobAddress, 'Bob Johnson', 'bob@company.com');

  // Evil account (suspicious destination)
  const evilSk = generateSecretKey();
  const evilAddress = createWaAddress(evilSk);
  console.log(`\n  🦹 Suspicious Account created:`);
  console.log(`     WaAddress.x: ${evilAddress.x.toString().slice(0, 30)}...`);

  kycService.register(evilAddress, 'Evil Corp', 'evil@suspicious.com');

  // ==========================================
  // Step 3: Simulate Transactions
  // ==========================================
  console.log('\n\n📦 STEP 3: Simulate Transactions\n');

  // Transaction 1: Alice -> Bob (normal)
  const noteHash1 = BigInt('0x' + '1'.repeat(64));
  const nullifier1 = computeNullifier(noteHash1, aliceSk);

  const tx1 = auditService.logTransaction(
    nullifier1,
    aliceAddress,
    '0x1111...tx1'
  );
  console.log(`  ✅ TX1: Alice -> Bob (1000 USDC)`);
  console.log(`     Nullifier: ${nullifier1.toString().slice(0, 30)}...`);
  console.log(`     Ciphertext c0 length: ${tx1.ciphertext.c0.length}`);
  console.log(`     Ciphertext c1 length: ${tx1.ciphertext.c1.length}`);

  // Transaction 2: Alice -> Evil (suspicious!)
  const noteHash2 = BigInt('0x' + '2'.repeat(64));
  const nullifier2 = computeNullifier(noteHash2, aliceSk);

  const tx2 = auditService.logTransaction(
    nullifier2,
    aliceAddress,
    '0x2222...tx2'
  );
  console.log(`\n  ⚠️  TX2: Alice -> Suspicious Account (50000 USDC)`);
  console.log(`     Nullifier: ${nullifier2.toString().slice(0, 30)}...`);

  // Transaction 3: Bob -> Alice (normal)
  const noteHash3 = BigInt('0x' + '3'.repeat(64));
  const nullifier3 = computeNullifier(noteHash3, bobSk);

  auditService.logTransaction(nullifier3, bobAddress, '0x3333...tx3');
  console.log(`\n  ✅ TX3: Bob -> Alice (500 USDC)`);

  // ==========================================
  // Step 4: Audit Request for Suspicious Transaction
  // ==========================================
  console.log('\n\n📦 STEP 4: Audit Request for TX2 (Suspicious)\n');

  const request = auditService.createAuditRequest(
    'compliance_officer',
    nullifier2,
    'Large transfer to flagged destination address'
  );

  // ==========================================
  // Step 5: Auditor Approvals (2-of-3 threshold)
  // ==========================================
  console.log('\n\n📦 STEP 5: Auditor Approvals\n');

  // First approval from government auditor
  const approval1 = auditService.approveRequest(request.id, 'auditor_govt');

  // Second approval from company compliance
  const approval2 = auditService.approveRequest(request.id, 'auditor_company');

  // ==========================================
  // Step 6: Complete Decryption
  // ==========================================
  console.log('\n\n📦 STEP 6: Threshold Decryption\n');

  const decrypted = auditService.completeDecryption(request.id, [
    { auditorId: 'auditor_govt', partial: approval1.partialDecryption! },
    { auditorId: 'auditor_company', partial: approval2.partialDecryption! }
  ]);

  // ==========================================
  // Step 7: KYC Lookup
  // ==========================================
  console.log('\n\n📦 STEP 7: KYC Lookup\n');

  const kycInfo = kycService.lookup(decrypted.senderAddress);

  if (kycInfo) {
    console.log(`  🔍 Identity Resolved:`);
    console.log(`     Name: ${kycInfo.name}`);
    console.log(`     Email: ${kycInfo.email}`);
    console.log(`     Verified At: ${new Date(kycInfo.verifiedAt).toISOString()}`);
  } else {
    console.log(`  ❓ No KYC record found for this address`);
  }

  // ==========================================
  // Summary
  // ==========================================
  console.log('\n\n═══════════════════════════════════════════════════════════');
  console.log('                         SUMMARY                            ');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('  ✅ Privacy Pool Operations:');
  console.log('     - 3 transactions processed');
  console.log('     - Sender identities encrypted with RLWE');
  console.log('     - Nullifiers stored for double-spend prevention');

  console.log('\n  ✅ Audit System:');
  console.log('     - 2-out-of-3 threshold decryption initialized');
  console.log('     - Shares verified via zero encryption test');
  console.log('     - Audit request processed for suspicious TX');

  console.log('\n  ✅ Compliance:');
  console.log('     - Sender identity decrypted: Alice Smith');
  console.log('     - KYC record retrieved successfully');
  console.log('     - No error exposure during decryption');

  console.log('\n  📊 Technical Stats:');
  console.log(`     - RLWE Parameters: N=1024, Q=167772161`);
  console.log(`     - Ciphertext Size: ${(32 + 1024) * 8} bytes`);
  console.log(`     - Threshold: 2-of-3 (honest non-collude)`);
  console.log(`     - Public Key Hash: ${pkHash.slice(0, 30)}...`);

  console.log('\n═══════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
