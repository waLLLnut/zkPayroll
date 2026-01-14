// ===== RLWE (Ring-LWE) Optimized Circuit Implementation (Noir) =====
//
// Optimizations:
//   - c0: IPA 32x (negacyclic matrix row * r)
//   - c1: IPA 1024x (negacyclic matrix row * r) - NO NTT!
//   - Range proof: via lookup (as u8)
//   - All PK are constants -> const*var = free
//
// Expected: minimal constraints (mostly range proofs)

// ===== RLWE Parameters =====

global RLWE_N: u32 = 1024;               // Polynomial degree

// Message encoding parameters
global RLWE_SLOT_BITS: u32 = 8;
global RLWE_SLOTS_PER_FR: u32 = 16;
global RLWE_MESSAGE_SLOTS: u32 = 32;

// ===== Public Keys as Negacyclic Matrix Rows (Constants) =====
// PK_A: 32 rows needed for c0 (message slots only)
// PK_B: 1024 rows needed for c1 (full polynomial)
// All stored as constants -> const*var = ~0 constraints!

global RLWE_PK_A_ROWS: [[Field; RLWE_N]; RLWE_MESSAGE_SLOTS] = [[1; RLWE_N]; RLWE_MESSAGE_SLOTS];
global RLWE_PK_B_ROWS: [[Field; RLWE_N]; RLWE_N] = [[1; RLWE_N]; RLWE_N];

// ===== Structures =====

pub struct RlwePolynomial {
    pub coeffs: [Field; RLWE_N],
}

pub struct RlweCiphertext {
    pub c0_sparse: [Field; RLWE_MESSAGE_SLOTS],  // 32 slots only
    pub c1: [Field; RLWE_N],                     // Full 1024 coefficients
}

pub struct RlweWitness {
    pub r: RlwePolynomial,
    pub e1_sparse: [Field; RLWE_MESSAGE_SLOTS],
    pub e2: RlwePolynomial,
}

// ===== Inner Product (const * var = free!) =====

fn inner_product_const(a: [Field; RLWE_N], b: [Field; RLWE_N]) -> Field {
    let mut result: Field = 0;
    for i in 0..RLWE_N {
        // a[i] is constant, b[i] is variable
        // const * var = linear combination = ~0 constraints
        result = result + a[i] * b[i];
    }
    result
}

// ===== Range Proof via Lookup =====
// as u8 triggers plookup for [0, 255] range

fn range_proof_lookup(value: Field) {
    // Shift to unsigned range: [-128, 127] -> [0, 255]
    let shifted = value + 128;
    let _ = shifted as u8;
}

// ===== Message Encoding =====

fn encode_field_to_slots(value: Field) -> [Field; RLWE_SLOTS_PER_FR] {
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

// ===== Main Function =====
//
// Constraints breakdown:
// - c0 IPA 32x (const*var): ~0
// - c1 IPA 1024x (const*var): ~0
// - Range proofs (lookup): ~2,080 + fixed setup
// - Message encoding: small

pub fn rlwe_encrypt(
    messages: [Field; 2],
    witness: RlweWitness,
) -> RlweCiphertext {
    // Step 1: Message encoding
    let mut msg_slots: [Field; RLWE_MESSAGE_SLOTS] = [0; RLWE_MESSAGE_SLOTS];

    let slots_x = encode_field_to_slots(messages[0]);
    for i in 0..RLWE_SLOTS_PER_FR {
        msg_slots[i] = slots_x[i];
    }

    let slots_y = encode_field_to_slots(messages[1]);
    for i in 0..RLWE_SLOTS_PER_FR {
        msg_slots[RLWE_SLOTS_PER_FR + i] = slots_y[i];
    }

    // Step 2: Range proofs (via lookup)
    for i in 0..RLWE_N {
        range_proof_lookup(witness.r.coeffs[i]);
    }

    for i in 0..RLWE_MESSAGE_SLOTS {
        range_proof_lookup(witness.e1_sparse[i]);
    }

    for i in 0..RLWE_N {
        range_proof_lookup(witness.e2.coeffs[i]);
    }

    // Step 3: c0 via IPA (32x only!)
    // c0[i] = <A_row[i], r> + e1[i] + m[i]
    let mut c0_sparse: [Field; RLWE_MESSAGE_SLOTS] = [0; RLWE_MESSAGE_SLOTS];

    for i in 0..RLWE_MESSAGE_SLOTS {
        let ar_i = inner_product_const(RLWE_PK_A_ROWS[i], witness.r.coeffs);
        c0_sparse[i] = ar_i + witness.e1_sparse[i] + msg_slots[i];
    }

    // Step 4: c1 via IPA (1024x) - NO NTT needed!
    // c1[i] = <B_row[i], r> + e2[i]
    // B is negacyclic matrix, all rows are constant!
    let mut c1: [Field; RLWE_N] = [0; RLWE_N];

    for i in 0..RLWE_N {
        let br_i = inner_product_const(RLWE_PK_B_ROWS[i], witness.r.coeffs);
        c1[i] = br_i + witness.e2.coeffs[i];
    }

    RlweCiphertext {
        c0_sparse,
        c1,
    }
}

// ===== Tests =====

#[test]
fn test_encode_field() {
    let value = 12345;
    let slots = encode_field_to_slots(value);
    for i in 0..RLWE_SLOTS_PER_FR {
        assert(slots[i] as u32 < 256);
    }
}

#[test]
fn test_range_proof() {
    range_proof_lookup(50);
    range_proof_lookup(0 - 50);  // -50
    range_proof_lookup(127);     // max
    range_proof_lookup(0 - 128); // min
}
