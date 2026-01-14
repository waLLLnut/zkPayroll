#!/usr/bin/env npx tsx
/**
 * Test RLWE encryption/decryption
 */

import { generateKeyPair, encrypt, decrypt, splitSecretKey, partialDecrypt, combinePartialDecryptions } from './rlwe_crypto.js';

async function main() {
  console.log('=== RLWE Crypto Test ===\n');

  // 1. Generate key pair
  const keyPair = generateKeyPair('test_seed_123');
  console.log('Key pair generated');
  console.log(`  pk_a[0]: ${keyPair.pk_a[0]}`);
  console.log(`  pk_b[0]: ${keyPair.pk_b[0]}`);
  console.log(`  sk[0]: ${keyPair.sk[0]}`);

  // 2. Test message (small values that fit in 128 bits)
  const message: [bigint, bigint] = [
    0x123456789ABCDEFn,  // 56 bits
    0xFEDCBA987654321n   // 60 bits
  ];
  console.log(`\nOriginal message:`);
  console.log(`  x: ${message[0]} (0x${message[0].toString(16)})`);
  console.log(`  y: ${message[1]} (0x${message[1].toString(16)})`);

  // 3. Encrypt
  const { ct, witness } = encrypt(keyPair.pk_a, keyPair.pk_b, message, 'enc_seed_456');
  console.log(`\nEncrypted:`);
  console.log(`  c0.length: ${ct.c0.length}`);
  console.log(`  c1.length: ${ct.c1.length}`);
  console.log(`  c0[0]: ${ct.c0[0]}`);

  // 4. Single-party decrypt
  const decrypted = decrypt(keyPair.sk, ct);
  console.log(`\nSingle-party decrypted:`);
  console.log(`  x: ${decrypted[0]} (0x${decrypted[0].toString(16)})`);
  console.log(`  y: ${decrypted[1]} (0x${decrypted[1].toString(16)})`);
  console.log(`  Match: ${decrypted[0] === message[0] && decrypted[1] === message[1]}`);

  // 5. Threshold decrypt (2-of-3)
  console.log(`\n=== Threshold Decryption Test ===`);
  const shares = splitSecretKey(keyPair.sk, 'share_seed_789');
  console.log(`Shares created: ${shares.length}`);

  const partial1 = partialDecrypt(shares[0], ct);
  const partial2 = partialDecrypt(shares[1], ct);
  console.log(`Partial decryptions computed`);

  const thresholdDecrypted = combinePartialDecryptions(
    [
      { index: shares[0].index, partial: partial1 },
      { index: shares[1].index, partial: partial2 }
    ],
    ct
  );
  console.log(`\nThreshold decrypted:`);
  console.log(`  x: ${thresholdDecrypted[0]} (0x${thresholdDecrypted[0].toString(16)})`);
  console.log(`  y: ${thresholdDecrypted[1]} (0x${thresholdDecrypted[1].toString(16)})`);
  console.log(`  Match: ${thresholdDecrypted[0] === message[0] && thresholdDecrypted[1] === message[1]}`);

  // 6. Test with zero message
  console.log(`\n=== Zero Message Test ===`);
  const { ct: ctZero } = encrypt(keyPair.pk_a, keyPair.pk_b, [0n, 0n], 'zero_enc');
  const decZero = decrypt(keyPair.sk, ctZero);
  console.log(`Zero decrypt: x=${decZero[0]}, y=${decZero[1]}`);
  console.log(`Match: ${decZero[0] === 0n && decZero[1] === 0n}`);
}

main().catch(console.error);
