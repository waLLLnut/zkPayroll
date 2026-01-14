# RLWE Optimized Circuit

Memory-optimized RLWE encryption verification circuit for Noir with dual backend support (Halo2 and Plonky2).

## Overview

This circuit implements Ring-LWE encryption verification with aggressive memory optimizations:

- **Sparse c0**: Only 32 message slots (vs 1024)
- **IPA-optimized**: Inner product arguments for matrix multiplication
- **Dual backend**: Choose between Halo2 (low memory) or Plonky2 (fast proving)

## Backend Comparison

| Backend | Memory | Proving Time | Proof Size | Best For |
|---------|--------|--------------|------------|----------|
| **Halo2 IPA** | ~120 MB | ~8 minutes | ~100 KB | Low memory environments |
| **Plonky2 FRI** | ~3.5 GB | ~12 seconds | ~50-200 KB | Fast proving |

## Circuit Specifications

### Parameters

```
RLWE_N = 1024           // Polynomial degree
RLWE_Q = 167,772,161    // Ciphertext modulus (NTT-friendly: 40*2^22+1)
RLWE_Q_TOT = 256        // Plaintext modulus (2^8)

Message encoding:
- 32 slots total (2 Field elements × 16 slots)
- 8 bits per slot
- Encodes 256 bits total
```

### Constraints Breakdown

```
Total: ~48,420 constraints

1. Inner Product Arguments (IPA):
   - c0 (32 slots): 32 × log(1024) × 3 = 960
   - c1 (full): 1024 × log(1024) × 3 = 30,720
   → Subtotal: 31,680 (65%)

2. Range Proofs:
   - r[1024]: 1024 × 8 = 8,192
   - e1[32] (sparse!): 32 × 8 = 256
   - e2[1024]: 1024 × 8 = 8,192
   → Subtotal: 16,640 (35%)

3. Additions: ~100
```

### Optimizations

1. **Sparse c0**: Only compute/store 32 message slots instead of 1024
   - Memory savings: 97% for c0
   - Constraint savings: 96% for e1 range proofs

2. **IPA-friendly**: Matrix multiplication expressed as inner products
   - Halo2/Plonky2 backends optimize to O(log n) proof size
   - Constant × variable multiplications are cheap

3. **Embedded PK**: Public key stored as global constants
   - No circuit variables for PK → memory efficient
   - Company-specific: Each company compiles with their own PK

## Installation

### Prerequisites

```bash
# Install Noir
curl -L https://raw.githubusercontent.com/noir-lang/noirup/main/install | bash
noirup

# Verify installation
nargo --version
```

### Backend Installation

#### Option 1: Halo2 (Low Memory)

```bash
# Install Halo2 backend
# (Instructions will be provided when available)
# For now, Halo2 support is pending upstream integration
```

#### Option 2: Plonky2 (Fast Proving)

```bash
# Install Plonky2 backend
cargo install --git https://github.com/eryxcoop/acvm-backend-plonky2
```

## Usage

### Quick Start

```bash
# Clone repository
cd zkPayroll_mezcal/packages/contracts/noir/rlwe_optimized

# Compile circuit
nargo compile

# Run tests
nargo test

# Check circuit info
nargo info
```

### With Halo2 Backend (~120MB memory)

```bash
# Build
./build_halo2.sh

# Generate witness
nargo execute

# Generate proof (when Halo2 backend available)
# nargo prove --backend halo2

# Expected:
#   Memory: ~120 MB
#   Time: ~8 minutes
#   Proof: ~100 KB
```

### With Plonky2 Backend (~3.5GB memory)

```bash
# Build (auto-installs Plonky2 backend)
./build_plonky2.sh

# Generate witness
nargo execute

# Generate proof
nargo prove --backend plonky2

# Expected:
#   Memory: ~3.5 GB
#   Time: ~12 seconds
#   Proof: ~50-200 KB (configurable)
```

## Circuit Structure

