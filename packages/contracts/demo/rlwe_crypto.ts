/**
 * RLWE Encryption/Decryption for Audit Log
 *
 * Threshold Decryption: 2-out-of-3
 * - PK generator creates sk and splits into 3 shares
 * - Any 2 parties can decrypt via linear combination
 * - Honest non-collude assumption between auditors
 */

import { createHash, randomBytes } from 'crypto';

// RLWE Parameters
export const RLWE_N = 1024;
export const RLWE_Q = 167772161n;
export const RLWE_MESSAGE_SLOTS = 32;
export const RLWE_SLOT_BITS = 8;
export const RLWE_SLOTS_PER_FR = 16;
export const PLAINTEXT_MOD = 256n;
export const DELTA = RLWE_Q / PLAINTEXT_MOD;  // ~655360
export const NOISE_BOUND = 3;  // Small noise for correctness

// BN254 scalar field prime
export const FR_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

function mod(a: bigint, m: bigint): bigint {
  return ((a % m) + m) % m;
}

function modInverse(a: bigint, m: bigint): bigint {
  let [old_r, r] = [a, m];
  let [old_s, s] = [1n, 0n];
  while (r !== 0n) {
    const quotient = old_r / r;
    [old_r, r] = [r, old_r - quotient * r];
    [old_s, s] = [s, old_s - quotient * s];
  }
  return mod(old_s, m);
}

function hashToBytes(seed: string, length: number): Uint8Array {
  const hash = createHash('sha256');
  hash.update(seed);
  const digest = hash.digest();
  const result = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    result[i] = digest[i % digest.length] ^ (Math.floor(i / digest.length) & 0xFF);
  }
  return result;
}

