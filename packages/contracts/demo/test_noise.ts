#!/usr/bin/env npx tsx
/**
 * Test RLWE with small noise
 */

import { createHash } from 'crypto';

const RLWE_N = 1024;
const RLWE_Q = 167772161n;

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

async function main() {
  console.log('=== RLWE Noise Analysis ===\n');

  // Key generation
  const pk_a = sampleUniform('test_a', RLWE_N);
  const sk = sampleSmall('test_sk', RLWE_N);
  const e_pk = sampleSmall('test_e_pk', RLWE_N);
  const pk_b = polyAdd(negacyclicMul(pk_a, sk), e_pk);

  // Message (small values)
  const m = [42n, 100n, 255n, 0n];
  console.log(`Original message: [${m.join(', ')}]`);

  // Encryption randomness
  const r = sampleSmall('test_r', RLWE_N);
  const e1 = sampleSmall('test_e1', RLWE_N);
  const e2 = sampleSmall('test_e2', RLWE_N);

  // c0 = b*r + e1 + m
  const br = negacyclicMul(pk_b, r);
  const c0 = br.map((v, i) => mod(v + (e1[i] || 0n) + (m[i] || 0n), RLWE_Q));

  // c1 = a*r + e2
  const ar = negacyclicMul(pk_a, r);
  const c1 = polyAdd(ar, e2);

  // Decrypt: c0 - s*c1
  const sc1 = negacyclicMul(sk, c1);
  const dec = polySub(c0, sc1);

  console.log(`\nDecrypted (raw):`);
  for (let i = 0; i < 4; i++) {
    const raw = dec[i];
    const centered = raw > RLWE_Q / 2n ? raw - RLWE_Q : raw;
    console.log(`  [${i}]: raw=${raw}, centered=${centered}, expected=${m[i]}`);
  }

  // Compute noise: dec - m should be small
  console.log(`\nNoise analysis:`);
  for (let i = 0; i < 4; i++) {
    const noise = mod(dec[i] - (m[i] || 0n), RLWE_Q);
    const noiseCenter = noise > RLWE_Q / 2n ? noise - RLWE_Q : noise;
    console.log(`  [${i}]: noise = ${noiseCenter}`);
  }

  // The noise should be: e_pk*r + e1 - s*e2
  // With |e_pk|, |e1|, |e2|, |s|, |r| ≤ 128, the noise can be:
  // |e_pk*r| ≤ 128 * 128 * N = 128 * 128 * 1024 = 16M (for single coeff of product)
  // This is way larger than Q/2 ≈ 84M, so decryption will fail!
  console.log(`\n⚠️  Noise bound estimation:`);
  console.log(`  |e_pk|, |r| ≤ 128`);
  console.log(`  |e_pk * r| ≈ N * 128 * 128 = ${RLWE_N * 128 * 128}`);
  console.log(`  Q/2 = ${RLWE_Q / 2n}`);
  console.log(`  Noise > Q/2: decryption will fail!`);
}

main().catch(console.error);
