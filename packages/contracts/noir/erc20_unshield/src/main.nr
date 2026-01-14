// =============================================================================
// __LatticA__ Enhanced ERC20 Unshield Circuit
// =============================================================================
//
// __LatticA__: This circuit integrates RLWE (Ring Learning With Errors) encryption
// for privacy-preserving audit logging. When a user unshields tokens from the
// dark pool, their identity (WaAddress) is encrypted using RLWE and logged
// alongside the transaction's nullifier.
//
// __LatticA__ Key Features:
// - User identity (Baby JubJub public key) is RLWE-encrypted
// - 2-of-3 threshold decryption enables regulatory compliance
// - Nullifier serves as unique transaction ID for indexing
// - Zero-knowledge proof ensures encryption correctness
//
// __LatticA__ Security Properties:
// - Privacy: Encrypted WaAddress cannot be decrypted without threshold agreement
// - Soundness: Invalid RLWE witness will fail range proofs
// - Binding: Nullifier cryptographically links to the consumed note
// =============================================================================

use rlwe::{rlwe_encrypt, RlweWitness, RLWE_N, RLWE_MESSAGE_SLOTS};

// =============================================================================
// __LatticA__ Audit Log Structure
// =============================================================================
//
// __LatticA__: This structure contains the encrypted audit log entry that gets
// emitted as a public output. It enables threshold-decryptable identity logging.
//
// __LatticA__ Fields:
// - ct_c0: First component of RLWE ciphertext (32 sparse message slots)
// - ct_c1: Second component of RLWE ciphertext (1024 polynomial coefficients)
// - nullifier: Public transaction ID derived from note_hash and secret_key
//
// __LatticA__ Decryption:
// To decrypt, 2-of-3 threshold key holders must collaborate:
//   plaintext = ct_c0 - sk * ct_c1  (mod q)
// =============================================================================
pub struct LatticA_AuditLog {
    // __LatticA__: RLWE ciphertext component c0 (encrypts WaAddress.x and WaAddress.y)
    // Contains 32 sparse slots where first 16 encode x, next 16 encode y
    pub ct_c0: [Field; RLWE_MESSAGE_SLOTS],

    // __LatticA__: RLWE ciphertext component c1 (random polynomial for decryption)
    // Full 1024-coefficient polynomial for Ring-LWE security
    pub ct_c1: [Field; RLWE_N],

    // __LatticA__: Transaction identifier (public, used for indexing audit logs)
    // Computed as: nullifier = poseidon2_hash(note_hash, secret_key)
    // This value is deterministic and can be pre-computed by the user
    pub nullifier: Field,
}

// =============================================================================
// __LatticA__ Extended Result Structure
// =============================================================================
//
// __LatticA__: Extends the standard unshield result to include the audit log.
// This ensures the encrypted identity is part of the proof's public outputs.
// =============================================================================
pub struct LatticA_UnshieldResult<let NH_LEN: u32, let N_LEN: u32> {
    // Standard dark pool outputs
    pub note_hashes: [Field; NH_LEN],
    pub nullifiers: [Field; N_LEN],

    // __LatticA__: Encrypted audit log for threshold decryption
    pub lattica_audit: LatticA_AuditLog,
}

