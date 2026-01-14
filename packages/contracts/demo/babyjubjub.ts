/**
 * Baby JubJub Elliptic Curve Operations
 *
 * Used for user identity (WaAddress) in the privacy pool
 * Points are encoded as (x, y) Field elements
 */

import { createHash, randomBytes } from 'crypto';

// Baby JubJub parameters on BN254
// y^2 = x^3 + A*x^2 + x
// A = 168698 (Montgomery form)
// d = 9706598848417545097372247223557719406 (Edwards form)

const FR_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

// Edwards curve parameters
const EDWARDS_D = 12181644023421730124874158521699555681764249180949974110617291017600649128846n;
const EDWARDS_A = 168700n;

// Base point (generator)
const BASE_POINT = {
  x: 5299619240641551281634865583518297030282874472190772894086521144482721001553n,
  y: 16950150798460657717958625567821834550301663161624707787222815936182638968203n
};

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

export interface Point {
  x: bigint;
  y: bigint;
}

export const IDENTITY: Point = { x: 0n, y: 1n };

/**
 * Edwards curve point addition
 */
export function pointAdd(p1: Point, p2: Point): Point {
  const x1 = p1.x, y1 = p1.y;
  const x2 = p2.x, y2 = p2.y;

  // x3 = (x1*y2 + y1*x2) / (1 + d*x1*x2*y1*y2)
  // y3 = (y1*y2 - a*x1*x2) / (1 - d*x1*x2*y1*y2)

  const x1y2 = mod(x1 * y2, FR_MODULUS);
  const y1x2 = mod(y1 * x2, FR_MODULUS);
  const y1y2 = mod(y1 * y2, FR_MODULUS);
  const x1x2 = mod(x1 * x2, FR_MODULUS);

  const dxy = mod(EDWARDS_D * x1x2 * y1y2, FR_MODULUS);

  const x3_num = mod(x1y2 + y1x2, FR_MODULUS);
  const x3_den = mod(1n + dxy, FR_MODULUS);
  const x3 = mod(x3_num * modInverse(x3_den, FR_MODULUS), FR_MODULUS);

  const y3_num = mod(y1y2 - mod(EDWARDS_A * x1x2, FR_MODULUS), FR_MODULUS);
  const y3_den = mod(1n - dxy, FR_MODULUS);
  const y3 = mod(y3_num * modInverse(y3_den, FR_MODULUS), FR_MODULUS);

  return { x: x3, y: y3 };
}

/**
 * Scalar multiplication using double-and-add
 */
export function scalarMul(scalar: bigint, point: Point): Point {
  let result = IDENTITY;
  let temp = point;
  let s = scalar;

  while (s > 0n) {
    if (s & 1n) {
      result = pointAdd(result, temp);
    }
    temp = pointAdd(temp, temp);
    s = s >> 1n;
  }

  return result;
}

/**
 * Derive public key from secret key
 * pk = sk * G
 */
export function derivePublicKey(secretKey: bigint): Point {
  return scalarMul(secretKey, BASE_POINT);
}

/**
 * Generate a random secret key
 */
export function generateSecretKey(): bigint {
  const bytes = randomBytes(32);

  let sk = 0n;
  for (const b of bytes) {
    sk = (sk << 8n) | BigInt(b);
  }

  return mod(sk, FR_MODULUS);
}

/**
 * WaAddress: Baby JubJub public key as user identity
 */
export interface WaAddress {
  x: bigint;
  y: bigint;
}

export function createWaAddress(secretKey: bigint): WaAddress {
  const pk = derivePublicKey(secretKey);
  return { x: pk.x, y: pk.y };
}

/**
 * Serialize WaAddress for RLWE encryption
 */
export function waAddressToFields(addr: WaAddress): [bigint, bigint] {
  return [addr.x, addr.y];
}

export function fieldsToWaAddress(fields: [bigint, bigint]): WaAddress {
  return { x: fields[0], y: fields[1] };
}

/**
 * Compute nullifier for a note
 * nullifier = poseidon(note_hash, secret_key)
 * (Simplified version using SHA256 for demo)
 */
export function computeNullifier(noteHash: bigint, secretKey: bigint): bigint {
  const hash = createHash('sha256');
  hash.update(noteHash.toString(16).padStart(64, '0'));
  hash.update(secretKey.toString(16).padStart(64, '0'));
  const digest = hash.digest('hex');
  return mod(BigInt('0x' + digest), FR_MODULUS);
}
