// ===== Baby JubJub EdDSA Implementation =====
//
// This module provides public key derivation on the Baby JubJub curve
// for zkBob-style identity management in the Mezcal privacy protocol.
//
// Baby JubJub Curve Specification (Twisted Edwards form):
// - Equation: a*x^2 + y^2 = 1 + d*x^2*y^2
// - Field: BN254 scalar field (alt_bn128)
// - Order: 2736030358979909402780800718157159386076813972158567259200215660948447373041
//
// Security: Baby JubJub is designed for zkSNARK circuits and provides ~128-bit security.
// Reference: https://eips.ethereum.org/EIPS/eip-2494

use dep::std::embedded_curve_ops::{EmbeddedCurvePoint, EmbeddedCurveScalar, fixed_base_scalar_mul};

/// Baby JubJub public key (point on twisted Edwards curve)
/// Represents user identity in the shielded pool
#[derive(Eq)]
pub struct PublicKey {
    pub x: Field,
    pub y: Field,
}

impl PublicKey {
    /// Create a new public key from curve coordinates
    pub fn new(x: Field, y: Field) -> Self {
        Self { x, y }
    }

    /// Convert to embedded curve point for operations
    fn to_point(self) -> EmbeddedCurvePoint {
        EmbeddedCurvePoint { x: self.x, y: self.y, is_infinite: false }
    }
}

/// Derive Baby JubJub public key from secret key
///
/// Computation: PubKey = secret_key * G (generator point)
///
/// Uses Noir's built-in `fixed_base_scalar_mul` which performs
/// scalar multiplication on the Baby JubJub base point embedded in BN254.
///
/// Security:
/// - secret_key must be kept private (witness only)
/// - public_key can be safely revealed (used as WaAddress)
/// - ECDLP hardness ensures secret_key cannot be recovered from public_key
///
/// Example:
/// ```
/// let secret = 0x123456...;
/// let pubkey = derive_public_key(secret);
/// // pubkey can be used as WaAddress
/// ```
pub fn derive_public_key(secret_key: Field) -> PublicKey {
    // Convert secret key to embedded curve scalar
    // Split Field into two u64 parts (low and high)
    let bytes: [u8; 32] = secret_key.to_be_bytes();

    // lo = lower 128 bits (bytes 16-31), hi = upper 128 bits (bytes 0-15)
    let mut lo: Field = 0;
    let mut hi: Field = 0;

    for i in 0..16 {
        hi = hi * 256 + bytes[i] as Field;
    }
    for i in 16..32 {
        lo = lo * 256 + bytes[i] as Field;
    }

    let scalar = EmbeddedCurveScalar { lo, hi };

    // Scalar multiplication: PubKey = secret_key * G
    // This uses the Baby JubJub generator point G embedded in BN254
    let point = fixed_base_scalar_mul(scalar);

    PublicKey::new(point.x, point.y)
}

/// Verify that a public key corresponds to a secret key
///
/// Used in circuits to prove note ownership without revealing secret_key.
/// This is more efficient than full EdDSA signature verification.
///
/// Security: If this check passes, prover knows secret_key (knowledge proof)
pub fn verify_keypair(secret_key: Field, public_key: PublicKey) -> bool {
    let derived = derive_public_key(secret_key);
    (derived.x == public_key.x) & (derived.y == public_key.y)
}

#[test]
fn test_derive_public_key() {
    // Test public key derivation
    let secret = 12345;
    let pubkey = derive_public_key(secret);

    // Public key should be non-zero
    assert(pubkey.x != 0);
    assert(pubkey.y != 0);

    // Deriving again should give same result
    let pubkey2 = derive_public_key(secret);
    assert(pubkey.x == pubkey2.x);
    assert(pubkey.y == pubkey2.y);
}

#[test]
fn test_verify_keypair() {
    let secret = 67890;
    let pubkey = derive_public_key(secret);

    // Correct keypair should verify
    assert(verify_keypair(secret, pubkey));

    // Wrong secret should fail
    let wrong_secret = 11111;
    assert(!verify_keypair(wrong_secret, pubkey));
}
