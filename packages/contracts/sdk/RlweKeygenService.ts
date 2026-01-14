/**
 * RLWE Key Generation Service
 *
 * Generates RLWE keys for the audit system.
 * The company uses this during audit log initialization to create the
 * public key (embedded as CRS in circuit) and secret key (for decryption).
 *
 * Usage:
 *   1. Company calls generateKeys() with a secure random seed
 *   2. Public key is exported to pk.nr and compiled into the circuit
 *   3. Secret key is stored securely by the company
 *   4. Later, company can decrypt audit logs using the secret key
 */

import { createHash } from "crypto";
import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";

// RLWE Parameters (must match circuit constants)
export const RLWE_N = 1024;
export const RLWE_Q = 167772161n; // NTT-friendly prime: 40 * 2^22 + 1
export const RLWE_MESSAGE_SLOTS = 32;
export const RLWE_SLOT_BITS = 8;

// Type for RLWE polynomial
export type RlwePoly = bigint[];

// RLWE Key Pair
export interface RlweKeyPair {
  publicKey: {
    a: RlwePoly;
    b: RlwePoly;
  };
  secretKey: RlwePoly;
  seed: string; // hex encoded seed for reproducibility
}

// Negacyclic matrix rows for circuit embedding
export interface RlwePublicKeyRows {
  pkARows: RlwePoly[]; // [MESSAGE_SLOTS][N] for c0 computation
  pkBRows: RlwePoly[]; // [N][N] for c1 computation
}

/**
 * SHAKE256-based deterministic PRNG
 */
function shake256(seed: Buffer, numBytes: number): Buffer {
  // Use XOF mode via multiple hash iterations
  const hash = createHash("shake256", { outputLength: numBytes });
  hash.update(seed);
  return hash.digest();
}

/**
 * Convert bytes to field elements mod Q
 */
function bytesToFieldElements(
  data: Buffer,
  count: number,
  modulus: bigint
): bigint[] {
  const elements: bigint[] = [];
  const bytesPerElement = 4; // 32 bits enough for Q < 2^28

  for (let i = 0; i < count; i++) {
    const start = i * bytesPerElement;
    const chunk = data.subarray(start, start + bytesPerElement);
    // Little-endian conversion
    let value = 0n;
    for (let j = 0; j < chunk.length; j++) {
      value += BigInt(chunk[j]!) << BigInt(j * 8);
    }
    elements.push(value % modulus);
  }

  return elements;
}

/**
 * Sample polynomial with small coefficients in [-bound, bound]
 */
function sampleSmallPoly(seed: Buffer, label: string, bound: number = 3): bigint[] {
  const labelBuf = Buffer.from(label);
  const data = shake256(Buffer.concat([seed, labelBuf]), RLWE_N * 2);
  const coeffs: bigint[] = [];

  for (let i = 0; i < RLWE_N; i++) {
    // Use 2 bytes per coefficient for better distribution
    const val = data[i * 2]! + (data[i * 2 + 1]! << 8);
    // Map to [-bound, bound]
    const coeff = (val % (2 * bound + 1)) - bound;
    // Store as positive mod Q
    coeffs.push(coeff >= 0 ? BigInt(coeff) : RLWE_Q + BigInt(coeff));
  }

  return coeffs;
}

/**
 * Sample uniformly random polynomial mod Q
 */
function sampleUniformPoly(seed: Buffer, label: string): bigint[] {
  const labelBuf = Buffer.from(label);
  const data = shake256(Buffer.concat([seed, labelBuf]), RLWE_N * 4);
  return bytesToFieldElements(data, RLWE_N, RLWE_Q);
}

/**
 * Polynomial multiplication in Z_q[X]/(X^N + 1)
 */
