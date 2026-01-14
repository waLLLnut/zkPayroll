/**
 * ERC20 Unshield Circuit
 *
 * Burns a shielded note and releases ERC20 tokens to an external address.
 *
 * __LatticA__ Extension:
 * - Adds wa_commitment to public output for linking with RLWE audit proof
 * - wa_commitment = hash(WaAddress) where WaAddress is derived from secret_key
 * - This allows separate RLWE audit proof to prove same identity
 */

// __LatticA__: Extended result with wa_commitment for audit linking
pub struct UnshieldResult<let NH_LEN: u32, let N_LEN: u32> {
    pub note_hashes: [Field; NH_LEN],
    pub nullifiers: [Field; N_LEN],
    // __LatticA__: Commitment to sender's WaAddress for audit proof linking
    pub wa_commitment: Field,
}

fn main(
    tree_roots: pub common::TreeRoots,
    // from
    from_secret_key: Field,
    from_note_inputs: erc20::Erc20NoteConsumptionInputs,
    // to params
    to: pub common::EthAddress,
    amount: pub common::TokenAmount,
    // change
    change_randomness: Field,
) -> pub UnshieldResult<1, 1> {
    let mut context = common::Context::from(tree_roots);

    // ==========================================================================
    // __LatticA__: Compute wa_commitment for audit proof linking
    // ==========================================================================
    let wa_address = common::WaAddress::from_secret_key(from_secret_key);
    let wa_commitment = wa_address.to_hash();
    // ==========================================================================

    // Original mezcal: execute token burn
    erc20::Token::burn(
        &mut context,
        from_secret_key,
        from_note_inputs,
        amount,
        change_randomness,
    );

    let result = context.finish();

    // Return with wa_commitment for audit linking
    UnshieldResult {
        note_hashes: result.note_hashes,
        nullifiers: result.nullifiers,
        wa_commitment,
    }
}
