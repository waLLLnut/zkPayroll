/**
 * Grumpkin Curve Implementation
 *
 * Grumpkin is an elliptic curve in short Weierstrass form:
 *   y² = x³ - 17
 *
 * Parameters:
 *   - Base field p: BN254 scalar field = 21888242871839275222246405745257275088548364400416034343698204186575808495617
 *   - Group order n: BN254 base field = 21888242871839275222246405745257275088696311157297823662689037894645226208583
 *   - a = 0
 *   - b = -17 (mod p)
 *   - Generator G = (1, y) where y satisfies y² = 1 - 17 = -16 (mod p)
 *
 * This curve is used by Noir's fixed_base_scalar_mul for BN254-based proofs.
 *
 * Reference:
 * - https://hackmd.io/@aztec-network/ByzgNxBfd#2-Grumpkin
 * - https://github.com/noir-lang/noir/blob/master/noir_stdlib/src/embedded_curve_ops.nr
 */

// Grumpkin curve parameters
const P = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const N = 21888242871839275222246405745257275088696311157297823662689037894645226208583n;
const A = 0n;
const B = P - 17n; // -17 mod p

// Generator point (from Noir stdlib)
// y is computed from: y² = 1³ - 17 = -16 mod p
// Noir uses: (1, 17631683881184975370165255887551781615748388533673675138860)
const GX = 1n;
const GY = 17631683881184975370165255887551781615748388533673675138860n;

/**
 * Modular arithmetic helpers
 */
function mod(a: bigint, m: bigint = P): bigint {
  return ((a % m) + m) % m;
}

function modInverse(a: bigint, m: bigint = P): bigint {
  // Extended Euclidean Algorithm
  let [old_r, r] = [a, m];
  let [old_s, s] = [1n, 0n];

  while (r !== 0n) {
    const quotient = old_r / r;
    [old_r, r] = [r, old_r - quotient * r];
    [old_s, s] = [s, old_s - quotient * s];
  }

  return mod(old_s, m);
}

/**
 * Point on Grumpkin curve (affine coordinates)
 */
export interface GrumpkinPoint {
  x: bigint;
  y: bigint;
  isInfinity?: boolean;
}

/**
 * Point at infinity (identity element)
 */
export const POINT_AT_INFINITY: GrumpkinPoint = {
  x: 0n,
  y: 0n,
  isInfinity: true,
};

/**
 * Generator point
 */
export const GENERATOR: GrumpkinPoint = {
  x: GX,
  y: GY,
};

/**
 * Check if a point is the point at infinity
 */
function isInfinity(p: GrumpkinPoint): boolean {
  return p.isInfinity === true;
}

/**
 * Check if a point is on the curve: y² = x³ + ax + b
 */
export function isOnCurve(p: GrumpkinPoint): boolean {
  if (isInfinity(p)) return true;

  const { x, y } = p;
  const left = mod(y * y);
  const right = mod(x * x * x + A * x + B);

  return left === right;
}

/**
 * Point addition on Grumpkin curve
 * Using standard formulas for short Weierstrass curves
 */
export function pointAdd(p1: GrumpkinPoint, p2: GrumpkinPoint): GrumpkinPoint {
  // Handle infinity cases
  if (isInfinity(p1)) return p2;
  if (isInfinity(p2)) return p1;

  const { x: x1, y: y1 } = p1;
  const { x: x2, y: y2 } = p2;

  // Check if points are additive inverses
  if (x1 === x2 && mod(y1 + y2) === 0n) {
    return POINT_AT_INFINITY;
  }

  let lambda: bigint;

  if (x1 === x2 && y1 === y2) {
    // Point doubling: λ = (3x₁² + a) / (2y₁)
    const numerator = mod(3n * x1 * x1 + A);
    const denominator = mod(2n * y1);
    lambda = mod(numerator * modInverse(denominator));
  } else {
    // Point addition: λ = (y₂ - y₁) / (x₂ - x₁)
    const numerator = mod(y2 - y1);
    const denominator = mod(x2 - x1);
    lambda = mod(numerator * modInverse(denominator));
  }

  // x₃ = λ² - x₁ - x₂
  const x3 = mod(lambda * lambda - x1 - x2);
  // y₃ = λ(x₁ - x₃) - y₁
  const y3 = mod(lambda * (x1 - x3) - y1);

  return { x: x3, y: y3 };
}

/**
 * Point doubling (optimized for repeated operations)
 */
export function pointDouble(p: GrumpkinPoint): GrumpkinPoint {
  return pointAdd(p, p);
}

/**
 * Scalar multiplication using double-and-add algorithm
 * Computes k * P
 */
export function scalarMul(k: bigint, p: GrumpkinPoint): GrumpkinPoint {
  // Reduce k modulo the group order
  k = mod(k, N);

  if (k === 0n) return POINT_AT_INFINITY;
  if (isInfinity(p)) return POINT_AT_INFINITY;

  let result: GrumpkinPoint = POINT_AT_INFINITY;
  let current: GrumpkinPoint = p;

  while (k > 0n) {
    if (k & 1n) {
      result = pointAdd(result, current);
    }
    current = pointDouble(current);
    k >>= 1n;
  }

  return result;
}

/**
 * Derive public key from secret key
 * Computes: PubKey = secretKey * G
 *
 * This matches Noir's fixed_base_scalar_mul behavior.
 */
export function derivePublicKey(secretKey: bigint): GrumpkinPoint {
  return scalarMul(secretKey, GENERATOR);
}

/**
 * Convert hex string to bigint
 */
export function hexToBigInt(hex: string): bigint {
  if (hex.startsWith("0x")) {
    hex = hex.slice(2);
  }
  return BigInt("0x" + hex);
}

/**
 * Convert bigint to padded hex string
 */
export function bigIntToHex(n: bigint, padBytes: number = 32): string {
  const hex = n.toString(16);
  return "0x" + hex.padStart(padBytes * 2, "0");
}

// Verify generator is on curve
if (!isOnCurve(GENERATOR)) {
  throw new Error("Generator point is not on the Grumpkin curve!");
}
