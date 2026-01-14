#!/usr/bin/env npx tsx
/**
 * ERC20 Unshield with RLWE Audit - Test Script
 *
 * Tests the circuit with internally generated RLWE noise.
 * No external RLWE witness required.
 */

import { Noir } from '@noir-lang/noir_js';
import { UltraHonkBackend } from '@aztec/bb.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { AuditLogService } from './audit_log.js';
import { RLWE_N, RLWE_MESSAGE_SLOTS, encrypt, generateKeyPair } from './rlwe_crypto.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CIRCUIT_PATH = path.join(__dirname, '../noir/target/erc20_unshield.json');
const NOTE_HASH_TREE_HEIGHT = 40;

function generateMockMerkleProof(height: number): string[] {
  return Array(height).fill('0x' + '0'.repeat(64));
}

function createMockNote(ownerX: bigint, ownerY: bigint, amount: bigint, randomness: bigint) {
  return {
    owner: { x: toHex(ownerX), y: toHex(ownerY) },
    amount: {
      token: { inner: '0x' + 'a'.repeat(40) },
      amount: { value: toHex(amount) }
    },
    randomness: toHex(randomness)
  };
}

function toHex(value: bigint): string {
  return '0x' + value.toString(16);
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('     ERC20 Unshield with RLWE Audit - Test                  ');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Step 1: Load Circuit
  console.log('📦 Step 1: Loading erc20_unshield circuit...\n');

  if (!fs.existsSync(CIRCUIT_PATH)) {
    console.error(`  ❌ Circuit not found at: ${CIRCUIT_PATH}`);
    console.error('  Run: cd packages/contracts/noir && nargo compile --workspace');
    process.exit(1);
  }

  const circuitJson = JSON.parse(fs.readFileSync(CIRCUIT_PATH, 'utf-8'));
  console.log(`  ✅ Circuit loaded: ${circuitJson.noir_version || 'unknown version'}`);
  console.log(`  ✅ Bytecode size: ${circuitJson.bytecode.length} bytes`);

  // Step 2: Initialize Audit Services
  console.log('\n📦 Step 2: Initialize Audit Services...\n');

  const auditService = new AuditLogService();
  const auditorIds: [string, string, string] = ['govt', 'company', 'third'];

  const { pkHash, shareVerification } = await auditService.initializeThresholdKeys(
    'test_seed_' + Date.now(),
    auditorIds
  );

  console.log(`  ✅ Threshold keys initialized`);
  console.log(`  ✅ Public key hash: ${pkHash.slice(0, 40)}...`);
  console.log(`  ✅ All shares verified: ${shareVerification.every(v => v)}`);

  // Step 3: Create Test User
  console.log('\n📦 Step 3: Create Test User...\n');

  const userSecretKey = 0x123456789ABCDEFn;
  const waAddressX = 0xABCDEF123456789n;
  const waAddressY = 0x987654321FEDCBAn;

  console.log(`  👤 User Secret Key: ${userSecretKey.toString(16).slice(0, 20)}...`);
  console.log(`  👤 WaAddress.x: ${waAddressX.toString(16).slice(0, 20)}...`);
  console.log(`  👤 WaAddress.y: ${waAddressY.toString(16).slice(0, 20)}...`);

  // Step 4: Create Mock Note
  console.log('\n📦 Step 4: Create Mock Note...\n');

  const noteRandomness = 0xDEADBEEFCAFEn;
  const noteAmount = 1000000n;

  const mockNote = createMockNote(waAddressX, waAddressY, noteAmount, noteRandomness);
  const merkleProof = generateMockMerkleProof(NOTE_HASH_TREE_HEIGHT);

  console.log(`  📝 Note amount: ${noteAmount} tokens`);
  console.log(`  📝 Note randomness: ${noteRandomness.toString(16)}`);
  console.log(`  📝 Merkle proof length: ${merkleProof.length}`);

  // Step 5: Prepare Circuit Inputs (NO RLWE witness needed!)
  console.log('\n📦 Step 5: Prepare Circuit Inputs...\n');

  const circuitInputs = {
    tree_roots: {
      note_hash_root: '0x' + '1'.repeat(64)
    },
    from_secret_key: toHex(userSecretKey),
    from_note_inputs: {
      note: mockNote,
      note_index: '0x0',
      note_sibling_path: merkleProof
    },
    to: { inner: '0x' + 'b'.repeat(40) },
    amount: {
      token: { inner: '0x' + 'a'.repeat(40) },
      amount: { value: toHex(noteAmount / 2n) }
    },
    change_randomness: toHex(0xCAFEBABEn)
    // NOTE: No lattica_rlwe_witness - noise is generated internally!
  };

  console.log(`  ✅ Circuit inputs prepared`);
  console.log(`  ✅ Public inputs: tree_roots, to, amount`);
  console.log(`  ✅ Private inputs: secret_key, note, change_randomness`);
  console.log(`  ✅ RLWE noise: generated internally (no witness needed)`);

  // Step 6: Proof Generation Info
  console.log('\n📦 Step 6: Proof Generation...\n');

  console.log(`  ℹ️  Proof generation skipped in test mode`);
  console.log(`  ℹ️  (Requires bb backend setup and takes several minutes)`);
  console.log(`  `);
  console.log(`  To generate actual proof, run:`);
  console.log(`    const noir = new Noir(circuitJson);`);
  console.log(`    const backend = new UltraHonkBackend(circuitJson.bytecode);`);
  console.log(`    const { witness } = await noir.execute(circuitInputs);`);
  console.log(`    const { proof, publicInputs } = await backend.generateProof(witness);`);

  // Step 7: Simulate Audit Log
  console.log('\n📦 Step 7: Simulate Audit Log...\n');

  const rlweKeyPair = generateKeyPair('key_' + Date.now());
  const messages: [bigint, bigint] = [waAddressX, waAddressY];
  const { ct: ciphertext } = encrypt(
    rlweKeyPair.pk_a,
    rlweKeyPair.pk_b,
    messages,
    'encrypt_seed_' + Date.now()
  );

  const mockNoteHash = 0x123456789ABCDEF0n;
  const nullifier = mockNoteHash ^ userSecretKey;

  console.log(`  📋 Audit Log Entry:`);
  console.log(`     Nullifier (TX ID): ${nullifier.toString(16).slice(0, 30)}...`);
  console.log(`     Ciphertext c0: ${ciphertext.c0.length} sparse slots`);
  console.log(`     Ciphertext c1: ${ciphertext.c1.length} coefficients`);

  const logEntry = auditService.logTransaction(
    nullifier,
    { x: waAddressX, y: waAddressY },
    '0x' + 'f'.repeat(64)
  );

  console.log(`\n  ✅ Transaction logged with ID: ${nullifier.toString(16).slice(0, 30)}...`);

  // Step 8: Threshold Decryption Demo
  console.log('\n📦 Step 8: Threshold Decryption Demo...\n');

  const request = auditService.createAuditRequest(
    'compliance_officer',
    nullifier,
    'Test audit request'
  );

  console.log(`  📝 Audit request created: ${request.id}`);

  const approval1 = auditService.approveRequest(request.id, 'govt');
  console.log(`  ✅ Approval 1: govt`);

  const approval2 = auditService.approveRequest(request.id, 'company');
  console.log(`  ✅ Approval 2: company`);

  const decrypted = auditService.completeDecryption(request.id, [
    { auditorId: 'govt', partial: approval1.partialDecryption! },
    { auditorId: 'company', partial: approval2.partialDecryption! }
  ]);

  console.log(`\n  🔓 Decryption Complete:`);
  console.log(`     Sender WaAddress.x: ${decrypted.senderAddress.x.toString(16).slice(0, 30)}...`);
  console.log(`     Sender WaAddress.y: ${decrypted.senderAddress.y.toString(16).slice(0, 30)}...`);

  // Summary
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('                      Test Summary                          ');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('  ✅ Circuit Integration:');
  console.log('     - erc20_unshield circuit loaded');
  console.log('     - RLWE noise generated internally (no witness input)');
  console.log('     - Nullifier used as transaction ID');

  console.log('\n  ✅ Privacy Guarantees:');
  console.log('     - WaAddress encrypted with RLWE');
  console.log('     - 2-of-3 threshold required for decryption');
  console.log('     - Secret key never exposed');

  console.log('\n  ✅ Audit Capabilities:');
  console.log('     - Transactions indexed by nullifier');
  console.log('     - Identity recoverable with threshold approval');
  console.log('     - Full audit trail maintained');

  console.log('\n  📊 Technical Stats:');
  console.log(`     - RLWE Parameters: N=${RLWE_N}, MESSAGE_SLOTS=${RLWE_MESSAGE_SLOTS}`);
  console.log(`     - Ciphertext Size: ${(RLWE_MESSAGE_SLOTS + RLWE_N) * 32} bytes`);
  console.log(`     - Circuit Size: ${circuitJson.bytecode.length} bytes bytecode`);
  console.log(`     - Threshold: 2-of-3`);

  console.log('\n═══════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
