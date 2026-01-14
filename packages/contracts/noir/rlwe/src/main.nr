mod lib;

use crate::lib::{
    rlwe_encrypt, RlweWitness, RlwePolynomial, RlweCiphertext
};

fn main(
    messages: pub [Field; 2],
    witness: RlweWitness,
) -> pub RlweCiphertext {
    rlwe_encrypt(messages, witness)
}
