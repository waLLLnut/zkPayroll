#!/usr/bin/env npx tsx
/**
 * Test RLWE with Delta scaling
 */

import { createHash } from 'crypto';

const RLWE_N = 1024;
const RLWE_Q = 167772161n;
const PLAINTEXT_MOD = 256n;  // 8-bit slots
const DELTA = RLWE_Q / PLAINTEXT_MOD;  // ~655360

console.log(`DELTA = Q / t = ${DELTA}`);

function mod(a: bigint, m: bigint): bigint {
  return ((a % m) + m) % m;
}

function shake256(seed: string, length: number): Uint8Array {
  const hash = createHash('sha3-256');
  hash.update(seed);
  const digest = hash.digest();
  const result = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    result[i] = digest[i % digest.length] ^ (i / digest.length | 0);
  }
  return result;
}

function sampleSmall(seed: string, n: number): bigint[] {
  const bytes = shake256(seed, n);
  return Array.from(bytes).map(b => {
    const signed = b >= 128 ? BigInt(b) - 256n : BigInt(b);
    return mod(signed, RLWE_Q);
  });
}

function sampleUniform(seed: string, n: number): bigint[] {
  const bytes = shake256(seed, n * 4);
  const result: bigint[] = [];
  for (let i = 0; i < n; i++) {
    let val = 0n;
    for (let j = 0; j < 4; j++) {
      val = val * 256n + BigInt(bytes[i * 4 + j]);
    }
    result.push(mod(val, RLWE_Q));
  }
  return result;
}

function negacyclicMul(a: bigint[], b: bigint[]): bigint[] {
  const result = new Array(RLWE_N).fill(0n);
  for (let i = 0; i < RLWE_N; i++) {
    for (let j = 0; j < RLWE_N; j++) {
      const idx = i + j;
      const prod = mod(a[i] * b[j], RLWE_Q);
      if (idx < RLWE_N) {
        result[idx] = mod(result[idx] + prod, RLWE_Q);
      } else {
        result[idx - RLWE_N] = mod(result[idx - RLWE_N] - prod, RLWE_Q);
      }
    }
  }
  return result;
}

function polyAdd(a: bigint[], b: bigint[]): bigint[] {
  return a.map((v, i) => mod(v + b[i], RLWE_Q));
}

function polySub(a: bigint[], b: bigint[]): bigint[] {
  return a.map((v, i) => mod(v - b[i], RLWE_Q));
}

function round(x: bigint, divisor: bigint): bigint {
  // Round to nearest integer
  return (x + divisor / 2n) / divisor;
}

async function main() {
  console.log('\n=== RLWE with Delta Scaling ===\n');

  // Key generation
  const pk_a = sampleUniform('test_a', RLWE_N);
  const sk = sampleSmall('test_sk', RLWE_N);
  const e_pk = sampleSmall('test_e_pk', RLWE_N);
  const pk_b = polyAdd(negacyclicMul(pk_a, sk), e_pk);

  // Message (8-bit values)
  const m = [42n, 100n, 255n, 0n, 128n];
  console.log(`Original message: [${m.join(', ')}]`);

  // Scale message by DELTA
  const m_scaled = m.map(v => mod(v * DELTA, RLWE_Q));
  console.log(`Scaled message: [${m_scaled.slice(0, 5).map(v => v.toString()).join(', ')}...]`);

  // Encryption randomness
  const r = sampleSmall('test_r', RLWE_N);
  const e1 = sampleSmall('test_e1', RLWE_N);
  const e2 = sampleSmall('test_e2', RLWE_N);

  // c0 = b*r + e1 + m*Δ
  const br = negacyclicMul(pk_b, r);
  const c0_full = br.map((v, i) => mod(v + (e1[i] || 0n), RLWE_Q));
  for (let i = 0; i < m_scaled.length; i++) {
    c0_full[i] = mod(c0_full[i] + m_scaled[i], RLWE_Q);
  }

  // c1 = a*r + e2
  const ar = negacyclicMul(pk_a, r);
  const c1 = polyAdd(ar, e2);

  // Decrypt: c0 - s*c1
  const sc1 = negacyclicMul(sk, c1);
  const dec_scaled = polySub(c0_full, sc1);

  console.log(`\nDecrypted with Delta scaling:`);
  for (let i = 0; i < 5; i++) {
    const raw = dec_scaled[i];
    // Round: m = round(dec / DELTA) mod t
    const decoded = mod(round(raw, DELTA), PLAINTEXT_MOD);
    console.log(`  [${i}]: raw=${raw}, decoded=${decoded}, expected=${m[i]}, match=${decoded === m[i]}`);
  }

  // Test with 32 slots (like our circuit)
  console.log(`\n=== Full 32-slot test ===`);
  const msg32 = new Array(32).fill(0n).map((_, i) => BigInt(i * 7 % 256));
  const msg32_scaled = msg32.map(v => mod(v * DELTA, RLWE_Q));

  const c0_32 = br.map((v, i) => mod(v + (e1[i] || 0n) + (msg32_scaled[i] || 0n), RLWE_Q));
  const dec_32 = polySub(c0_32, sc1);

  let allMatch = true;
  for (let i = 0; i < 32; i++) {
    const decoded = mod(round(dec_32[i], DELTA), PLAINTEXT_MOD);
    if (decoded !== msg32[i]) {
      console.log(`  MISMATCH [${i}]: decoded=${decoded}, expected=${msg32[i]}`);
      allMatch = false;
    }
  }
  console.log(`All 32 slots match: ${allMatch}`);
}

main().catch(console.error);