function sampleSmallNoise(seed: string, n: number): bigint[] {
  const bytes = hashToBytes(seed, n);
  return Array.from(bytes).map(b => {
    const scaled = Math.floor((b / 256) * (2 * NOISE_BOUND + 1)) - NOISE_BOUND;
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
  return a.map((v, i) => mod(v + (b[i] || 0n), RLWE_Q));
}

function polySub(a: bigint[], b: bigint[]): bigint[] {
  return a.map((v, i) => mod(v - (b[i] || 0n), RLWE_Q));
}

function polyScalarMul(a: bigint[], s: bigint): bigint[] {
  return a.map(v => mod(v * s, RLWE_Q));
}

function round(x: bigint, divisor: bigint): bigint {
  return (x + divisor / 2n) / divisor;
}

// ==========================================
// Key Generation
// ==========================================

export interface RlweKeyPair {
  sk: bigint[];
  pk_a: bigint[];
  pk_b: bigint[];
}

export function generateKeyPair(seed: string): RlweKeyPair {
  const pk_a = sampleUniform(seed + "_pk_a", RLWE_N);
  const sk = sampleSmallNoise(seed + "_sk", RLWE_N);
  const e = sampleSmallNoise(seed + "_pk_e", RLWE_N);
  const as = negacyclicMul(pk_a, sk);
  const pk_b = polyAdd(as, e);
  return { sk, pk_a, pk_b };
}

// ==========================================
// Encryption
// ==========================================

export interface RlweCiphertext {
  c0: bigint[];
  c1: bigint[];
}

export interface RlweWitness {
  r: bigint[];
  e1: bigint[];
  e2: bigint[];
}

function encodeMessages(messages: [bigint, bigint]): bigint[] {
  const slots: bigint[] = new Array(RLWE_MESSAGE_SLOTS).fill(0n);
  for (let m = 0; m < 2; m++) {
    let val = messages[m];
    for (let i = 0; i < RLWE_SLOTS_PER_FR; i++) {
      slots[m * RLWE_SLOTS_PER_FR + i] = val & 0xFFn;
      val = val >> 8n;
    }
  }
  return slots;
}

function decodeMessages(slots: bigint[]): [bigint, bigint] {
  const messages: [bigint, bigint] = [0n, 0n];
  for (let m = 0; m < 2; m++) {
    let val = 0n;
    for (let i = RLWE_SLOTS_PER_FR - 1; i >= 0; i--) {
      val = (val << 8n) | (slots[m * RLWE_SLOTS_PER_FR + i] & 0xFFn);
    }
    messages[m] = val;
  }
  return messages;
}

export function encrypt(
  pk_a: bigint[],
  pk_b: bigint[],
  message: [bigint, bigint],
  randomSeed: string
): { ct: RlweCiphertext; witness: RlweWitness } {
  const r = sampleSmallNoise(randomSeed + "_r", RLWE_N);
  const e1 = sampleSmallNoise(randomSeed + "_e1", RLWE_MESSAGE_SLOTS);
  const e2 = sampleSmallNoise(randomSeed + "_e2", RLWE_N);

  // Encode and scale by DELTA
  const msgSlots = encodeMessages(message);
  const msgScaled = msgSlots.map(v => mod(v * DELTA, RLWE_Q));

  // c0 = b*r + e1 + m*DELTA (only 32 slots)
  const br = negacyclicMul(pk_b, r);
  const c0: bigint[] = [];
  for (let i = 0; i < RLWE_MESSAGE_SLOTS; i++) {
    c0.push(mod(br[i] + e1[i] + msgScaled[i], RLWE_Q));
  }

  // c1 = a*r + e2
  const ar = negacyclicMul(pk_a, r);
  const c1 = polyAdd(ar, e2);

  return { ct: { c0, c1 }, witness: { r, e1, e2 } };
}

// ==========================================
// Decryption
// ==========================================

export function decrypt(sk: bigint[], ct: RlweCiphertext): [bigint, bigint] {
  const c0_full = [...ct.c0, ...new Array(RLWE_N - RLWE_MESSAGE_SLOTS).fill(0n)];
  const sc1 = negacyclicMul(sk, ct.c1);
  const dec = polySub(c0_full, sc1);

  // Decode: round(dec / DELTA) mod PLAINTEXT_MOD
  const msgSlots = dec.slice(0, RLWE_MESSAGE_SLOTS).map(v =>
    mod(round(v, DELTA), PLAINTEXT_MOD)
  );

  return decodeMessages(msgSlots);
}

// ==========================================
// Threshold Decryption (2-of-3)
// ==========================================

export interface SecretShare {
  index: number;
  share: bigint[];
}

export function splitSecretKey(sk: bigint[], seed: string): SecretShare[] {
  const shares: SecretShare[] = [];
  const a1 = sampleUniform(seed + "_share_a1", RLWE_N);

  for (let j = 1; j <= 3; j++) {
    const share: bigint[] = [];
    for (let i = 0; i < RLWE_N; i++) {
      share.push(mod(sk[i] + a1[i] * BigInt(j), RLWE_Q));
    }
    shares.push({ index: j, share });
  }
  return shares;
}

function lagrangeCoeff(i: number, indices: number[]): bigint {
  let num = 1n;
  let den = 1n;
  for (const j of indices) {
    if (j !== i) {
      num = mod(num * BigInt(-j), RLWE_Q);
      den = mod(den * BigInt(i - j), RLWE_Q);
    }
  }
  return mod(num * modInverse(den, RLWE_Q), RLWE_Q);
}

export function partialDecrypt(share: SecretShare, ct: RlweCiphertext): bigint[] {
  return negacyclicMul(share.share, ct.c1);
}

export function combinePartialDecryptions(
  partials: { index: number; partial: bigint[] }[],
  ct: RlweCiphertext
): [bigint, bigint] {
  if (partials.length < 2) throw new Error("Need at least 2 partial decryptions");

  const indices = partials.slice(0, 2).map(p => p.index);
  let sc1: bigint[] = new Array(RLWE_N).fill(0n);

  for (const { index, partial } of partials.slice(0, 2)) {
    const coeff = lagrangeCoeff(index, indices);
    const weighted = polyScalarMul(partial, coeff);
    sc1 = polyAdd(sc1, weighted);
  }

  const c0_full = [...ct.c0, ...new Array(RLWE_N - RLWE_MESSAGE_SLOTS).fill(0n)];
  const dec = polySub(c0_full, sc1);

  const msgSlots = dec.slice(0, RLWE_MESSAGE_SLOTS).map(v =>
    mod(round(v, DELTA), PLAINTEXT_MOD)
  );

  return decodeMessages(msgSlots);
}

export function verifyShare(
  share: SecretShare,
  pk_a: bigint[],
  pk_b: bigint[],
  otherShare: SecretShare
): boolean {
  const { ct } = encrypt(pk_a, pk_b, [0n, 0n], `verify_${share.index}_${Date.now()}`);
  const partial1 = partialDecrypt(share, ct);
  const partial2 = partialDecrypt(otherShare, ct);
  const decrypted = combinePartialDecryptions(
    [
      { index: share.index, partial: partial1 },
      { index: otherShare.index, partial: partial2 }
    ],
    ct
  );
  return decrypted[0] === 0n && decrypted[1] === 0n;
}

// ==========================================
// Serialization
// ==========================================

export function serializeCiphertext(ct: RlweCiphertext): string {
  return JSON.stringify({
    c0: ct.c0.map(v => v.toString()),
    c1: ct.c1.map(v => v.toString())
  });
}

export function deserializeCiphertext(json: string): RlweCiphertext {
  const parsed = JSON.parse(json);
  return {
    c0: parsed.c0.map((v: string) => BigInt(v)),
    c1: parsed.c1.map((v: string) => BigInt(v))
  };
}
