#!/usr/bin/env npx tsx
/**
 * Simple RLWE test with NO noise to verify core logic
 */

const RLWE_N = 1024;
const RLWE_Q = 167772161n;

function mod(a: bigint, m: bigint): bigint {
  return ((a % m) + m) % m;
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
  console.log('=== Simple RLWE Test (NO NOISE) ===\n');

  // Simple polynomials for testing
  const a: bigint[] = new Array(RLWE_N).fill(0n);
  const s: bigint[] = new Array(RLWE_N).fill(0n);
  const r: bigint[] = new Array(RLWE_N).fill(0n);

  // Set only first coefficient for simplicity
  a[0] = 12345n;
  s[0] = 67n;
  r[0] = 89n;

  // b = a * s (no error for testing)
  const b = negacyclicMul(a, s);
  console.log(`a[0] = ${a[0]}, s[0] = ${s[0]}`);
  console.log(`b = a * s, b[0] = ${b[0]} (expected: ${mod(a[0] * s[0], RLWE_Q)})`);

  // Message
  const m: bigint[] = new Array(RLWE_N).fill(0n);
  m[0] = 42n;
  m[1] = 100n;
  console.log(`\nm[0] = ${m[0]}, m[1] = ${m[1]}`);

  // Encrypt (no noise)
  // c0 = b*r + m
  // c1 = a*r
  const br = negacyclicMul(b, r);
  const ar = negacyclicMul(a, r);

  const c0 = polyAdd(br, m);
  const c1 = ar;

  console.log(`\nEncrypted:`);
  console.log(`c0[0] = ${c0[0]}, c0[1] = ${c0[1]}`);
  console.log(`c1[0] = ${c1[0]}`);

  // Decrypt: c0 - s*c1
  const sc1 = negacyclicMul(s, c1);
  const decrypted = polySub(c0, sc1);

  console.log(`\nDecrypted:`);
  console.log(`d[0] = ${decrypted[0]} (expected: ${m[0]})`);
  console.log(`d[1] = ${decrypted[1]} (expected: ${m[1]})`);
  console.log(`Match: ${decrypted[0] === m[0] && decrypted[1] === m[1]}`);

  // Verify math manually
  // c0 - s*c1 = (b*r + m) - s*(a*r)
  //           = (a*s)*r + m - s*a*r
  //           = m (since polynomial mul is commutative)
  console.log(`\nManual verification:`);
  console.log(`b*r[0] = ${br[0]}`);
  console.log(`a*r[0] = ${ar[0]}`);
  console.log(`s*(a*r)[0] = ${sc1[0]}`);
  console.log(`Expected s*(a*r)[0] = s[0] * (a*r)[0] mod Q = ${mod(s[0] * ar[0], RLWE_Q)}`);

  // Check if a*s == s*a
  const sa = negacyclicMul(s, a);
  console.log(`\nCommutativity check:`);
  console.log(`a*s[0] = ${b[0]}, s*a[0] = ${sa[0]}, equal: ${b[0] === sa[0]}`);
}

main().catch(console.error);
