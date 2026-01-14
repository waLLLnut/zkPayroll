<img align="right" width="150" height="150" top="100" src="https://i.ibb.co/4ZFHPTNc/411361781-c80982e6-103e-45b0-8bd1-b6c38c5debe5-Large.jpg">

# Mezcal + LatticA Audit

Fork of [nemi-fi/mezcal](https://github.com/nemi-fi/mezcal) with **RLWE-based audit system** for regulatory compliance.

> **LatticA Audit Module** enables privacy-preserving compliance for any ZK pool. Sender identities are encrypted with RLWE and can only be decrypted via 2-of-3 threshold approval by authorized auditors.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│               LatticA Audit Module                      │
│    RLWE Encryption + 2-of-3 Threshold + ZK Proof        │
└─────────────────────────────────────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
    ┌──────────┐    ┌──────────┐    ┌──────────┐
    │  mezcal  │    │ Railgun  │    │  zkBob   │
    └──────────┘    └──────────┘    └──────────┘
          │               │               │
    ┌─────┴─────┬─────────┼─────────┬─────┴─────┐
    ▼           ▼         ▼         ▼           ▼
 Base L2    Arbitrum   Ethereum   Polygon    Optimism
```

## Features

### RLWE Audit Log
- **Encrypted sender identity**: Baby JubJub public key encrypted with RLWE
- **On-chain storage**: Ciphertext stored with nullifier as key
- **ZK proof**: Proves correct encryption without revealing plaintext

### 2-of-3 Threshold Decryption
- **Shamir secret sharing**: Secret key split into 3 shares
- **Honest non-collude assumption**: Any 2 auditors can decrypt
- **Share verification**: Zero encryption test to verify shares

### Parameters
| Parameter | Value | Description |
|-----------|-------|-------------|
| N | 1024 | Polynomial degree |
| Q | 167772161 | Modulus (prime) |
| Delta | Q/256 | Message scaling factor |
| Noise | ±3 | Small noise for correctness |
| Slots | 32 | Message slots (8-bit each) |
| Ciphertext | 1056 Fields | 32 c0 + 1024 c1 |

## Quick Start

```bash
# Install dependencies
pnpm install

# Compile contracts
pnpm compile

# Run RLWE demo
pnpm demo:rlwe

# Run soundness tests
npx tsx packages/contracts/demo/test_soundness.ts

# Deploy AuditLog contract (local)
pnpm deploy:audit-log

# Deploy to testnet
pnpm deploy:audit-log:baseSepolia
```

## Demo Output

```
📦 STEP 1: Initialize Audit System
🔐 Initializing 2-out-of-3 Threshold Decryption System...
  📤 Share 1 distributed to: auditor_govt
  📤 Share 2 distributed to: auditor_company
  📤 Share 3 distributed to: auditor_third
  🔍 Verifying shares... ✅

📦 STEP 3: Simulate Transactions
  ✅ TX1: Alice -> Bob (1000 USDC)
  ⚠️  TX2: Alice -> Suspicious Account (50000 USDC)

📦 STEP 5: Auditor Approvals
  ✅ Approval from: auditor_govt (1/2)
  ✅ Approval from: auditor_company (2/2)
  🔓 Threshold reached!

📦 STEP 7: KYC Lookup
  🔍 Identity Resolved: Alice Smith
```

## Soundness

All attack vectors tested and blocked:

| Test | Result |
|------|--------|
| Single share decrypt | ✅ Blocked |
| Wrong Lagrange indices | ✅ Blocked |
| Modified ciphertext | ✅ Blocked |
| Forged ciphertext | ✅ Blocked |
| Correct 2-of-3 decrypt | ✅ Works |

## Project Structure

```
packages/contracts/
├── contracts/
│   ├── AuditLog.sol       # Standalone audit contract
│   ├── PoolGeneric.sol    # Pool with LWE integration
│   └── PoolERC20.sol      # ERC20 pool
├── demo/
│   ├── rlwe_crypto.ts     # RLWE encryption library
│   ├── babyjubjub.ts      # Baby JubJub curve ops
│   ├── audit_log.ts       # Audit service
│   ├── demo.ts            # Full demo
│   └── test_soundness.ts  # Attack tests
└── noir/
    └── rlwe/              # ZK circuits for RLWE proof
```

## Upstream Sync

This fork tracks [nemi-fi/mezcal](https://github.com/nemi-fi/mezcal):

```bash
git fetch upstream
git checkout main && git merge upstream/main
git checkout dark-pool && git rebase main
```

## License

LatticA Audit Module code is proprietary.
Original mezcal code: See [nemi-fi/mezcal](https://github.com/nemi-fi/mezcal) for license.

---

## Original Mezcal README

Mezcal (Nahuatl: mexcalli - agave booze) - on-chain dark pool implementation using [Noir](https://noir-lang.org) and [Taceo coNoir](https://taceo.io). Hides EVERYTHING about orders and traders(tokens, amounts and addresses of traders are completely hidden). Trades settled on an EVM chain using a very simplified version of [Aztec Protocol](https://aztec.network). The tradeoff is O(N^2) order matching engine.

The code is highly experimental. The core code is located in `packages/contracts`.

### Install coSnarks

```sh
cargo install --git https://github.com/TaceoLabs/co-snarks co-noir --rev 1b2db005ee550c028af824b3ec4e811d6e8a3705
```
