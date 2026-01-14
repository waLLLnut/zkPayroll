/**
 * RLWE Audit Proof Circuit
 *
 * This circuit proves that the RLWE ciphertext encrypts the user's wa_address
 * derived from the same secret_key used in the main unshield proof.
 *
 * Architecture:
 * 1. Main proof (erc20_unshield): Outputs wa_commitment = hash(wa_address)
 * 2. This audit proof:
 *    - Derives wa_address from secret_key (MUST use same method as common lib!)
 *    - Verifies wa_commitment matches
 *    - Performs RLWE encryption of wa_address IN CIRCUIT
 *    - Outputs ct_commitment = hash(ciphertext)
 *
 * This proves: encrypted message = wa_address derived from same secret_key
 *
 * Key insight: RLWE encryption MUST happen inside the circuit to prove
 * the connection between wa_commitment and the encrypted message.
 *
 * CRITICAL: WaAddress derivation and hashing MUST match common library exactly!
 * - WaAddress = eddsa::derive_public_key(secret_key)  (Baby JubJub)
 * - wa_commitment = poseidon2_hash_with_separator([x, y], GENERATOR_INDEX__WA_ADDRESS)
 *
 * Optimizations:
 * - Public key is hardcoded CRS (no commitment needed)
 * - Noise is witness with range proof only (relayer's choice)
 * - Inner product <const, var> is constraint-free
 */

use rlwe::{RlweWitness, RlweCiphertext, rlwe_encrypt, RLWE_MESSAGE_SLOTS, N};
use common::{WaAddress, GENERATOR_INDEX__NOTE_NULLIFIER, poseidon2_hash_with_separator};
use protocol_types::hash::poseidon2_hash;

// Output structure for RLWE audit proof
pub struct RlweAuditOutput {
    // The nullifier this audit log is for (links to main proof)
    pub nullifier: Field,
    // Commitment to wa_address (links main proof <-> this proof)
    pub wa_commitment: Field,
    // Commitment to ciphertext (hash of encrypted wa_address)
    pub ct_commitment: Field,
}

// Compute ciphertext commitment
// Hash c0_sparse (32 elements) and c1 (1024 elements in chunks)
fn compute_ct_commitment(ct: RlweCiphertext) -> Field {
    // Hash c0_sparse
    let c0_hash = poseidon2_hash(ct.c0_sparse);

    // Hash c1 in chunks of 64 elements (16 chunks total)
    let chunk_size: u32 = 64;
    let num_chunks: u32 = N / chunk_size;
    let mut c1_chunk_hashes: [Field; 16] = [0; 16];

    for chunk_idx in 0..num_chunks {
        let mut chunk: [Field; 64] = [0; 64];
        for i in 0..chunk_size {
            chunk[i] = ct.c1[chunk_idx * chunk_size + i];
        }
        c1_chunk_hashes[chunk_idx] = poseidon2_hash(chunk);
    }

    let c1_hash = poseidon2_hash(c1_chunk_hashes);

    // Final commitment
    poseidon2_hash([c0_hash, c1_hash])
}

fn main(
    // Public inputs (must match main proof's output)
    nullifier: pub Field,
    wa_commitment: pub Field,

    // Private inputs
    secret_key: Field,
    note_hash: Field,  // Used to compute nullifier

    // RLWE witness (noise values)
    rlwe_witness: RlweWitness,
) -> pub RlweAuditOutput {
    // 1. Verify nullifier is correctly derived from secret_key and note_hash
    // MUST use same derivation as common library!
    let computed_nullifier = poseidon2_hash_with_separator(
        [note_hash, secret_key],
        GENERATOR_INDEX__NOTE_NULLIFIER
    );
    assert(computed_nullifier == nullifier, "Nullifier mismatch - wrong secret_key");

    // 2. Derive WaAddress from secret_key using SAME method as common library
    // This uses Baby JubJub: WaAddress = secret_key * G (generator)
    let wa_address = WaAddress::from_secret_key(secret_key);

    // 3. Verify wa_commitment matches using SAME hash as common library
    // wa_commitment = poseidon2_hash_with_separator([x, y], GENERATOR_INDEX__WA_ADDRESS)
    let computed_wa_commitment = wa_address.to_hash();
    assert(computed_wa_commitment == wa_commitment, "WaAddress commitment mismatch");

    // 4. RLWE encrypt the wa_address (this happens IN THE CIRCUIT)
    // This proves: the encrypted message IS the wa_address from the same secret_key
    let messages: [Field; 2] = [wa_address.x, wa_address.y];
    let ciphertext = rlwe_encrypt(messages, rlwe_witness);

    // 5. Compute ciphertext commitment
    let ct_commitment = compute_ct_commitment(ciphertext);

    // Output: everything needed to verify the audit log
    RlweAuditOutput {
        nullifier,
        wa_commitment,
        ct_commitment,
    }
}

// Test function
#[test]
fn test_rlwe_audit_full() {
    let secret_key = 0x118f09bc73ec486db2030077142f2bceba2a4d4c9e0f6147d776f8ca8ec02ff1;
    let note_hash = 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef;

    // Compute expected values using SAME derivations as common library
    let nullifier = poseidon2_hash_with_separator(
        [note_hash, secret_key],
        GENERATOR_INDEX__NOTE_NULLIFIER
    );
    let wa_address = WaAddress::from_secret_key(secret_key);
    let wa_commitment = wa_address.to_hash();

    // Print computed values for TypeScript benchmark
    let wa_x = wa_address.x;
    let wa_y = wa_address.y;
    println(f"=== COMPUTED VALUES FOR TYPESCRIPT ===");
    println(f"secret_key: {secret_key}");
    println(f"note_hash: {note_hash}");
    println(f"nullifier: {nullifier}");
    println(f"wa_address_x: {wa_x}");
    println(f"wa_address_y: {wa_y}");
    println(f"wa_commitment: {wa_commitment}");
    println(f"======================================");

    // Zero noise witness (relayer's choice - trivially decryptable but valid)
    let rlwe_witness = RlweWitness {
        r: [0; N],
        e1_sparse: [0; 32],
        e2: [0; N],
    };

    // Run circuit
    let output = main(nullifier, wa_commitment, secret_key, note_hash, rlwe_witness);

    assert(output.nullifier == nullifier);
    assert(output.wa_commitment == wa_commitment);
    // ct_commitment should be non-zero
    assert(output.ct_commitment != 0);
}
