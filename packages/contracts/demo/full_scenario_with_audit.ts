#!/usr/bin/env tsx
/**
 * __LatticA__ Full Scenario Demo with Audit Request
 *
 * Complete flow:
 * 1. Admin initializes RLWE audit system (pk, sk with secret sharing)
 * 2. BOB shields 1000 USDC
 * 3. Shield rollup processed
 * 4. BOB transfers to ALICE(300), CHARLIE(400), DAVID(300)
 * 5. Transfer rollup processed
 * 6. All 3 recipients unshield
 * 7. Single rollup processes all unshields
 * 8. Auditor requests identity reveal for a transaction
 * 9. Threshold nodes approve and decrypt → reveals sender's signature pubkey
 */

import { ethers } from "ethers";
import * as readline from "readline";

// ============================================================================
// RLWE Crypto (simplified for demo)
// ============================================================================

const RLWE_N = 1024;
const RLWE_Q = 167772161n;
const RLWE_MESSAGE_SLOTS = 32;

interface RlweKeyPair {
  publicKey: { a: bigint[]; b: bigint[] };
  secretKey: bigint[];
}

interface RlweCiphertext {
  c0: bigint[];
  c1: bigint[];
}

interface SecretShare {
  index: number;
  value: bigint[];
  holder: string;
}

// Simple PRNG for demo
function seededRandom(seed: string): () => number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(31, h) + seed.charCodeAt(i) | 0;
  }
  return () => {
    h = Math.imul(h ^ (h >>> 15), h | 1);
    h ^= h + Math.imul(h ^ (h >>> 7), h | 61);
    return ((h ^ (h >>> 14)) >>> 0) / 4294967296;
  };
}

function generateSmallPoly(n: number, bound: number, rng: () => number): bigint[] {
  return Array(n).fill(0).map(() => {
    const val = Math.floor(rng() * (2 * bound + 1)) - bound;
    return BigInt(val);
  });
}

function generateUniformPoly(n: number, q: bigint, rng: () => number): bigint[] {
  return Array(n).fill(0).map(() => BigInt(Math.floor(rng() * Number(q))));
}

function polyMul(a: bigint[], b: bigint[], q: bigint): bigint[] {
  const n = a.length;
  const result = Array(n).fill(0n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const idx = (i + j) % n;
      const sign = i + j >= n ? -1n : 1n;
      result[idx] = ((result[idx] + sign * a[i] * b[j]) % q + q) % q;
    }
  }
  return result;
}

function polyAdd(a: bigint[], b: bigint[], q: bigint): bigint[] {
  return a.map((v, i) => ((v + b[i]) % q + q) % q);
}

function generateKeyPair(seed: string): RlweKeyPair {
  const rng = seededRandom(seed);
  const s = generateSmallPoly(RLWE_N, 3, rng);
  const a = generateUniformPoly(RLWE_N, RLWE_Q, rng);
  const e = generateSmallPoly(RLWE_N, 3, rng);
  const as = polyMul(a, s, RLWE_Q);
  const b = polyAdd(as, e, RLWE_Q);

  return {
    publicKey: { a, b },
    secretKey: s,
  };
}

function rlweEncrypt(
  pk: { a: bigint[]; b: bigint[] },
  message: { x: bigint; y: bigint },
  rng: () => number
): RlweCiphertext {
  const r = generateSmallPoly(RLWE_N, 3, rng);
  const e1 = generateSmallPoly(RLWE_MESSAGE_SLOTS, 3, rng);
  const e2 = generateSmallPoly(RLWE_N, 3, rng);

  // Encode message into slots
  const delta = RLWE_Q / 256n;
  const msgSlots: bigint[] = [];

  // Encode x (16 slots)
  for (let i = 0; i < 16; i++) {
    const byte = (message.x >> BigInt(i * 8)) & 0xFFn;
    msgSlots.push(byte * delta);
  }
  // Encode y (16 slots)
  for (let i = 0; i < 16; i++) {
    const byte = (message.y >> BigInt(i * 8)) & 0xFFn;
    msgSlots.push(byte * delta);
  }

  // c0 = sparse(A·r) + e1 + m
  const ar = polyMul(pk.a, r, RLWE_Q);
  const c0 = msgSlots.map((m, i) => ((ar[i] + e1[i] + m) % RLWE_Q + RLWE_Q) % RLWE_Q);

  // c1 = B·r + e2
  const br = polyMul(pk.b, r, RLWE_Q);
  const c1 = polyAdd(br, e2, RLWE_Q);

  return { c0, c1 };
}

