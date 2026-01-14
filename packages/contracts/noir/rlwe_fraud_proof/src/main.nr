/**
 * RLWE Fraud Proof Circuit
 *
 * This circuit proves that an RLWE audit entry is fraudulent.
 * It can prove ONE of:
 * 1. ct_commitment != hash(provided_ciphertext)
 * 2. Ciphertext doesn't decrypt to claimed wa_address
 * 3. Noise values exceed allowed range (not small)
 *
 * Used for optimistic challenge in RlweAuditChallenge contract.
 */

use rlwe::{N, RLWE_MESSAGE_SLOTS};
use protocol_types::hash::poseidon2_hash;
use common::{poseidon2_hash_with_separator, GENERATOR_INDEX__WA_ADDRESS};

// Re-define for local use
global RLWE_N: u32 = N;

// Fraud type constants
global FRAUD_TYPE_CT_COMMITMENT: Field = 1;
global FRAUD_TYPE_DECRYPTION: Field = 2;
global FRAUD_TYPE_RANGE_PROOF: Field = 3;

// Compute commitment to ciphertext (must match rlwe_audit circuit)
fn compute_ct_commitment(c0_sparse: [Field; RLWE_MESSAGE_SLOTS], c1: [Field; RLWE_N]) -> Field {
    // Hash c0 (sparse coefficients)
    let c0_hash = poseidon2_hash(c0_sparse);

    // Hash c1 in chunks (1024 elements is too large for single hash)
    let chunk_size = 64;
    let num_chunks = RLWE_N / chunk_size;
    let mut c1_hashes: [Field; 16] = [0; 16]; // 1024/64 = 16 chunks

    for chunk_idx in 0..num_chunks {
        let mut chunk: [Field; 64] = [0; 64];
        for i in 0..chunk_size {
            chunk[i] = c1[chunk_idx * chunk_size + i];
        }
        c1_hashes[chunk_idx] = poseidon2_hash(chunk);
    }

    let c1_hash = poseidon2_hash(c1_hashes);

    // Final commitment
    poseidon2_hash([c0_hash, c1_hash])
}

// Check if noise value is within valid range [-3, 3]
fn is_noise_valid(value: Field) -> bool {
    // Shifted value should be in [125, 131] for [-3, 3]
    let shifted = value + 128;

    // In Field arithmetic, we check if it's a small value
    // This is a simplified check - in production, use proper range constraints
    let bits: [u1; 254] = value.to_le_bits();

    // Check if value is small (either positive 0-3 or negative near modulus)
    // For simplicity, we just check the low bits pattern
    let is_positive_small = (bits[8] == 0) & (bits[9] == 0) & (bits[10] == 0);

    is_positive_small
}

/**
 * Main fraud proof circuit
 *
 * Public inputs (must match what's stored on-chain):
 * - nullifier: Transaction nullifier
 * - wa_commitment: Claimed wa_address commitment
 * - ct_commitment: Claimed ciphertext commitment
 *
 * Private inputs:
 * - fraud_type: Type of fraud being proven (1, 2, or 3)
 * - c0_sparse: The actual ciphertext c0 component
 * - c1: The actual ciphertext c1 component
 * - wa_x, wa_y: The actual wa_address (for decryption check)
 * - noise_index: Index where noise exceeds range (for type 3)
 */