function polyMulNegacyclic(a: bigint[], b: bigint[]): bigint[] {
  const n = a.length;
  const result: bigint[] = new Array(n).fill(0n);

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const idx = i + j;
      if (idx < n) {
        result[idx] = (result[idx]! + a[i]! * b[j]!) % RLWE_Q;
      } else {
        // X^N = -1
        result[idx - n] = (result[idx - n]! - a[i]! * b[j]! % RLWE_Q + RLWE_Q) % RLWE_Q;
      }
    }
  }

  return result;
}

/**
 * Polynomial addition mod Q
 */
function polyAdd(a: bigint[], b: bigint[]): bigint[] {
  return a.map((ai, i) => (ai + b[i]!) % RLWE_Q);
}

/**
 * Polynomial negation mod Q
 */
function polyNeg(a: bigint[]): bigint[] {
  return a.map((x) => (RLWE_Q - x) % RLWE_Q);
}

/**
 * Get row of negacyclic matrix for polynomial multiplication.
 *
 * For polynomial p, the negacyclic matrix M_p has the property:
 * M_p @ r = p * r (mod X^N + 1)
 *
 * Row i of M_p contains rotated/negated coefficients of p.
 */
function negacyclicMatrixRow(poly: bigint[], rowIdx: number): bigint[] {
  const n = poly.length;
  const row: bigint[] = new Array(n);

  for (let j = 0; j < n; j++) {
    const k = ((rowIdx - j) % n + n) % n;
    if (rowIdx >= j) {
      row[j] = poly[k]!;
    } else {
      // Wrap around: X^N = -1
      row[j] = (RLWE_Q - poly[k]!) % RLWE_Q;
    }
  }

  return row;
}

/**
 * RLWE Key Generation Service
 */
export class RlweKeygenService {
  /**
   * Generate RLWE key pair from a seed.
   *
   * @param seedHex - 32-byte hex-encoded seed (should be cryptographically random)
   * @returns Key pair containing public key (a, b), secret key s
   *
   * The relationship is: b = -(a*s + e) where e is a small error polynomial.
   * This means: a*s + b = -e (small noise)
   */
  static generateKeyPair(seedHex: string): RlweKeyPair {
    const seed = Buffer.from(seedHex.replace("0x", ""), "hex");

    // Sample secret key s (small coefficients in [-3, 3])
    const s = sampleSmallPoly(seed, "secret_key", 3);

    // Sample error e (small coefficients in [-3, 3])
    const e = sampleSmallPoly(seed, "error", 3);

    // Sample a uniformly random
    const a = sampleUniformPoly(seed, "public_a");

    // Compute b = -(a*s + e)
    const aTimesS = polyMulNegacyclic(a, s);
    const aTimesSPlusE = polyAdd(aTimesS, e);
    const b = polyNeg(aTimesSPlusE);

    return {
      publicKey: { a, b },
      secretKey: s,
      seed: seedHex,
    };
  }

  /**
   * Generate a cryptographically secure random seed
   */
  static generateRandomSeed(): string {
    return ethers.hexlify(ethers.randomBytes(32));
  }

  /**
   * Compute negacyclic matrix rows for circuit embedding.
   *
   * This is the key optimization: instead of computing polynomial multiplication
   * in the circuit, we precompute the matrix rows and use inner products.
   *
   * For c0 (message slots), we only need MESSAGE_SLOTS rows of A.
   * For c1 (full polynomial), we need N rows of B.
   */
  static computePublicKeyRows(keyPair: RlweKeyPair): RlwePublicKeyRows {
    const { a, b } = keyPair.publicKey;

    // Generate MESSAGE_SLOTS rows for PK_A (used in c0 computation)
    const pkARows: bigint[][] = [];
    for (let i = 0; i < RLWE_MESSAGE_SLOTS; i++) {
      pkARows.push(negacyclicMatrixRow(a, i));
    }

    // Generate N rows for PK_B (used in c1 computation)
    const pkBRows: bigint[][] = [];
    for (let i = 0; i < RLWE_N; i++) {
      pkBRows.push(negacyclicMatrixRow(b, i));
    }

    return { pkARows, pkBRows };
  }