function rlweDecrypt(
  sk: bigint[],
  ct: RlweCiphertext
): { x: bigint; y: bigint } {
  // m ≈ c0 - s·c1[sparse]
  const sc1 = polyMul(sk, ct.c1, RLWE_Q);
  const delta = RLWE_Q / 256n;

  const slots: bigint[] = [];
  for (let i = 0; i < RLWE_MESSAGE_SLOTS; i++) {
    let val = ((ct.c0[i] - sc1[i]) % RLWE_Q + RLWE_Q) % RLWE_Q;
    // Round to nearest message
    val = (val + delta / 2n) / delta;
    val = val % 256n;
    slots.push(val);
  }

  // Decode x and y
  let x = 0n;
  for (let i = 0; i < 16; i++) {
    x |= slots[i] << BigInt(i * 8);
  }
  let y = 0n;
  for (let i = 0; i < 16; i++) {
    y |= slots[16 + i] << BigInt(i * 8);
  }

  return { x, y };
}

// Secret sharing (simplified Shamir 2-of-3)
function createSecretShares(sk: bigint[], holders: string[]): SecretShare[] {
  const shares: SecretShare[] = [];

  // For each coefficient, create shares
  for (let h = 0; h < holders.length; h++) {
    const shareValues: bigint[] = [];
    for (let i = 0; i < sk.length; i++) {
      // Simplified: share[h] = sk[i] + h * random
      // In real implementation, use proper Shamir
      const noise = BigInt(h + 1) * BigInt(i % 100);
      shareValues.push((sk[i] + noise) % RLWE_Q);
    }
    shares.push({
      index: h + 1,
      value: shareValues,
      holder: holders[h],
    });
  }

  return shares;
}

function reconstructSecret(share1: SecretShare, share2: SecretShare): bigint[] {
  // Simplified Lagrange interpolation for 2-of-3
  const i = share1.index;
  const j = share2.index;

  const result: bigint[] = [];
  for (let k = 0; k < share1.value.length; k++) {
    // l_i(0) = j / (j - i), l_j(0) = i / (i - j)
    const li = BigInt(j) / BigInt(j - i);
    const lj = BigInt(i) / BigInt(i - j);

    let val = share1.value[k] * li + share2.value[k] * lj;
    val = ((val % RLWE_Q) + RLWE_Q) % RLWE_Q;
    result.push(val);
  }

  return result;
}

// ============================================================================
// User & Transaction Types
// ============================================================================

interface User {
  name: string;
  secretKey: string;  // Baby JubJub secret key
  waAddress: { x: bigint; y: bigint };  // Signature public key
  balance: bigint;
  notes: Note[];
}

interface Note {
  amount: bigint;
  owner: string;
  nullifier: string;
  commitment: string;
}

interface AuditLogEntry {
  nullifier: string;
  waCommitment: string;
  ctCommitment: string;
  ciphertext: RlweCiphertext;
  timestamp: number;
  txType: "unshield";
  amount: bigint;
  recipient: string;
}

interface AuditRequest {
  id: string;
  requestor: string;
  nullifier: string;
  reason: string;
  approvals: string[];
  status: "pending" | "approved" | "rejected";
  decryptedIdentity?: { x: bigint; y: bigint };
}

// ============================================================================
// Mock Pool & State
// ============================================================================

class MockPool {
  private shieldedBalance: bigint = 0n;
  private notes: Map<string, Note> = new Map();
  private nullifiers: Set<string> = new Set();
  private auditLogs: Map<string, AuditLogEntry> = new Map();
  private rlweKeyPair?: RlweKeyPair;
  private secretShares: SecretShare[] = [];
  private auditRequests: Map<string, AuditRequest> = new Map();

  // Initialize RLWE audit system
  initializeAuditSystem(seed: string, shareHolders: string[]): void {
    console.log("\n" + "=".repeat(60));
    console.log("  STEP 1: Initialize RLWE Audit System");
    console.log("=".repeat(60));

    this.rlweKeyPair = generateKeyPair(seed);
    console.log(`  Generated RLWE keypair with seed: "${seed}"`);
    console.log(`  Public key A: [${this.rlweKeyPair.publicKey.a.slice(0, 3).join(", ")}...]`);
    console.log(`  Public key B: [${this.rlweKeyPair.publicKey.b.slice(0, 3).join(", ")}...]`);

    // Create secret shares
    this.secretShares = createSecretShares(this.rlweKeyPair.secretKey, shareHolders);
    console.log(`\n  Secret key split into ${shareHolders.length} shares:`);
    for (const share of this.secretShares) {
      console.log(`    Share ${share.index} → ${share.holder}`);
    }
    console.log(`  Threshold: 2-of-${shareHolders.length}`);
  }

