import type { Fr } from "@aztec/aztec.js";
import type { UltraHonkBackend } from "@aztec/bb.js";
import type { CompiledCircuit, Noir } from "@noir-lang/noir_js";
import { ethers } from "ethers";
import type { RlweAuditChallenge } from "../typechain-types";
import { poseidon2Hash, deriveWaAddressFromSecretKey } from "./PoolErc20Service";
import { prove } from "./utils";

// Generator indices (must match Noir)
const GENERATOR_INDEX__NOTE_NULLIFIER = 2;
const GENERATOR_INDEX__RLWE_SEED = 101;

// RLWE parameters (must match Noir)
export const RLWE_N = 1024;
export const RLWE_MESSAGE_SLOTS = 32;

export type NoirAndBackend = {
  circuit: CompiledCircuit;
  noir: Noir;
  backend: UltraHonkBackend;
};

/**
 * RLWE Audit Proof Output
 */
export interface RlweAuditOutput {
  waCommitment: string;
  ctCommitment: string;
  nullifier: string;
  // Full ciphertext for IPFS storage
  ciphertext: {
    c0Sparse: string[];
    c1: string[];
  };
}

/**
 * Audit Entry for the relayer
 */
export interface AuditEntry {
  nullifier: string;
  waCommitment: string;
  ctCommitment: string;
  ipfsCid: string;
  relayer: string;
  timestamp: number;
  challenged: boolean;
  slashed: boolean;
}

/**
 * __LatticA__: Service for generating and managing RLWE audit proofs
 *
 * This is the off-chain component of the two-proof system:
 * 1. Main proof (on-chain): Verified immediately, outputs wa_commitment
 * 2. Audit proof (off-chain): Verified by relayer, optimistic challenge
 *
 * Both proofs derive wa_commitment from the same secret_key, linking them cryptographically.
 */
export class RlweAuditService {
  constructor(
    readonly challengeContract: RlweAuditChallenge,
    private rlweAuditCircuit?: NoirAndBackend,
    private fraudProofCircuit?: NoirAndBackend,
  ) {}

  /**
   * Generate RLWE audit proof for a completed unshield transaction
   *
   * @param secretKey The user's secret key (same as used in main proof)
   * @param noteHash The hash of the note that was spent
   * @param nullifier The nullifier from the main proof (must match)
   * @param waCommitment The wa_commitment from the main proof (must match)
   * @param seedEntropy Additional entropy for RLWE seed
   */
  async generateAuditProof({
    secretKey,
    noteHash,
    nullifier,
    waCommitment,
    seedEntropy,
  }: {
    secretKey: string;
    noteHash: string;
    nullifier: string;
    waCommitment: string;
    seedEntropy?: string;
  }): Promise<{
    proof: Uint8Array;
    output: RlweAuditOutput;
  }> {
    if (!this.rlweAuditCircuit) {
      throw new Error("RLWE audit circuit not configured");
    }

    // Use random entropy if not provided
    const entropy = seedEntropy ?? ethers.hexlify(ethers.randomBytes(32));

    const input = {
      // Public inputs
      nullifier,
      wa_commitment: waCommitment,
      // Private inputs
      secret_key: secretKey,
      note_hash: noteHash,
      seed_entropy: entropy,
    };

    const { proof, returnValue } = await prove(
      "rlwe_audit",
      this.rlweAuditCircuit,
      input,
    );

    // Extract output from circuit return value
    const output: RlweAuditOutput = {
      waCommitment: returnValue.wa_commitment as string,
      ctCommitment: returnValue.ct_commitment as string,
      nullifier: returnValue.nullifier as string,
      ciphertext: {
        c0Sparse: returnValue.ciphertext?.c0_sparse ?? [],
        c1: returnValue.ciphertext?.c1 ?? [],
      },
    };

    return { proof, output };
  }

  /**
   * Submit audit entry to relayer (called after generating proof)
   *
   * In production, this would:
   * 1. Upload full ciphertext to IPFS
   * 2. Submit entry to RlweAuditChallenge contract
   */
  async submitAuditEntry({
    signer,
    nullifier,
    waCommitment,
    ctCommitment,
    ipfsCid,
  }: {
    signer: ethers.Signer;
    nullifier: string;
    waCommitment: string;
    ctCommitment: string;
    ipfsCid: string;
  }): Promise<ethers.ContractTransactionResponse> {
    return await this.challengeContract
      .connect(signer)
      .submitAuditEntry(nullifier, waCommitment, ctCommitment, ipfsCid);
  }

  /**
   * Get audit entry by nullifier
   */
  async getAuditEntry(nullifier: string): Promise<AuditEntry | null> {
    const entry = await this.challengeContract.getAuditEntry(nullifier);
    if (entry.timestamp === 0n) {
      return null;
    }

    return {
      nullifier: entry.nullifier,
      waCommitment: entry.waCommitment,
      ctCommitment: entry.ctCommitment,
      ipfsCid: entry.ipfsCid,
      relayer: entry.relayer,
      timestamp: Number(entry.timestamp),
      challenged: entry.challenged,
      slashed: entry.slashed,
    };
  }

  /**
   * Check if audit entry is valid (passed challenge period)
   */
  async isAuditEntryValid(nullifier: string): Promise<boolean> {
    return await this.challengeContract.isAuditEntryValid(nullifier);
  }

