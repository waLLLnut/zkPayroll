#!/usr/bin/env npx tsx
/**
 * Test RLWE with small noise (proper parameters)
 */

import { createHash } from 'crypto';

const RLWE_N = 1024;
const RLWE_Q = 167772161n;
const PLAINTEXT_MOD = 256n;  // 8-bit slots
const DELTA = RLWE_Q / PLAINTEXT_MOD;  // ~655360

// Max noise should be < DELTA/2 to avoid decryption errors
// With |e| ≤ σ, the total noise is roughly O(N * σ²)
// We need: N * σ² < DELTA/2 ≈ 327680
// So σ < sqrt(327680 / 1024) ≈ 18
// Use σ = 3 for safety

const NOISE_BOUND = 3;

console.log(`RLWE Parameters:`);
console.log(`  N = ${RLWE_N}`);
console.log(`  Q = ${RLWE_Q}`);
console.log(`  DELTA = ${DELTA}`);
console.log(`  NOISE_BOUND = ${NOISE_BOUND}`);
console.log(`  Max allowed noise ≈ ${DELTA / 2n}`);

function mod(a: bigint, m: bigint): bigint {
  return ((a % m) + m) % m;
}

function hashToBytes(seed: string, length: number): Uint8Array {
  const hash = createHash('sha256');
  hash.update(seed);
  const digest = hash.digest();
  const result = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    const idx = i % digest.length;
    result[i] = digest[idx] ^ (Math.floor(i / digest.length) & 0xFF);
  }
  return result;
}

function sampleSmallNoise(seed: string, n: number, bound: number): bigint[] {
  const bytes = hashToBytes(seed, n);
  return Array.from(bytes).map(b => {
    // Map [0, 255] to [-bound, bound]
    const scaled = Math.floor((b / 256) * (2 * bound + 1)) - bound;
    return mod(BigInt(scaled), RLWE_Q);
  });
}

function sampleUniform(seed: string, n: number): bigint[] {
  const bytes = hashToBytes(seed, n * 4);
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
  return (x + divisor / 2n) / divisor;
}

async function main() {
  console.log('\n=== RLWE with Small Noise ===\n');

  // Key generation with small noise
  const pk_a = sampleUniform('test_a', RLWE_N);
  const sk = sampleSmallNoise('test_sk', RLWE_N, NOISE_BOUND);
  const e_pk = sampleSmallNoise('test_e_pk', RLWE_N, NOISE_BOUND);
  const pk_b = polyAdd(negacyclicMul(pk_a, sk), e_pk);

  // Test messages
  const messages = [
    [42n, 100n],
    [0n, 0n],
    [255n, 255n],
    [0x123456789ABCDEFn & 0xFFFFFFFFFFFFFFFFn, 0xFEDCBA987654321n & 0xFFFFFFFFFFFFFFFFn]
  ];

  for (const [mx, my] of messages) {
    // Encode to 32 slots (16 slots per Field, 8 bits each)
    const msgSlots: bigint[] = new Array(32).fill(0n);
    let val = mx;
    for (let i = 0; i < 16; i++) {
      msgSlots[i] = val & 0xFFn;
      val = val >> 8n;
    }
    val = my;
    for (let i = 0; i < 16; i++) {
      msgSlots[16 + i] = val & 0xFFn;
      val = val >> 8n;
    }

    // Scale by DELTA
    const msgScaled = msgSlots.map(v => mod(v * DELTA, RLWE_Q));

    // Encryption
    const r = sampleSmallNoise(`r_${mx}_${my}`, RLWE_N, NOISE_BOUND);
    const e1 = sampleSmallNoise(`e1_${mx}_${my}`, RLWE_N, NOISE_BOUND);
    const e2 = sampleSmallNoise(`e2_${mx}_${my}`, RLWE_N, NOISE_BOUND);

    const br = negacyclicMul(pk_b, r);
    const c0 = br.map((v, i) => mod(v + (e1[i] || 0n) + (msgScaled[i] || 0n), RLWE_Q));

    const ar = negacyclicMul(pk_a, r);
    const c1 = polyAdd(ar, e2);

    // Decryption
    const sc1 = negacyclicMul(sk, c1);
    const dec = polySub(c0, sc1);

    // Decode
    const decSlots = dec.slice(0, 32).map(v => mod(round(v, DELTA), PLAINTEXT_MOD));

    // Reconstruct Field elements
    let decX = 0n, decY = 0n;
    for (let i = 15; i >= 0; i--) {
      decX = (decX << 8n) | decSlots[i];
    }
    for (let i = 15; i >= 0; i--) {
      decY = (decY << 8n) | decSlots[16 + i];
    }

    const matchX = (decX & 0xFFFFFFFFFFFFFFFFn) === (mx & 0xFFFFFFFFFFFFFFFFn);
    const matchY = (decY & 0xFFFFFFFFFFFFFFFFn) === (my & 0xFFFFFFFFFFFFFFFFn);

    console.log(`Message (${mx.toString(16)}, ${my.toString(16)}):`);
    console.log(`  Decrypted: (${decX.toString(16)}, ${decY.toString(16)})`);
    console.log(`  Match: X=${matchX}, Y=${matchY}`);
    console.log();
  }
}

main().catch(console.error);
