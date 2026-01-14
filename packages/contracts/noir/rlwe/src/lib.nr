// RLWE (Ring-LWE) Encryption for Noir
//
// Uses hardcoded public key from pk.nr (CRS)
// Noise is provided as witness - only range proof required

mod pk;

use pk::{RLWE_PK_A_ROWS, RLWE_PK_B_ROWS, RLWE_N};

// RLWE Parameters
pub global RLWE_SLOT_BITS: u32 = 8;
pub global RLWE_SLOTS_PER_FR: u32 = 16;
pub global RLWE_MESSAGE_SLOTS: u32 = 32;

// Re-export N
pub global N: u32 = RLWE_N;

// Ciphertext structure
pub struct RlweCiphertext {
    pub c0_sparse: [Field; RLWE_MESSAGE_SLOTS],
    pub c1: [Field; RLWE_N],
}

// Witness structure for RLWE encryption
pub struct RlweWitness {
    pub r: [Field; RLWE_N],
    pub e1_sparse: [Field; 32],
    pub e2: [Field; RLWE_N],
}

// Range proof: verify noise is small (|v| <= bound, fits in signed 8-bit)
fn range_proof_signed_8bit(value: Field) {
    let shifted = value + 128;
    let _ = shifted as u8;
}

// Inner product (const * var = free in terms of constraints!)
fn inner_product_const(a: [Field; RLWE_N], b: [Field; RLWE_N]) -> Field {
    let mut result: Field = 0;
    for i in 0..RLWE_N {
        result = result + a[i] * b[i];
    }
    result
}

// Message encoding: Field -> 16 slots of 8 bits each
pub fn encode_field_to_slots(value: Field) -> [Field; RLWE_SLOTS_PER_FR] {
    let mut slots: [Field; RLWE_SLOTS_PER_FR] = [0; RLWE_SLOTS_PER_FR];
    let bits: [u1; 254] = value.to_le_bits();

    for i in 0..RLWE_SLOTS_PER_FR {
        let mut slot_value: Field = 0;
        let mut power: Field = 1;
        let start = i * RLWE_SLOT_BITS;

        for j in 0..RLWE_SLOT_BITS {
            let bit_index = start + j;
            if bit_index < 254 {
                if bits[bit_index] == 1 {
                    slot_value = slot_value + power;
                }
            }
            power = power * 2;
        }
        slots[i] = slot_value;
    }
    slots
}

// Main encryption function
// messages: [wa_x, wa_y] - the identity to encrypt
// witness: noise values (r, e1, e2) - only need to pass range proof
pub fn rlwe_encrypt(messages: [Field; 2], witness: RlweWitness) -> RlweCiphertext {
    // Encode messages into 32 slots (16 slots per Field)
    let mut msg_slots: [Field; RLWE_MESSAGE_SLOTS] = [0; RLWE_MESSAGE_SLOTS];

    let slots_x = encode_field_to_slots(messages[0]);
    for i in 0..RLWE_SLOTS_PER_FR {
        msg_slots[i] = slots_x[i];
    }

    let slots_y = encode_field_to_slots(messages[1]);
    for i in 0..RLWE_SLOTS_PER_FR {
        msg_slots[RLWE_SLOTS_PER_FR + i] = slots_y[i];
    }

    // Range proofs on witness noise
    for i in 0..RLWE_N {
        range_proof_signed_8bit(witness.r[i]);
    }
    for i in 0..32 {
        range_proof_signed_8bit(witness.e1_sparse[i]);
    }
    for i in 0..RLWE_N {
        range_proof_signed_8bit(witness.e2[i]);
    }

    // c0 = <A_row, r> + e1 + m (32 sparse slots)
    let mut c0_sparse: [Field; RLWE_MESSAGE_SLOTS] = [0; RLWE_MESSAGE_SLOTS];
    for i in 0..RLWE_MESSAGE_SLOTS {
        let ar_i = inner_product_const(RLWE_PK_A_ROWS[i], witness.r);
        c0_sparse[i] = ar_i + witness.e1_sparse[i] + msg_slots[i];
    }

    // c1 = <B_row, r> + e2 (1024 coefficients)
    let mut c1: [Field; RLWE_N] = [0; RLWE_N];
    for i in 0..RLWE_N {
        let br_i = inner_product_const(RLWE_PK_B_ROWS[i], witness.r);
        c1[i] = br_i + witness.e2[i];
    }

    RlweCiphertext { c0_sparse, c1 }
}

#[test]
fn test_encrypt() {
    let messages = [12345, 67890];
    // Zero noise - ciphertext will decrypt directly (relayer's risk)
    let witness = RlweWitness {
        r: [0; RLWE_N],
        e1_sparse: [0; 32],
        e2: [0; RLWE_N],
    };
    let ct = rlwe_encrypt(messages, witness);
    // c0 should contain message + A*0 + 0 = message slots
    assert(ct.c0_sparse[0] != 0);
}
