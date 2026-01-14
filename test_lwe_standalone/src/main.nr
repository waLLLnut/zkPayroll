// ===== Standalone LWE Test =====
// Minimal version to test LWE encryption logic without dependencies

// LWE Parameters
global LWE_PK_ROW: u32 = 1024;
global LWE_PK_COL: u32 = 1025;
global LWE_PK_Q: Field = 163603459;
global LWE_SLOT_BITS: u32 = 13;
global LWE_SLOTS_PER_FR: u32 = 20;
global LWE_NOISE_BITS: u32 = 8;
global LWE_ERROR_BITS: u32 = 8;
global LWE_QUOTIENT_BITS: u32 = 4;

struct LweCiphertext {
    ct: [Field; LWE_PK_COL],
}

struct LweWitness {
    s: [Field; LWE_PK_ROW],
    e: [Field; LWE_PK_COL],
    k: [Field; LWE_PK_COL],
}

struct LwePublicKey {
    pk: [[Field; LWE_PK_COL]; LWE_PK_ROW],
}

fn encode_field_to_slots(value: Field) -> [Field; LWE_SLOTS_PER_FR] {
    let mut slots: [Field; LWE_SLOTS_PER_FR] = [0; LWE_SLOTS_PER_FR];
    let mut remaining = value;
    let slot_mask = (1 << LWE_SLOT_BITS) - 1;

    for i in 0..LWE_SLOTS_PER_FR {
        let slot = remaining & slot_mask;
        slots[i] = slot;
        remaining = remaining >> LWE_SLOT_BITS;
    }

    slots
}

fn reconstruct_signed_from_bits<let N: u32>(bits: [bool; N]) -> Field {
    let mut value: u64 = 0;

    for i in 0..(N - 1) {
        if bits[i] {
            value += 1 << i;
        }
    }

    if bits[N - 1] {
        let modulus = 1 << N;
        value = (modulus - (1 << (N - 1))) + value;
    }

    value as Field
}

fn bits_to_signed<let N: u32>(value: Field) -> [bool; N] {
    let mut bits: [bool; N] = [false; N];
    let mut v = value;

    for i in 0..N {
        let bit = (v & 1) != 0;
        bits[i] = bit;
        assert(bit == false | bit == true);
        v = v >> 1;
    }

    bits
}

fn lwe_encrypt(
    pk: LwePublicKey,
    messages: [Field; 2],
    witness: LweWitness,
) -> LweCiphertext {
    let mut msg_slots: [Field; LWE_PK_COL] = [0; LWE_PK_COL];

    let slots_x = encode_field_to_slots(messages[0]);
    for i in 0..LWE_SLOTS_PER_FR {
        msg_slots[i] = slots_x[i];
    }

    let slots_y = encode_field_to_slots(messages[1]);
    for i in 0..LWE_SLOTS_PER_FR {
        msg_slots[LWE_SLOTS_PER_FR + i] = slots_y[i];
    }

    // Range proofs
    for i in 0..LWE_PK_ROW {
        let bits = bits_to_signed::<LWE_NOISE_BITS>(witness.s[i]);
        let reconstructed = reconstruct_signed_from_bits(bits);
        assert(reconstructed == witness.s[i], "s value out of range");
    }

    for j in 0..LWE_PK_COL {
        let bits = bits_to_signed::<LWE_ERROR_BITS>(witness.e[j]);
        let reconstructed = reconstruct_signed_from_bits(bits);
        assert(reconstructed == witness.e[j], "e value out of range");
    }

    for j in 0..LWE_PK_COL {
        let bits = bits_to_signed::<LWE_QUOTIENT_BITS>(witness.k[j]);
        let reconstructed = reconstruct_signed_from_bits(bits);
        assert(reconstructed == witness.k[j], "k value out of range");
    }

    let mut ct: [Field; LWE_PK_COL] = [0; LWE_PK_COL];

    for col in 0..LWE_PK_COL {
        let mut sum = witness.e[col] + msg_slots[col] + (witness.k[col] * LWE_PK_Q);
        for row in 0..LWE_PK_ROW {
            sum = sum + (pk.pk[row][col] * witness.s[row]);
        }
        ct[col] = sum;
    }

    LweCiphertext { ct }
}

fn main(
    messages: pub [Field; 2],
    witness: LweWitness,
) -> pub LweCiphertext {
    // Mock PK with zeros (for testing)
    let pk_data: [[Field; LWE_PK_COL]; LWE_PK_ROW] = [[0; LWE_PK_COL]; LWE_PK_ROW];
    let pk = LwePublicKey { pk: pk_data };

    lwe_encrypt(pk, messages, witness)
}

// Tests
#[test]
fn test_valid_encryption() {
    let pk_data: [[Field; LWE_PK_COL]; LWE_PK_ROW] = [[0; LWE_PK_COL]; LWE_PK_ROW];
    let pk = LwePublicKey { pk: pk_data };

    let addr_x = 0x1234567890abcdef;
    let addr_y = 0xfedcba0987654321;
    let messages = [addr_x, addr_y];

    let s: [Field; LWE_PK_ROW] = [0; LWE_PK_ROW];
    let e: [Field; LWE_PK_COL] = [0; LWE_PK_COL];
    let k: [Field; LWE_PK_COL] = [0; LWE_PK_COL];

    let witness = LweWitness { s, e, k };
    let ct = lwe_encrypt(pk, messages, witness);

    let slots_x = encode_field_to_slots(addr_x);
    assert(ct.ct[0] == slots_x[0], "First slot should match");
}

#[test]
fn test_range_proof_max_positive() {
    let pk_data: [[Field; LWE_PK_COL]; LWE_PK_ROW] = [[0; LWE_PK_COL]; LWE_PK_ROW];
    let pk = LwePublicKey { pk: pk_data };

    let messages = [1, 2];

    let mut s: [Field; LWE_PK_ROW] = [0; LWE_PK_ROW];
    s[0] = 127;

    let e: [Field; LWE_PK_COL] = [0; LWE_PK_COL];
    let k: [Field; LWE_PK_COL] = [0; LWE_PK_COL];

    let witness = LweWitness { s, e, k };
    let _ct = lwe_encrypt(pk, messages, witness);
}

#[test]
fn test_encoding_deterministic() {
    let value = 0x123456789abcdef;

    let slots1 = encode_field_to_slots(value);
    let slots2 = encode_field_to_slots(value);

    for i in 0..LWE_SLOTS_PER_FR {
        assert(slots1[i] == slots2[i], "Encoding not deterministic");
    }
}

#[test]
fn test_binary_decomposition_positive() {
    let value = 42;
    let bits = bits_to_signed::<LWE_NOISE_BITS>(value);
    let reconstructed = reconstruct_signed_from_bits(bits);

    assert(reconstructed == value, "Reconstruction failed for positive");
}

#[test]
fn test_quotient_max_positive() {
    let pk_data: [[Field; LWE_PK_COL]; LWE_PK_ROW] = [[0; LWE_PK_COL]; LWE_PK_ROW];
    let pk = LwePublicKey { pk: pk_data };

    let messages = [0, 0];

    let s: [Field; LWE_PK_ROW] = [0; LWE_PK_ROW];
    let e: [Field; LWE_PK_COL] = [0; LWE_PK_COL];

    let mut k: [Field; LWE_PK_COL] = [0; LWE_PK_COL];
    k[0] = 7;

    let witness = LweWitness { s, e, k };
    let ct = lwe_encrypt(pk, messages, witness);

    let expected = 7 * LWE_PK_Q;
    assert(ct.ct[0] == expected, "Quotient multiplication incorrect");
}