  /**
   * Export public key as Noir code (pk.nr file).
   *
   * This generates the CRS that gets compiled into the circuit.
   * The file is ~10MB containing the precomputed matrix rows.
   */
  static exportToNoir(keyPair: RlweKeyPair, outputPath: string): void {
    const rows = this.computePublicKeyRows(keyPair);

    const lines: string[] = [
      "// RLWE Public Key Constants (CRS)",
      `// Generated from seed: ${keyPair.seed}`,
      `// DO NOT EDIT - regenerate with RlweKeygenService`,
      "",
      `pub global RLWE_N: u32 = ${RLWE_N};`,
      "",
      `// PK_A rows for c0 computation (${RLWE_MESSAGE_SLOTS} rows × ${RLWE_N} elements)`,
      `pub global RLWE_PK_A_ROWS: [[Field; RLWE_N]; ${RLWE_MESSAGE_SLOTS}] = [`,
    ];

    // Add PK_A rows
    for (let i = 0; i < rows.pkARows.length; i++) {
      const rowStr = "[" + rows.pkARows[i]!.join(", ") + "]";
      lines.push(
        i < rows.pkARows.length - 1 ? `    ${rowStr},` : `    ${rowStr}`
      );
    }
    lines.push("];");
    lines.push("");

    // Add PK_B rows
    lines.push(
      `// PK_B rows for c1 computation (${RLWE_N} rows × ${RLWE_N} elements)`
    );
    lines.push(`pub global RLWE_PK_B_ROWS: [[Field; RLWE_N]; RLWE_N] = [`);
    for (let i = 0; i < rows.pkBRows.length; i++) {
      const rowStr = "[" + rows.pkBRows[i]!.join(", ") + "]";
      lines.push(
        i < rows.pkBRows.length - 1 ? `    ${rowStr},` : `    ${rowStr}`
      );
    }
    lines.push("];");

    fs.writeFileSync(outputPath, lines.join("\n"));
  }

  /**
   * Export secret key for secure storage.
   *
   * The secret key should be stored securely (HSM, encrypted storage, etc.)
   * as it's needed to decrypt the audit logs.
   */
  static exportSecretKey(keyPair: RlweKeyPair): string {
    return JSON.stringify({
      seed: keyPair.seed,
      secretKey: keyPair.secretKey.map((x) => x.toString()),
    });
  }

  /**
   * Import secret key from stored format.
   */
  static importSecretKey(json: string): RlwePoly {
    const data = JSON.parse(json);
    return data.secretKey.map((x: string) => BigInt(x));
  }

  /**
   * Decrypt RLWE ciphertext using secret key.
   *
   * Decryption: m = c0 - c1 * s (should give small noise + message)
   *
   * @param c0 - First component of ciphertext (sparse, MESSAGE_SLOTS elements)
   * @param c1 - Second component of ciphertext (N elements)
   * @param secretKey - The RLWE secret key
   * @returns Decrypted message slots
   */
  static decrypt(
    c0Sparse: bigint[],
    c1: bigint[],
    secretKey: bigint[]
  ): bigint[] {
    // Compute c1 * s
    const c1TimesS = polyMulNegacyclic(c1, secretKey);

    // m = c0 - (c1 * s) for each sparse slot
    const decrypted: bigint[] = [];
    for (let i = 0; i < RLWE_MESSAGE_SLOTS; i++) {
      let m = (c0Sparse[i]! - c1TimesS[i]! + RLWE_Q) % RLWE_Q;
      // Handle signed noise: if m is close to Q, it's negative
      if (m > RLWE_Q / 2n) {
        m = m - RLWE_Q;
      }
      // Extract the message (remove small noise by rounding)
      // For 8-bit slots, message is in range [0, 255]
      decrypted.push(m);
    }

    return decrypted;
  }

