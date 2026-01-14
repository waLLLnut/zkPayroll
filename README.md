<img align="right" width="150" height="150" top="100" src="https://i.ibb.co/4ZFHPTNc/411361781-c80982e6-103e-45b0-8bd1-b6c38c5debe5-Large.jpg">

# Mezcal + LatticA Audit

Fork of [nemi-fi/mezcal](https://github.com/nemi-fi/mezcal) with **RLWE-based audit system** for regulatory compliance.

> **LatticA Audit Module** enables privacy-preserving compliance for any ZK pool. Sender identities are encrypted with RLWE and can only be decrypted via 2-of-3 threshold approval by authorized auditors.

## Version Compatibility

### Backend (packages/contracts)

| Component | Version |
|-----------|---------|
| Noir | 1.0.0-beta.5 |
| @aztec/bb.js | 0.84.0-nightly.20250410 |
| @noir-lang/noir_js | 1.0.0-beta.5 |
| @aztec/aztec.js | 0.86.0 |
| Hardhat | 2.22.16 |
| Ethers | 6.13.4 |
| poseidon-lite | 0.3.0 |

### Frontend (apps/interface)

| Component | Version |
|-----------|---------|
| SvelteKit | 2.7.2 |
| Svelte | 5.0.5 |
| Vite | 5.2.11 |
| @noir-lang/noir_js | 1.0.0-beta.5 |
| @aztec/aztec.js | 0.86.0 |
| Ethers | 6.13.4 |

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│               LatticA Audit Module                      │
│    RLWE Encryption + Optimistic 2-Proof + ZK Fraud      │
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

## Two-Proof Architecture (Optimistic)

LatticA uses an **optimistic two-proof architecture** for efficient on-chain verification:

```
┌──────────────────────────────────────────────────────────────┐
│                    UNSHIELD TRANSACTION                       │
├──────────────────────────────────────────────────────────────┤
│  Main Proof (on-chain):                                       │
│    - wa_commitment = hash(wa_address)                         │
│    - Stored in UnshieldAuditLog event                         │
│                                                               │
│  Audit Proof (off-chain, submit on challenge):                │
│    - Verifies: RLWE(wa_address) is correct encryption         │
│    - ct_commitment = hash(ciphertext)                         │
│    - Full ciphertext stored on IPFS                           │
├──────────────────────────────────────────────────────────────┤
│  Challenge Period: 7 days                                     │
│  Fraud Proof Types:                                           │
│    1. ct_commitment mismatch                                  │
│    2. Decryption produces wrong wa_address                    │
│    3. Noise values out of range                               │
└──────────────────────────────────────────────────────────────┘
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

# Initialize RLWE audit system (generates keypair)
cd packages/contracts && pnpm rlwe:init

# Compile Noir circuits
cd packages/contracts/noir && nargo compile

# Run RLWE demo
pnpm demo:rlwe

# Run LatticA scenario test (shield → transfer → unshield)
pnpm test:lattica:scenario

# Run performance benchmark
pnpm benchmark:rlwe

# Deploy AuditLog contract (local)
pnpm deploy:audit-log

# Deploy to testnet
pnpm deploy:audit-log:baseSepolia
```

## Frontend Demo (Full Scenario)

프론트엔드에서 전체 시나리오(Shield → Transfer → Unshield → Audit)를 확인하려면:

### 1. 로컬 노드 시작

```bash
# Terminal 1: Hardhat 로컬 노드 실행
cd packages/contracts
pnpm hardhat node
```

### 2. 컨트랙트 배포

```bash
# Terminal 2: 컨트랙트 배포 (로컬)
cd packages/contracts
pnpm deploy:localhost
```

### 3. 프론트엔드 실행

```bash
# Terminal 3: 프론트엔드 개발 서버
cd apps/interface
pnpm dev
```

브라우저에서 `http://localhost:5173` 접속

### 4. MetaMask 설정

1. MetaMask에 로컬 네트워크 추가:
   - Network Name: `Localhost 8545`
   - RPC URL: `http://127.0.0.1:8545`
   - Chain ID: `31337`
   - Currency Symbol: `ETH`

2. Hardhat 테스트 계정 import (private key):
   ```
   0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
   ```

### 5. 시나리오 테스트

1. **Shield**: ERC20 토큰을 풀에 입금 (private balance 생성)
2. **Transfer**: Private transfer to another address
3. **Unshield**: 출금 (audit log에 암호화된 sender identity 기록)
4. **Audit Query**: 감사자가 nullifier로 audit log 조회

### CLI로 시나리오 실행

프론트엔드 없이 CLI로 전체 시나리오를 실행할 수도 있습니다:

```bash
cd packages/contracts

# 전체 시나리오 실행 (shield → transfer → unshield → audit)
pnpm demo:full-scenario

# 또는 개별 테스트
pnpm test:lattica:scenario
```

### Proving Benchmark

```bash
cd packages/contracts

# RLWE Audit 증명 시간 측정
npx tsx demo/measure_proving.ts
```

예상 결과:
```
============================================================
  SUMMARY
============================================================
  Witness generation: ~16s
  Proving time:       ~44s
  Verify time:        ~15s
  Proof size:         14,592 bytes
  Memory peak:        ~424 MB

  Gas Estimation:
    Total:            ~307,000 gas
    Cost:             ~$28 (at 30 gwei, $3000 ETH)
============================================================
```

## RLWE Key Management

```bash
# Generate new random keys
pnpm rlwe:init

# Deterministic key generation (reproducible)
pnpm rlwe:init --seed="company-audit-2024"

# Share secret key with auditors
pnpm rlwe:init --share-secret

# Keys are output to:
#   - noir/rlwe/pk.nr (public key - compiled into circuit)
#   - .rlwe_secret_key.json (secret key - store securely!)
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
│   ├── AuditLog.sol           # Standalone audit contract
│   ├── RlweAuditChallenge.sol # Optimistic challenge contract
│   ├── PoolGeneric.sol        # Pool with LWE integration
│   └── PoolERC20.sol          # ERC20 pool
├── sdk/
│   ├── AuditLogService.ts     # Audit log query & decrypt
│   ├── RlweKeygenService.ts   # RLWE key generation
│   └── scripts/
│       └── init_rlwe_system.ts # CLI for key initialization
├── demo/
│   ├── rlwe_crypto.ts         # RLWE encryption library
│   ├── babyjubjub.ts          # Baby JubJub curve ops
│   ├── benchmark_rlwe_audit.ts # Performance benchmark
│   └── test_soundness.ts      # Attack tests
├── test/
│   └── LatticA_Scenario.test.ts # Full scenario correctness test
└── noir/
    ├── rlwe/                  # Core RLWE library
    ├── rlwe_audit/            # RLWE audit proof circuit
    ├── rlwe_fraud_proof/      # Fraud proof circuit
    ├── rlwe_bench/            # Benchmark circuit
    ├── common/                # Shared types (WaAddress, etc.)
    └── rollup/                # Rollup circuit
```

## Noir Circuits

| Circuit | Description | Dependencies |
|---------|-------------|--------------|
| `rlwe` | Core RLWE encryption library | - |
| `rlwe_audit` | Proves RLWE encryption of wa_address | rlwe, common, protocol_types |
| `rlwe_fraud_proof` | Proves fraud in audit entry | rlwe, protocol_types |
| `rlwe_bench` | Performance benchmarking | rlwe |
| `common` | Shared types (WaAddress, Note) | protocol_types |
| `rollup` | Rollup circuit for batch processing | common, protocol_types |

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
