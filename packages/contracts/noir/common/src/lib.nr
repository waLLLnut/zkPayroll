pub use protocol_types::hash::poseidon2_hash_with_separator;

mod context;
mod uint253;
mod erc20_note;
pub(crate) mod note;
mod owned_note;
mod eddsa;  // Baby JubJub EdDSA implementation

pub use context::{Context, Result};
pub use note::{compute_note_hash, Note};
pub use owned_note::{NoteConsumptionInputs, OwnedNote};
pub use protocol_types::{address::EthAddress, traits::Serialize};

// Note: keep in sync with other languages
pub global NOTE_HASH_TREE_HEIGHT: u32 = 40;
// Note: keep in sync with other languages
pub global NOTE_HASH_SUBTREE_HEIGHT: u32 = 6;
// Note: keep in sync with other languages
pub global NOTE_HASH_SUBTREE_SIBLING_PATH_LENGTH: u32 =
    NOTE_HASH_TREE_HEIGHT - NOTE_HASH_SUBTREE_HEIGHT;
// Note: keep in sync with other languages
pub global MAX_NOTES_PER_ROLLUP: u32 = 64; // 2^NOTE_HASH_SUBTREE_HEIGHT

// Note: keep in sync with other languages
pub global NULLIFIER_TREE_HEIGHT: u32 = 40;
// Note: keep in sync with other languages
pub global NULLIFIER_SUBTREE_HEIGHT: u32 = 6;
// Note: keep in sync with other languages
pub global MAX_NULLIFIERS_PER_ROLLUP: u32 = 64; // 2^NULLIFIER_SUBTREE_HEIGHT
// Note: keep in sync with other languages
pub global NULLIFIER_SUBTREE_SIBLING_PATH_LENGTH: u32 =
    NULLIFIER_TREE_HEIGHT - NULLIFIER_SUBTREE_HEIGHT;

// Note: keep in sync with other languages
pub global MAX_TOKENS_IN_PER_EXECUTION: u32 = 4;
// Note: keep in sync with other languages
pub global MAX_TOKENS_OUT_PER_EXECUTION: u32 = 4;

// Note: keep in sync with other languages
pub global GENERATOR_INDEX__WA_ADDRESS: Field = 1;
// Note: keep in sync with other languages
pub global GENERATOR_INDEX__NOTE_NULLIFIER: Field = 2;
// Note: keep in sync with other languages
pub global GENERATOR_INDEX__NOTE_HASH: Field = 3;

// Note: keep in sync with other languages
pub global U256_LIMBS: u32 = 3;

pub type U256 = uint253::U253;

/// User address within the rollup (Baby JubJub public key)
///
/// This represents a user's identity in the shielded pool.
/// It is derived from a secret key using Baby JubJub elliptic curve cryptography.
///
/// Security:
/// - Public key provides ~128-bit security (ECDLP hardness)
/// - Cannot be reversed to recover secret key
/// - Supports zero-knowledge ownership proofs
///
/// Format: (x, y) coordinates on Baby JubJub twisted Edwards curve
#[derive(Eq)]
pub struct WaAddress {
    pub x: Field,  // Public key x-coordinate
    pub y: Field,  // Public key y-coordinate
}

impl Serialize<2> for WaAddress {
    fn serialize(self) -> [Field; 2] {
        [self.x, self.y]
    }
}

impl WaAddress {
    /// Zero address (identity element on curve)
    pub fn zero() -> Self {
        Self { x: 0, y: 1 }  // Identity point on twisted Edwards curve
    }

    /// Derive WaAddress from secret key using Baby JubJub
    ///
    /// Computation: WaAddress = secret_key * G (generator)
    ///
    /// This provides cryptographically strong identity unlike simple hashing.
    /// The secret key must remain private (witness only).
    pub fn from_secret_key(secret_key: Field) -> Self {
        let pubkey = eddsa::derive_public_key(secret_key);
        Self { x: pubkey.x, y: pubkey.y }
    }

    /// Compute a hash of the address for storage/comparison
    ///
    /// Used when a single Field representation is needed.
    pub fn to_hash(self) -> Field {
        poseidon2_hash_with_separator([self.x, self.y], GENERATOR_INDEX__WA_ADDRESS)
    }
}

#[derive(Eq)]
pub struct TokenAmount {
    pub token: crate::EthAddress,
    pub amount: crate::U256,
}

impl TokenAmount {
    pub fn zero(token: crate::EthAddress) -> Self {
        Self { token, amount: U256::zero() }
    }

    fn _check(self, other: Self) {
        assert_eq(self.token, other.token, "invalid token");
    }
}

impl std::ops::Add for TokenAmount {
    fn add(self, other: Self) -> Self {
        self._check(other);
        Self { token: self.token, amount: self.amount + other.amount }
    }
}

impl std::ops::Sub for TokenAmount {
    fn sub(self, other: Self) -> Self {
        self._check(other);
        Self { token: self.token, amount: self.amount - other.amount }
    }
}

impl std::cmp::Ord for TokenAmount {
    fn cmp(self, other: Self) -> std::cmp::Ordering {
        self._check(other);
        self.amount.cmp(other.amount)
    }
}

pub struct TreeRoots {
    pub note_hash_root: Field,
}