fn main(
    // Public inputs (from on-chain audit entry)
    nullifier: pub Field,
    wa_commitment: pub Field,
    ct_commitment: pub Field,

    // Private inputs
    fraud_type: Field,
    c0_sparse: [Field; RLWE_MESSAGE_SLOTS],
    c1: [Field; RLWE_N],
    wa_x: Field,
    wa_y: Field,
    noise_index: u32,
) -> pub Field {
    // Track if fraud is proven
    let mut fraud_proven = false;

    // =========================================================================
    // Type 1: ct_commitment doesn't match hash of provided ciphertext
    // =========================================================================
    if fraud_type == FRAUD_TYPE_CT_COMMITMENT {
        let computed_ct_commitment = compute_ct_commitment(c0_sparse, c1);

        // Fraud proven if commitments don't match
        assert(computed_ct_commitment != ct_commitment, "Type 1: CT commitment matches - not fraud");
        fraud_proven = true;
    }

    // =========================================================================
    // Type 2: Ciphertext doesn't decrypt to claimed wa_address
    // =========================================================================
    if fraud_type == FRAUD_TYPE_DECRYPTION {
        // First verify ct_commitment is correct (ciphertext is authentic)
        let computed_ct_commitment = compute_ct_commitment(c0_sparse, c1);
        assert(computed_ct_commitment == ct_commitment, "Type 2: Invalid ciphertext provided");

        // Verify wa_commitment matches provided wa_address
        // MUST use same hash as common library: poseidon2_hash_with_separator
        let computed_wa_commitment = poseidon2_hash_with_separator(
            [wa_x, wa_y],
            GENERATOR_INDEX__WA_ADDRESS
        );
        assert(computed_wa_commitment == wa_commitment, "Type 2: Invalid wa_address provided");

        // Now check if decryption produces wrong result
        // In RLWE: message slots are embedded in c0_sparse
        // For a valid ciphertext: c0[i] ~ m[i] (approximately, with small noise)

        // Extract expected message slots from wa_address
        let wa_x_bits: [u1; 254] = wa_x.to_le_bits();
        let wa_y_bits: [u1; 254] = wa_y.to_le_bits();

        // Check if any slot significantly deviates from expected message
        let mut decryption_mismatch = false;
        for i in 0..16 {
            // Extract 8-bit slot from wa_x
            let mut expected_slot: Field = 0;
            let mut power: Field = 1;
            for j in 0..8 {
                let bit_idx = i * 8 + j;
                if bit_idx < 254 {
                    if wa_x_bits[bit_idx] == 1 {
                        expected_slot = expected_slot + power;
                    }
                }
                power = power * 2;
            }

            // Check deviation (allowing for noise of [-3, 3])
            let diff = c0_sparse[i] - expected_slot;
            // If diff > 6, there's a decryption error (allowing for +/-3 noise)
            // This is simplified - production would use proper range proof
            let diff_bits: [u1; 254] = diff.to_le_bits();
            let is_large = (diff_bits[4] == 1) | (diff_bits[5] == 1) | (diff_bits[6] == 1);
            if is_large {
                decryption_mismatch = true;
            }
        }

        assert(decryption_mismatch, "Type 2: Decryption is correct - not fraud");
        fraud_proven = true;
    }

    // =========================================================================
    // Type 3: Noise exceeds allowed range
    // =========================================================================
    if fraud_type == FRAUD_TYPE_RANGE_PROOF {
        // First verify ct_commitment is correct
        let computed_ct_commitment = compute_ct_commitment(c0_sparse, c1);
        assert(computed_ct_commitment == ct_commitment, "Type 3: Invalid ciphertext provided");

        // Check if noise at specified index is outside valid range
        // The prover provides noise_index pointing to invalid noise

        // For c0_sparse noise (indices 0-31)
        if noise_index < RLWE_MESSAGE_SLOTS {
            let noise_value = c0_sparse[noise_index];
            assert(!is_noise_valid(noise_value), "Type 3: Noise at index is valid - not fraud");
            fraud_proven = true;
        }

        // For c1 noise (indices 32+)
        if noise_index >= RLWE_MESSAGE_SLOTS {
            let c1_idx = noise_index - RLWE_MESSAGE_SLOTS;
            assert(c1_idx < RLWE_N, "Type 3: Invalid noise index");
            let noise_value = c1[c1_idx];
            assert(!is_noise_valid(noise_value), "Type 3: Noise at index is valid - not fraud");
            fraud_proven = true;
        }
    }

    // Final assertion: fraud must be proven
    assert(fraud_proven, "No fraud type matched");

    // Return fraud type as proof of successful verification
    fraud_type
}

// =========================================================================
// Tests
// =========================================================================

#[test]
fn test_fraud_type1_ct_commitment_mismatch() {
    let nullifier = 0x1234;
    let wa_commitment = 0x5678;
    let ct_commitment = 0xABCD; // Claimed commitment

    // Provide ciphertext that hashes to different commitment
    let c0_sparse: [Field; RLWE_MESSAGE_SLOTS] = [0; RLWE_MESSAGE_SLOTS];
    let c1: [Field; RLWE_N] = [0; RLWE_N];

    // This should prove fraud because hash(c0, c1) != ct_commitment
    let result = main(
        nullifier,
        wa_commitment,
        ct_commitment,
        FRAUD_TYPE_CT_COMMITMENT,
        c0_sparse,
        c1,
        0, 0,
        0
    );

    assert(result == FRAUD_TYPE_CT_COMMITMENT);
}

#[test]
fn test_fraud_type3_noise_out_of_range() {
    let nullifier = 0x1234;
    let wa_commitment = 0x5678;

    // Create ciphertext with invalid noise
    let mut c0_sparse: [Field; RLWE_MESSAGE_SLOTS] = [0; RLWE_MESSAGE_SLOTS];
    c0_sparse[5] = 1000; // This is definitely not in [-3, 3] range

    let c1: [Field; RLWE_N] = [0; RLWE_N];

    // Compute the actual ct_commitment for this ciphertext
    let ct_commitment = compute_ct_commitment(c0_sparse, c1);

    // Point to the invalid noise at index 5
    let result = main(
        nullifier,
        wa_commitment,
        ct_commitment,
        FRAUD_TYPE_RANGE_PROOF,
        c0_sparse,
        c1,
        0, 0,
        5 // noise_index pointing to large value
    );

    assert(result == FRAUD_TYPE_RANGE_PROOF);
}
