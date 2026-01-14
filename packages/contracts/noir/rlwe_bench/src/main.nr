use rlwe::{rlwe_encrypt, RlweCiphertext, RlweWitness, N};

// Benchmark circuit for RLWE encryption
// Uses provided witness (noise values) instead of seed
fn main(
    messages: pub [Field; 2],
    witness: RlweWitness,
) -> pub RlweCiphertext {
    rlwe_encrypt(messages, witness)
}
