/**
 * Audit Log System
 *
 * - Stores encrypted WaAddress (sender identity) per nullifier
 * - Supports audit request/approval flow
 * - 2-out-of-3 threshold decryption for authorized access
 */

import {
  RlweCiphertext,
  RlweWitness,
  SecretShare,
  encrypt,
  partialDecrypt,
  combinePartialDecryptions,
  serializeCiphertext,
  deserializeCiphertext,
  splitSecretKey,
  verifyShare,
  generateKeyPair,
  RlweKeyPair
} from './rlwe_crypto.js';
import { WaAddress, waAddressToFields, fieldsToWaAddress, computeNullifier } from './babyjubjub.js';
import { createHash } from 'crypto';

// ==========================================
// Audit Log Storage (In-memory for demo)
// ==========================================

interface AuditLogEntry {
  nullifier: bigint;
  ciphertext: RlweCiphertext;
  timestamp: number;
  txHash?: string;
}

interface AuditRequest {
  id: string;
  requestor: string;
  nullifier: bigint;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  approvals: string[];  // Auditor IDs who approved
  createdAt: number;
}

interface DecryptedResult {
  nullifier: bigint;
  senderAddress: WaAddress;
  decryptedAt: number;
  auditors: string[];
}

export class AuditLogService {
  private logs: Map<string, AuditLogEntry> = new Map();
  private requests: Map<string, AuditRequest> = new Map();
  private decryptedResults: Map<string, DecryptedResult> = new Map();

  // Threshold decryption shares (held by different parties)
  private shares: Map<string, SecretShare> = new Map();
  private publicKey: { pk_a: bigint[]; pk_b: bigint[] } | null = null;

  constructor() {}

  /**
   * Initialize audit system with 2-out-of-3 threshold
   * Called once during system setup
   */
  async initializeThresholdKeys(
    masterSeed: string,
    auditorIds: [string, string, string]
  ): Promise<{
    pkHash: string;
    shareVerification: boolean[];
  }> {
    console.log('\n🔐 Initializing 2-out-of-3 Threshold Decryption System...\n');

    // Generate master key pair
    const keyPair = generateKeyPair(masterSeed);

    this.publicKey = {
      pk_a: keyPair.pk_a,
      pk_b: keyPair.pk_b
    };

    // Split secret key into 3 shares
    const shares = splitSecretKey(keyPair.sk, masterSeed + '_shares');

    // Distribute shares to auditors
    for (let i = 0; i < 3; i++) {
      this.shares.set(auditorIds[i], shares[i]);
      console.log(`  📤 Share ${i + 1} distributed to: ${auditorIds[i]}`);
    }

    // Verify shares by encrypting 0 and checking decryption
    console.log('\n  🔍 Verifying shares...');
    const verificationResults: boolean[] = [];

    for (let i = 0; i < 3; i++) {
      for (let j = i + 1; j < 3; j++) {
        const share1 = shares[i];
        const share2 = shares[j];
        const verified = verifyShare(share1, keyPair.pk_a, keyPair.pk_b, share2);
        verificationResults.push(verified);
        console.log(`    Pair (${i + 1}, ${j + 1}): ${verified ? '✅' : '❌'}`);
      }
    }

    // Compute public key hash for on-chain storage
    const pkHash = this.computePublicKeyHash();
    console.log(`\n  📋 Public Key Hash: ${pkHash.slice(0, 20)}...`);

    return {
      pkHash,
      shareVerification: verificationResults
    };
  }

  private computePublicKeyHash(): string {
    if (!this.publicKey) throw new Error('Keys not initialized');

    const hash = createHash('sha256');
    for (const v of this.publicKey.pk_a) {
      hash.update(v.toString(16).padStart(16, '0'));
    }
    for (const v of this.publicKey.pk_b) {
      hash.update(v.toString(16).padStart(16, '0'));
    }
    return '0x' + hash.digest('hex');
  }

  /**
   * Log a transaction with encrypted sender identity
   */
  logTransaction(
    nullifier: bigint,
    senderAddress: WaAddress,
    txHash?: string
  ): { ciphertext: RlweCiphertext; witness: RlweWitness } {
    if (!this.publicKey) throw new Error('Keys not initialized');

    // Encrypt sender's WaAddress
    const { ct, witness } = encrypt(
      this.publicKey.pk_a,
      this.publicKey.pk_b,
      waAddressToFields(senderAddress),
      `tx_${nullifier}_${Date.now()}`
    );

    // Store in audit log
    const entry: AuditLogEntry = {
      nullifier,
      ciphertext: ct,
      timestamp: Date.now(),
      txHash
    };

    this.logs.set(nullifier.toString(), entry);

    console.log(`📝 Logged transaction: nullifier=${nullifier.toString().slice(0, 20)}...`);

    return { ciphertext: ct, witness };
  }

  /**
   * Create an audit request for a specific nullifier
   */
  createAuditRequest(
    requestor: string,
    nullifier: bigint,
    reason: string
  ): AuditRequest {
    const id = createHash('sha256')
      .update(`${requestor}_${nullifier}_${Date.now()}`)
      .digest('hex')
      .slice(0, 16);

    const request: AuditRequest = {
      id,
      requestor,
      nullifier,
      reason,
      status: 'pending',
      approvals: [],
      createdAt: Date.now()
    };

    this.requests.set(id, request);

    console.log(`\n📋 Audit Request Created:`);
    console.log(`  ID: ${id}`);
    console.log(`  Requestor: ${requestor}`);
    console.log(`  Nullifier: ${nullifier.toString().slice(0, 30)}...`);
    console.log(`  Reason: ${reason}`);

    return request;
  }