// =============================================================================
// __LatticA__ Main Circuit Function
// =============================================================================
//
// __LatticA__: Entry point for the enhanced unshield operation.
// Performs standard token burn plus RLWE encryption of user identity.
//
// __LatticA__ Inputs:
// - tree_roots: Merkle tree roots for note membership verification
// - from_secret_key: User's Baby JubJub secret key (private witness)
// - from_note_inputs: Note to consume with Merkle proof
// - to: Ethereum address receiving unshielded tokens
// - amount: Token amount to unshield
// - change_randomness: Randomness for change note creation
// - lattica_rlwe_witness: RLWE encryption witness (r, e1, e2 polynomials)
//
// __LatticA__ Outputs:
// - note_hashes: New note commitments (change note)
// - nullifiers: Consumed note nullifiers
// - lattica_audit: Encrypted WaAddress + nullifier for audit logging
// =============================================================================
fn main(
    tree_roots: pub common::TreeRoots,

    // __LatticA__: User's secret key (witness only, never revealed)
    // Used to derive WaAddress and compute nullifier
    from_secret_key: Field,

    // Standard unshield inputs
    from_note_inputs: erc20::Erc20NoteConsumptionInputs,
    to: pub common::EthAddress,
    amount: pub common::TokenAmount,
    change_randomness: Field,

    // __LatticA__: RLWE encryption witness
    // Contains random polynomial r and error polynomials e1, e2
    // These must satisfy range constraints: |r|, |e1|, |e2| < 128
    lattica_rlwe_witness: RlweWitness,
) -> pub LatticA_UnshieldResult<1, 1> {
    let mut context = common::Context::from(tree_roots);

    // =========================================================================
    // __LatticA__ Step 1: Derive User Identity (WaAddress)
    // =========================================================================
    // __LatticA__: Compute the Baby JubJub public key from the secret key.
    // This is the identity that will be encrypted for audit purposes.
    // WaAddress = secret_key * G (elliptic curve scalar multiplication)
    let wa_address = common::WaAddress::from_secret_key(from_secret_key);

    // =========================================================================
    // __LatticA__ Step 2: Compute Nullifier (Transaction ID)
    // =========================================================================
    // __LatticA__: Compute the nullifier deterministically before note consumption.
    // This serves as a unique, pre-computable transaction identifier.
    // Formula: nullifier = poseidon2_hash(note_hash, secret_key)
    //
    // __LatticA__ Properties:
    // - Deterministic: Same inputs always produce same nullifier
    // - Unique: Each note has exactly one valid nullifier
    // - Binding: Links the transaction to the specific note being consumed
    let note_hash = common::compute_note_hash(from_note_inputs.note);
    let nullifier = common::poseidon2_hash_with_separator(
        [note_hash, from_secret_key],
        common::GENERATOR_INDEX__NOTE_NULLIFIER,
    );

    // =========================================================================
    // __LatticA__ Step 3: Encrypt WaAddress using RLWE
    // =========================================================================
    // __LatticA__: Encrypt the user's identity using Ring-LWE encryption.
    // The ciphertext can only be decrypted with 2-of-3 threshold key shares.
    //
    // __LatticA__ Message encoding:
    // - messages[0] = WaAddress.x (Baby JubJub x-coordinate)
    // - messages[1] = WaAddress.y (Baby JubJub y-coordinate)
    //
    // __LatticA__ Encryption formula:
    // - c0 = A*r + e1 + encode(message)
    // - c1 = b*r + e2
    // where (A, b) is the public key derived from threshold secret shares
    let messages = [wa_address.x, wa_address.y];
    let ct = rlwe_encrypt(messages, lattica_rlwe_witness);

    // =========================================================================
    // Standard Unshield Operation: Burn Tokens
    // =========================================================================
    // Execute the standard token burn to unshield from the dark pool
    erc20::Token::burn(
        &mut context,
        from_secret_key,
        from_note_inputs,
        amount,
        change_randomness,
    );

    let result = context.finish();

    // =========================================================================
    // __LatticA__ Step 4: Emit Result with Audit Log
    // =========================================================================
    // __LatticA__: Return the combined result containing:
    // - Standard dark pool outputs (note_hashes, nullifiers)
    // - Encrypted audit log (ct_c0, ct_c1, nullifier)
    //
    // __LatticA__ On-chain storage:
    // The lattica_audit will be stored on-chain as:
    //   AuditLog[nullifier] = (ct_c0, ct_c1)
    // This enables lookup by transaction ID while keeping identity encrypted.
    LatticA_UnshieldResult {
        note_hashes: result.note_hashes,
        nullifiers: result.nullifiers,
        lattica_audit: LatticA_AuditLog {
            ct_c0: ct.c0_sparse,
            ct_c1: ct.c1,
            nullifier,
        },
    }
}