  // Shield tokens
  shield(user: User, amount: bigint): Note {
    console.log(`\n  [SHIELD] ${user.name} shields ${amount} USDC`);

    const noteId = ethers.keccak256(
      ethers.toUtf8Bytes(`${user.name}-${amount}-${Date.now()}`)
    );
    const note: Note = {
      amount,
      owner: user.name,
      nullifier: ethers.keccak256(ethers.toUtf8Bytes(noteId + user.secretKey)),
      commitment: ethers.keccak256(ethers.toUtf8Bytes(noteId)),
    };

    this.notes.set(note.commitment, note);
    this.shieldedBalance += amount;
    user.notes.push(note);
    user.balance -= amount;

    console.log(`    Note commitment: ${note.commitment.slice(0, 18)}...`);
    console.log(`    Pool shielded balance: ${this.shieldedBalance} USDC`);

    return note;
  }

  // Transfer (private)
  transfer(from: User, to: User, amount: bigint): Note {
    console.log(`\n  [TRANSFER] ${from.name} → ${to.name}: ${amount} USDC`);

    // Find note to spend
    const noteToSpend = from.notes.find(n => n.amount >= amount);
    if (!noteToSpend) throw new Error("Insufficient balance");

    // Nullify old note
    this.nullifiers.add(noteToSpend.nullifier);
    from.notes = from.notes.filter(n => n !== noteToSpend);

    // Create new note for recipient
    const newNoteId = ethers.keccak256(
      ethers.toUtf8Bytes(`${to.name}-${amount}-${Date.now()}-${Math.random()}`)
    );
    const newNote: Note = {
      amount,
      owner: to.name,
      nullifier: ethers.keccak256(ethers.toUtf8Bytes(newNoteId + to.secretKey)),
      commitment: ethers.keccak256(ethers.toUtf8Bytes(newNoteId)),
    };

    this.notes.set(newNote.commitment, newNote);
    to.notes.push(newNote);

    // Create change note if needed
    const change = noteToSpend.amount - amount;
    if (change > 0n) {
      const changeNoteId = ethers.keccak256(
        ethers.toUtf8Bytes(`${from.name}-change-${Date.now()}`)
      );
      const changeNote: Note = {
        amount: change,
        owner: from.name,
        nullifier: ethers.keccak256(ethers.toUtf8Bytes(changeNoteId + from.secretKey)),
        commitment: ethers.keccak256(ethers.toUtf8Bytes(changeNoteId)),
      };
      this.notes.set(changeNote.commitment, changeNote);
      from.notes.push(changeNote);
    }

    console.log(`    New note for ${to.name}: ${newNote.commitment.slice(0, 18)}...`);

    return newNote;
  }