  /**
   * Submit challenge with fraud proof
   *
   * The fraud proof proves one of:
   * 1. ctCommitment != hash(actual_ciphertext)
   * 2. Ciphertext doesn't decrypt to claimed wa_address
   * 3. Noise values are not small (range proof violation)
   */
  async submitChallenge({
    signer,
    nullifier,
    fraudProof,
  }: {
    signer: ethers.Signer;
    nullifier: string;
    fraudProof: Uint8Array;
  }): Promise<ethers.ContractTransactionResponse> {
    return await this.challengeContract
      .connect(signer)
      .challenge(nullifier, fraudProof);
  }

  /**
   * Register as a relayer with stake
   */
  async registerRelayer(
    signer: ethers.Signer,
    stakeAmount: bigint,
  ): Promise<ethers.ContractTransactionResponse> {
    return await this.challengeContract
      .connect(signer)
      .registerRelayer({ value: stakeAmount });
  }

  /**
   * Unregister as relayer and withdraw stake
   */
  async unregisterRelayer(
    signer: ethers.Signer,
  ): Promise<ethers.ContractTransactionResponse> {
    return await this.challengeContract.connect(signer).unregisterRelayer();
  }

  /**
   * Get relayer info
   */
  async getRelayerInfo(
    relayer: string,
  ): Promise<{ stake: bigint; isRegistered: boolean }> {
    const info = await this.challengeContract.relayers(relayer);
    return {
      stake: info.stake,
      isRegistered: info.isRegistered,
    };
  }

  // ============================================================================
  // Helper functions for generating test fraud proofs
  // ============================================================================

  /**
   * Generate a valid RLWE ciphertext for testing
   */
  async generateValidCiphertext(
    secretKey: string,
    noteHash: string,
    nullifier: string,
    seedEntropy: string,
  ): Promise<{
    c0Sparse: bigint[];
    c1: bigint[];
    waAddress: { x: Fr; y: Fr };
  }> {
    const waAddress = await deriveWaAddressFromSecretKey(secretKey);

    // Generate RLWE seed
    const rlweSeed = await poseidon2Hash([
      secretKey,
      noteHash,
      seedEntropy,
      nullifier,
    ]);

    // Derive noise (simplified - matches Noir's derive_small_noise)
    const deriveNoise = async (seed: Fr, domain: number, index: number): Promise<bigint> => {
      const h = await poseidon2Hash([seed.toString(), domain, index]);
      // Take low 3 bits and map to [-3, 3]
      const hBigInt = BigInt(h.toString());
      const low3 = Number(hBigInt & 7n);
      return BigInt((low3 % 7) - 3);
    };

    // Generate c0_sparse (MESSAGE_SLOTS elements)
    const c0Sparse: bigint[] = [];
    for (let i = 0; i < RLWE_MESSAGE_SLOTS; i++) {
      // c0[i] = A*r + e1[i] + m[i] (simplified: just noise + message)
      const noise = await deriveNoise(rlweSeed, 1, i);
      const msgSlot = i < 16 ? BigInt(waAddress.x.toString()) >> BigInt(i * 8) & 0xFFn :
                               BigInt(waAddress.y.toString()) >> BigInt((i - 16) * 8) & 0xFFn;
      c0Sparse.push(noise + msgSlot);
    }

    // Generate c1 (N elements)
    const c1: bigint[] = [];
    for (let i = 0; i < RLWE_N; i++) {
      const noise = await deriveNoise(rlweSeed, 2, i);
      c1.push(noise);
    }

    return { c0Sparse, c1, waAddress };
  }

  /**
   * Compute ciphertext commitment (matches Noir's compute_ct_commitment)
   */
  async computeCtCommitment(c0Sparse: bigint[], c1: bigint[]): Promise<Fr> {
    // Hash c0_sparse
    const c0Hash = await poseidon2Hash(c0Sparse.map((x) => x.toString()));

    // Hash c1 in chunks of 64
    const chunkSize = 64;
    const numChunks = RLWE_N / chunkSize;
    const c1Hashes: string[] = [];

    for (let chunkIdx = 0; chunkIdx < numChunks; chunkIdx++) {
      const chunk = c1.slice(chunkIdx * chunkSize, (chunkIdx + 1) * chunkSize);
      const chunkHash = await poseidon2Hash(chunk.map((x) => x.toString()));
      c1Hashes.push(chunkHash.toString());
    }

    const c1Hash = await poseidon2Hash(c1Hashes);

    // Final commitment
    return await poseidon2Hash([c0Hash.toString(), c1Hash.toString()]);
  }
}

// ============================================================================
// Fraud Proof Types
// ============================================================================

export enum FraudType {
  INVALID_CT_COMMITMENT = 1, // ctCommitment != hash(actual_ciphertext)
  INVALID_DECRYPTION = 2, // Ciphertext doesn't decrypt correctly
  INVALID_RANGE_PROOF = 3, // Noise is not small
}

export interface FraudProofInput {
  type: FraudType;
  nullifier: string;
  waCommitment: string;
  ctCommitment: string;
  // For type 1: provide actual ciphertext that hashes differently
  actualCiphertext?: { c0Sparse: bigint[]; c1: bigint[] };
  // For type 2: provide ciphertext that doesn't decrypt to wa_address
  malformedCiphertext?: { c0Sparse: bigint[]; c1: bigint[] };
  // For type 3: provide ciphertext with noise outside range
  noisySecretKey?: string; // Different key that produces large noise
}