  /**
   * Decode message slots back to Field elements.
   *
   * Reverse of encode_field_to_slots in Noir:
   * Takes 32 slots (each 8 bits) and reconstructs 2 Field elements.
   */
  static decodeSlots(slots: bigint[]): [bigint, bigint] {
    let x = 0n;
    let y = 0n;

    // First 16 slots -> x
    for (let i = 0; i < 16; i++) {
      // Mask to 8 bits and handle potential noise
      const slotValue = slots[i]! & 0xFFn;
      x += slotValue << BigInt(i * 8);
    }

    // Next 16 slots -> y
    for (let i = 0; i < 16; i++) {
      const slotValue = slots[16 + i]! & 0xFFn;
      y += slotValue << BigInt(i * 8);
    }

    return [x, y];
  }

  /**
   * Full decryption: ciphertext -> wa_address (x, y)
   */
  static decryptWaAddress(
    c0Sparse: bigint[],
    c1: bigint[],
    secretKey: bigint[]
  ): { x: bigint; y: bigint } {
    const slots = this.decrypt(c0Sparse, c1, secretKey);
    const [x, y] = this.decodeSlots(slots);
    return { x, y };
  }
}

/**
 * Initialize the RLWE audit system.
 *
 * This is the main entry point for companies to set up their audit system.
 *
 * Steps:
 * 1. Generate a secure random seed (or use provided one)
 * 2. Generate RLWE key pair
 * 3. Export public key to pk.nr (for circuit compilation)
 * 4. Return secret key for secure storage
 *
 * @param noirCircuitPath - Path to the Noir circuit's src directory
 * @param seedHex - Optional seed (will generate random if not provided)
 * @returns Object containing secret key JSON and seed
 */
export async function initializeRlweAuditSystem(
  noirCircuitPath: string,
  seedHex?: string
): Promise<{
  secretKeyJson: string;
  seed: string;
  pkNoirPath: string;
}> {
  // Generate or use provided seed
  const seed = seedHex ?? RlweKeygenService.generateRandomSeed();

  console.log(`Generating RLWE keys from seed: ${seed}`);
  console.log(`Parameters: N=${RLWE_N}, Q=${RLWE_Q}, slots=${RLWE_MESSAGE_SLOTS}`);

  // Generate key pair
  const keyPair = RlweKeygenService.generateKeyPair(seed);

  // Export to Noir
  const pkNoirPath = path.join(noirCircuitPath, "pk.nr");
  console.log(`Exporting public key to: ${pkNoirPath}`);
  RlweKeygenService.exportToNoir(keyPair, pkNoirPath);

  // Get file size
  const stats = fs.statSync(pkNoirPath);
  console.log(`Generated pk.nr: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

  // Export secret key
  const secretKeyJson = RlweKeygenService.exportSecretKey(keyPair);

  console.log("\n⚠️  IMPORTANT: Store the secret key securely!");
  console.log("The secret key is required to decrypt audit logs.");

  return {
    secretKeyJson,
    seed,
    pkNoirPath,
  };
}

/**
 * Verify that pk.nr matches a given seed.
 *
 * Useful for confirming circuit integrity.
 */
export function verifyPkNoir(pkNoirPath: string, seedHex: string): boolean {
  const content = fs.readFileSync(pkNoirPath, "utf8");

  // Check if seed is in the header
  if (!content.includes(seedHex)) {
    console.error("Seed not found in pk.nr header");
    return false;
  }

  // Regenerate and compare first few rows
  const keyPair = RlweKeygenService.generateKeyPair(seedHex);
  const rows = RlweKeygenService.computePublicKeyRows(keyPair);

  // Check first row of PK_A
  const firstRowStr = rows.pkARows[0]!.join(", ");
  if (!content.includes(firstRowStr.substring(0, 100))) {
    console.error("First PK_A row doesn't match");
    return false;
  }

  return true;
}