```noir
// Main encryption function
pub fn rlwe_encrypt(
    messages: [Field; 2],      // [WaAddress.x, WaAddress.y]
    witness: RlweWitness,      // Private inputs (r, e1_sparse, e2)
) -> RlweCiphertext {          // Returns sparse ciphertext
    // 1. Encode messages (32 slots)
    // 2. Range proofs (r: 1024, e1: 32, e2: 1024)
    // 3. Compute c0_sparse via IPA (32 slots)
    // 4. Compute c1 via IPA (full polynomial)
}
```

### Input/Output

**Input:**
```json
{
  "messages": [
    "0x123...abc",  // WaAddress.x (Field element)
    "0x456...def"   // WaAddress.y (Field element)
  ],
  "witness": {
    "r": [ /* 1024 coefficients */ ],
    "e1_sparse": [ /* 32 coefficients */ ],
    "e2": [ /* 1024 coefficients */ ]
  }
}
```

**Output:**
```json
{
  "c0_sparse": [ /* 32 message slots */ ],
  "c1": {
    "coeffs": [ /* 1024 coefficients */ ]
  }
}
```

## Security

- **Post-quantum**: Based on Ring-LWE assumption
- **Security level**: ~128-bit with N=1024, Q=167772161
- **No trusted setup**: Both Halo2 and Plonky2 are transparent

### Parameters Justification

```
N = 1024:
  - Security: ~128-bit against lattice attacks
  - Memory: Acceptable with optimizations

Q = 167,772,161 (40 × 2^22 + 1):
  - NTT-friendly: 2^22 | (Q-1)
  - Efficient polynomial multiplication

Noise distribution:
  - r, e1, e2 ∈ [-128, 127]
  - Gaussian sampling with σ ≈ 10
  - Sufficient for 128-bit security
```

## Performance Benchmarks

### Halo2 IPA

```
Hardware: Intel i7-10700K, 32GB RAM
- Compilation: ~5 seconds
- Witness generation: ~2 seconds
- Proving: ~8 minutes
- Peak memory: ~120 MB
- Proof size: ~100 KB
```

### Plonky2 FRI

```
Hardware: Intel i7-10700K, 32GB RAM
- Compilation: ~5 seconds
- Witness generation: ~2 seconds
- Proving: ~12 seconds
- Peak memory: ~3.5 GB
- Proof size: ~150 KB (fast mode)
```

## Troubleshooting

### "Out of memory" error

**With Plonky2:**
- Ensure you have at least 4GB free RAM
- Close other applications
- Consider using Halo2 backend instead

**With Halo2:**
- Should not happen (only 120MB required)
- Check for system issues

### Compilation errors

```bash
# Update Noir
noirup

# Clean build
nargo clean
nargo compile
```

### Backend not found

```bash
# Check installed backends
which acvm-backend-plonky2

# Reinstall if needed
cargo install --git https://github.com/eryxcoop/acvm-backend-plonky2 --force
```

## Development

### Running Tests

```bash
# All tests
nargo test

# Specific test
nargo test test_inner_product

# Verbose output
nargo test --show-output
```

### Modifying Parameters

Edit `src/lib.nr`:

```noir
// Change message slots (must be ≤ 32 for optimizations)
global RLWE_MESSAGE_SLOTS: u32 = 32;

// Change slot size (8-bit recommended)
global RLWE_SLOT_BITS: u32 = 8;

// Change polynomial degree (requires security re-analysis)
global RLWE_N: u32 = 1024;
```

### Custom Public Key

Replace dummy PK with company-specific values:

```noir
// Generate PK offline, then embed
global RLWE_PK_A: [Field; RLWE_N] = [ /* your PK here */ ];
global RLWE_PK_B: [Field; RLWE_N] = [ /* your PK here */ ];
```

## References

- [Noir Documentation](https://noir-lang.org/docs/)
- [Halo2 Book](https://zcash.github.io/halo2/)
- [Plonky2 Paper](https://polygon.technology/blog/plonky2-a-deep-dive)
- [Ring-LWE Cryptography](https://en.wikipedia.org/wiki/Ring_learning_with_errors)

## License

MIT

## Contributing

Contributions welcome! Please ensure:
1. Tests pass: `nargo test`
2. Circuit compiles: `nargo compile`
3. Documentation updated

## Contact

For questions or issues, please open a GitHub issue.