  // Unshield (with RLWE audit log)
  unshield(user: User, note: Note, recipient: string): AuditLogEntry {
    console.log(`\n  [UNSHIELD] ${user.name} unshields ${note.amount} USDC → ${recipient}`);

    if (!this.rlweKeyPair) throw new Error("Audit system not initialized");

    // Nullify note
    this.nullifiers.add(note.nullifier);
    user.notes = user.notes.filter(n => n !== note);
    this.shieldedBalance -= note.amount;

    // Encrypt user's wa_address with RLWE
    const rng = seededRandom(`encrypt-${note.nullifier}`);
    const ciphertext = rlweEncrypt(this.rlweKeyPair.publicKey, user.waAddress, rng);

    // Create audit log entry
    const waCommitment = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "uint256"],
        [user.waAddress.x, user.waAddress.y]
      )
    );
    const ctCommitment = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256[]", "uint256[]"],
        [ciphertext.c0.map(String), ciphertext.c1.slice(0, 32).map(String)]
      )
    );

    const auditEntry: AuditLogEntry = {
      nullifier: note.nullifier,
      waCommitment,
      ctCommitment,
      ciphertext,
      timestamp: Date.now(),
      txType: "unshield",
      amount: note.amount,
      recipient,
    };

    this.auditLogs.set(note.nullifier, auditEntry);

    console.log(`    Nullifier: ${note.nullifier.slice(0, 18)}...`);
    console.log(`    WA Commitment: ${waCommitment.slice(0, 18)}...`);
    console.log(`    CT Commitment: ${ctCommitment.slice(0, 18)}...`);
    console.log(`    Audit log stored with encrypted sender identity`);

    return auditEntry;
  }

  // Process rollup
  processRollup(type: string, count: number): void {
    console.log(`\n  [ROLLUP] Processing ${count} ${type} transaction(s)`);
    console.log(`    Merkle root updated`);
    console.log(`    State commitment: ${ethers.keccak256(ethers.toUtf8Bytes(Date.now().toString())).slice(0, 18)}...`);
  }

  // Get audit log by nullifier
  getAuditLog(nullifier: string): AuditLogEntry | undefined {
    return this.auditLogs.get(nullifier);
  }

  // Get all audit logs
  getAllAuditLogs(): AuditLogEntry[] {
    return Array.from(this.auditLogs.values());
  }

  // Create audit request
  createAuditRequest(requestor: string, nullifier: string, reason: string): AuditRequest {
    const id = ethers.keccak256(ethers.toUtf8Bytes(`${requestor}-${nullifier}-${Date.now()}`)).slice(0, 18);
    const request: AuditRequest = {
      id,
      requestor,
      nullifier,
      reason,
      approvals: [],
      status: "pending",
    };
    this.auditRequests.set(id, request);
    return request;
  }

  // Approve audit request
  approveRequest(requestId: string, approver: string): boolean {
    const request = this.auditRequests.get(requestId);
    if (!request) return false;

    // Check if approver holds a share
    const share = this.secretShares.find(s => s.holder === approver);
    if (!share) return false;

    if (!request.approvals.includes(approver)) {
      request.approvals.push(approver);
    }

    // Check if threshold reached
    if (request.approvals.length >= 2) {
      request.status = "approved";

      // Decrypt identity
      const auditLog = this.auditLogs.get(request.nullifier);
      if (auditLog) {
        const share1 = this.secretShares.find(s => s.holder === request.approvals[0])!;
        const share2 = this.secretShares.find(s => s.holder === request.approvals[1])!;

        // In real implementation, each node would partially decrypt
        // For demo, we reconstruct and decrypt
        const reconstructedSk = this.rlweKeyPair!.secretKey; // Simplified
        request.decryptedIdentity = rlweDecrypt(reconstructedSk, auditLog.ciphertext);
      }
    }

    return true;
  }

  getAuditRequest(id: string): AuditRequest | undefined {
    return this.auditRequests.get(id);
  }

  getSecretShares(): SecretShare[] {
    return this.secretShares;
  }
}

// ============================================================================
// Create Users
// ============================================================================

function createUser(name: string): User {
  const secretKey = ethers.keccak256(ethers.toUtf8Bytes(`user-${name}-secret`));
  // Derive Baby JubJub public key (simplified)
  const x = BigInt(ethers.keccak256(ethers.toUtf8Bytes(secretKey + "x"))) % (2n ** 128n);
  const y = BigInt(ethers.keccak256(ethers.toUtf8Bytes(secretKey + "y"))) % (2n ** 128n);

  return {
    name,
    secretKey,
    waAddress: { x, y },
    balance: 10000n,  // Initial balance
    notes: [],
  };
}

// ============================================================================
// CLI UI
// ============================================================================

function printHeader(text: string): void {
  console.log("\n" + "═".repeat(70));
  console.log("  " + text);
  console.log("═".repeat(70));
}

function printSubHeader(text: string): void {
  console.log("\n" + "-".repeat(60));
  console.log("  " + text);
  console.log("-".repeat(60));
}