  /**
   * Auditor approves a request (provides partial decryption)
   */
  approveRequest(
    requestId: string,
    auditorId: string
  ): { approved: boolean; partialDecryption?: bigint[] } {
    const request = this.requests.get(requestId);
    if (!request) throw new Error('Request not found');

    const share = this.shares.get(auditorId);
    if (!share) throw new Error('Auditor not authorized');

    if (request.approvals.includes(auditorId)) {
      throw new Error('Already approved');
    }

    // Get the ciphertext
    const entry = this.logs.get(request.nullifier.toString());
    if (!entry) throw new Error('Audit log entry not found');

    // Compute partial decryption
    const partial = partialDecrypt(share, entry.ciphertext);

    request.approvals.push(auditorId);

    console.log(`✅ Approval from: ${auditorId}`);
    console.log(`   Approvals: ${request.approvals.length}/2 required`);

    // Check if threshold reached
    if (request.approvals.length >= 2) {
      request.status = 'approved';
      console.log(`🔓 Threshold reached! Request approved.`);
    }

    return {
      approved: request.approvals.length >= 2,
      partialDecryption: partial
    };
  }

  /**
   * Complete decryption with 2 partial decryptions
   */
  completeDecryption(
    requestId: string,
    partials: { auditorId: string; partial: bigint[] }[]
  ): DecryptedResult {
    const request = this.requests.get(requestId);
    if (!request) throw new Error('Request not found');

    if (partials.length < 2) {
      throw new Error('Need at least 2 partial decryptions');
    }

    const entry = this.logs.get(request.nullifier.toString());
    if (!entry) throw new Error('Audit log entry not found');

    // Map auditor IDs to share indices
    const partialsWithIndices = partials.map(p => {
      const share = this.shares.get(p.auditorId);
      if (!share) throw new Error(`Share not found for ${p.auditorId}`);
      return { index: share.index, partial: p.partial };
    });

    // Combine partial decryptions
    const decrypted = combinePartialDecryptions(partialsWithIndices, entry.ciphertext);

    const result: DecryptedResult = {
      nullifier: request.nullifier,
      senderAddress: fieldsToWaAddress(decrypted),
      decryptedAt: Date.now(),
      auditors: partials.map(p => p.auditorId)
    };

    this.decryptedResults.set(requestId, result);

    console.log(`\n🔓 Decryption Complete:`);
    console.log(`  Sender X: ${result.senderAddress.x.toString().slice(0, 30)}...`);
    console.log(`  Sender Y: ${result.senderAddress.y.toString().slice(0, 30)}...`);

    return result;
  }

  /**
   * Get audit request status
   */
  getRequest(requestId: string): AuditRequest | undefined {
    return this.requests.get(requestId);
  }

  /**
   * Get all pending requests
   */
  getPendingRequests(): AuditRequest[] {
    return Array.from(this.requests.values()).filter(r => r.status === 'pending');
  }

  /**
   * Get decrypted result
   */
  getDecryptedResult(requestId: string): DecryptedResult | undefined {
    return this.decryptedResults.get(requestId);
  }

  /**
   * Get ciphertext for a nullifier (for on-chain storage)
   */
  getCiphertext(nullifier: bigint): RlweCiphertext | undefined {
    return this.logs.get(nullifier.toString())?.ciphertext;
  }

  /**
   * Export ciphertext as bytes for on-chain storage
   */
  exportCiphertextBytes(nullifier: bigint): Uint8Array {
    const ct = this.getCiphertext(nullifier);
    if (!ct) throw new Error('Ciphertext not found');

    // Convert to bytes: c0 (32 * 8 bytes) + c1 (1024 * 8 bytes)
    const buffer = new ArrayBuffer((32 + 1024) * 8);
    const view = new DataView(buffer);

    let offset = 0;
    for (const v of ct.c0) {
      // Write as 8 bytes (truncated from bigint)
      const bytes = this.bigintToBytes(v, 8);
      for (const b of bytes) {
        view.setUint8(offset++, b);
      }
    }
    for (const v of ct.c1) {
      const bytes = this.bigintToBytes(v, 8);
      for (const b of bytes) {
        view.setUint8(offset++, b);
      }
    }

    return new Uint8Array(buffer);
  }

  private bigintToBytes(value: bigint, length: number): Uint8Array {
    const bytes = new Uint8Array(length);
    let v = value;
    for (let i = length - 1; i >= 0; i--) {
      bytes[i] = Number(v & 0xFFn);
      v = v >> 8n;
    }
    return bytes;
  }
}

// ==========================================
// KYC Integration (Stub for demo)
// ==========================================

interface KycRecord {
  waAddress: WaAddress;
  name: string;
  email: string;
  verifiedAt: number;
}

export class KycService {
  private records: Map<string, KycRecord> = new Map();

  /**
   * Register a user with KYC info
   */
  register(waAddress: WaAddress, name: string, email: string): void {
    const key = `${waAddress.x}_${waAddress.y}`;
    this.records.set(key, {
      waAddress,
      name,
      email,
      verifiedAt: Date.now()
    });
  }

  /**
   * Look up KYC info by WaAddress
   */
  lookup(waAddress: WaAddress): KycRecord | undefined {
    const key = `${waAddress.x}_${waAddress.y}`;
    return this.records.get(key);
  }
}