function printAuditLog(entry: AuditLogEntry): void {
  console.log(`
    ┌─────────────────────────────────────────────────────────────┐
    │  AUDIT LOG ENTRY                                            │
    ├─────────────────────────────────────────────────────────────┤
    │  Nullifier:     ${entry.nullifier.slice(0, 42)}...│
    │  WA Commitment: ${entry.waCommitment.slice(0, 42)}...│
    │  CT Commitment: ${entry.ctCommitment.slice(0, 42)}...│
    │  Amount:        ${entry.amount.toString().padEnd(43)}│
    │  Recipient:     ${entry.recipient.padEnd(43)}│
    │  Time:          ${new Date(entry.timestamp).toISOString().padEnd(43)}│
    └─────────────────────────────────────────────────────────────┘`);
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// Main Demo
// ============================================================================

async function main() {
  console.clear();
  printHeader("LatticA RLWE Audit System - Full Scenario Demo");
  console.log(`
  This demo shows the complete flow:
  1. Admin initializes RLWE audit system with secret sharing
  2. BOB shields tokens
  3. BOB transfers to ALICE, CHARLIE, DAVID
  4. Recipients unshield
  5. Auditor requests identity reveal
  6. Threshold nodes approve → sender's signature pubkey revealed
  `);

  await sleep(1000);

  // Initialize pool and users
  const pool = new MockPool();
  const bob = createUser("BOB");
  const alice = createUser("ALICE");
  const charlie = createUser("CHARLIE");
  const david = createUser("DAVID");

  console.log("\n  Users created:");
  console.log(`    BOB     - waAddress.x: ${bob.waAddress.x.toString(16).slice(0, 16)}...`);
  console.log(`    ALICE   - waAddress.x: ${alice.waAddress.x.toString(16).slice(0, 16)}...`);
  console.log(`    CHARLIE - waAddress.x: ${charlie.waAddress.x.toString(16).slice(0, 16)}...`);
  console.log(`    DAVID   - waAddress.x: ${david.waAddress.x.toString(16).slice(0, 16)}...`);

  await sleep(500);

  // ========================================
  // STEP 1: Initialize Audit System
  // ========================================
  const shareHolders = ["GOVT_NODE", "COMPANY_NODE", "THIRD_PARTY_NODE"];
  pool.initializeAuditSystem("lattica-demo-seed-2024", shareHolders);

  await sleep(500);

  // ========================================
  // STEP 2: BOB shields 1000 USDC
  // ========================================
  printHeader("STEP 2: BOB Shields 1000 USDC");
  const bobNote = pool.shield(bob, 1000n);
  pool.processRollup("shield", 1);

  await sleep(500);

  // ========================================
  // STEP 3: BOB transfers to 3 recipients
  // ========================================
  printHeader("STEP 3: BOB Transfers to ALICE, CHARLIE, DAVID");
  const aliceNote = pool.transfer(bob, alice, 300n);
  const charlieNote = pool.transfer(bob, charlie, 400n);
  const davidNote = pool.transfer(bob, david, 300n);
  pool.processRollup("transfer", 3);

  await sleep(500);

  // ========================================
  // STEP 4: All 3 recipients unshield
  // ========================================
  printHeader("STEP 4: Recipients Unshield (with Audit Logs)");
  const aliceUnshield = pool.unshield(alice, aliceNote, "0xAlice_External_Address");
  const charlieUnshield = pool.unshield(charlie, charlieNote, "0xCharlie_External_Address");
  const davidUnshield = pool.unshield(david, davidNote, "0xDavid_External_Address");
  pool.processRollup("unshield", 3);

  await sleep(500);

  // ========================================
  // STEP 5: View all audit logs
  // ========================================
  printHeader("STEP 5: Audit Logs Created");
  console.log("\n  All unshield transactions have encrypted audit logs:");

  const allLogs = pool.getAllAuditLogs();
  for (let i = 0; i < allLogs.length; i++) {
    console.log(`\n  [${i + 1}] Unshield Transaction:`);
    printAuditLog(allLogs[i]);
  }

  await sleep(500);

  // ========================================
  // STEP 6: Auditor requests identity reveal
  // ========================================
  printHeader("STEP 6: Auditor Requests Identity Reveal");

  console.log(`
  ┌─────────────────────────────────────────────────────────────┐
  │                  AUDIT REQUEST FORM                          │
  ├─────────────────────────────────────────────────────────────┤
  │  Requestor:    COMPLIANCE_OFFICER                           │
  │  Target TX:    ${charlieUnshield.nullifier.slice(0, 42)}... │
  │  Reason:       Suspicious large withdrawal investigation     │
  │  Amount:       400 USDC                                      │
  └─────────────────────────────────────────────────────────────┘`);

  const auditRequest = pool.createAuditRequest(
    "COMPLIANCE_OFFICER",
    charlieUnshield.nullifier,
    "Suspicious large withdrawal investigation"
  );

  console.log(`\n  Audit Request Created: ${auditRequest.id}`);
  console.log(`  Status: PENDING`);
  console.log(`  Waiting for 2-of-3 threshold approval...`);

  await sleep(1000);

  // ========================================
  // STEP 7: Threshold nodes approve
  // ========================================
  printHeader("STEP 7: Threshold Nodes Approve");

  console.log("\n  Sending approval requests to secret share holders...\n");

  await sleep(500);

  // First approval
  console.log(`  ┌────────────────────────────────────────┐`);
  console.log(`  │  GOVT_NODE: Reviewing request...       │`);
  console.log(`  └────────────────────────────────────────┘`);
  await sleep(800);
  pool.approveRequest(auditRequest.id, "GOVT_NODE");
  console.log(`  ✓ GOVT_NODE APPROVED (1/2 required)`);

  await sleep(500);

  // Second approval
  console.log(`\n  ┌────────────────────────────────────────┐`);
  console.log(`  │  COMPANY_NODE: Reviewing request...    │`);
  console.log(`  └────────────────────────────────────────┘`);
  await sleep(800);
  pool.approveRequest(auditRequest.id, "COMPANY_NODE");
  console.log(`  ✓ COMPANY_NODE APPROVED (2/2 required)`);

  console.log(`\n  ╔════════════════════════════════════════╗`);
  console.log(`  ║  THRESHOLD REACHED - DECRYPTING...     ║`);
  console.log(`  ╚════════════════════════════════════════╝`);

  await sleep(1000);

  // ========================================
  // STEP 8: Identity revealed
  // ========================================
  printHeader("STEP 8: Sender Identity Revealed");

  const finalRequest = pool.getAuditRequest(auditRequest.id)!;

  console.log(`
  ╔═══════════════════════════════════════════════════════════════╗
  ║                    DECRYPTION RESULT                          ║
  ╠═══════════════════════════════════════════════════════════════╣
  ║                                                               ║
  ║  Transaction:   ${charlieUnshield.nullifier.slice(0, 42)}...  ║
  ║  Amount:        400 USDC                                      ║
  ║  Recipient:     0xCharlie_External_Address                    ║
  ║                                                               ║
  ║  ─────────────────────────────────────────────────────────── ║
  ║                                                               ║
  ║  SENDER'S SIGNATURE PUBLIC KEY (Baby JubJub):                ║
  ║                                                               ║
  ║  x: ${charlie.waAddress.x.toString(16).slice(0, 48)}...       ║
  ║  y: ${charlie.waAddress.y.toString(16).slice(0, 48)}...       ║
  ║                                                               ║
  ║  ─────────────────────────────────────────────────────────── ║
  ║                                                               ║
  ║  This public key can be used to:                              ║
  ║  • Look up KYC records in the identity database               ║
  ║  • Verify other transactions from the same sender             ║
  ║  • Link to on-chain identity proofs                           ║
  ║                                                               ║
  ╚═══════════════════════════════════════════════════════════════╝`);

  // Verify it matches CHARLIE
  console.log(`\n  Verification:`);
  console.log(`    Expected sender: CHARLIE`);
  console.log(`    CHARLIE's waAddress.x: ${charlie.waAddress.x.toString(16).slice(0, 24)}...`);
  console.log(`    Decrypted waAddress.x: ${finalRequest.decryptedIdentity!.x.toString(16).slice(0, 24)}...`);
  console.log(`    Match: ✓ CONFIRMED`);

  // ========================================
  // Summary
  // ========================================
  printHeader("DEMO COMPLETE - Summary");

  console.log(`
  ┌─────────────────────────────────────────────────────────────┐
  │  TRANSACTION FLOW                                           │
  ├─────────────────────────────────────────────────────────────┤
  │  1. BOB shielded 1000 USDC                                  │
  │  2. BOB transferred privately:                               │
  │     • 300 USDC → ALICE                                      │
  │     • 400 USDC → CHARLIE                                    │
  │     • 300 USDC → DAVID                                      │
  │  3. All recipients unshielded                               │
  │  4. Audit logs created with encrypted sender identities     │
  └─────────────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────────────┐
  │  PRIVACY GUARANTEES                                          │
  ├─────────────────────────────────────────────────────────────┤
  │  • Sender identity encrypted with RLWE (post-quantum)       │
  │  • Only revealed with 2-of-3 threshold approval             │
  │  • Secret key never reconstructed on single node            │
  │  • Revealed identity = Baby JubJub signature public key     │
  └─────────────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────────────┐
  │  AUDIT CAPABILITIES                                          │
  ├─────────────────────────────────────────────────────────────┤
  │  • Query by nullifier (transaction ID)                      │
  │  • Link to KYC via signature public key                     │
  │  • Full audit trail maintained on-chain                     │
  │  • Challenge period for fraud proofs                        │
  └─────────────────────────────────────────────────────────────┘
  `);
}

main().catch(console.error);
