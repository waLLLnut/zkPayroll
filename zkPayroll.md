# zkPayroll

A zero-knowledge payroll system built on Mantle Network, enabling private salary payments using shielded pool technology.

## Overview

zkPayroll implements a privacy-preserving payroll system where:
- Employers can shield tokens into a private pool
- Salaries are transferred privately between shielded addresses
- Recipients can unshield their tokens to withdraw funds
- All transactions are verified using zero-knowledge proofs

The system uses [Noir](https://noir-lang.org) for zero-knowledge circuit compilation and is built on top of Mantle Network for low-cost transactions.

## Architecture

The core contracts are located in `packages/contracts`:
- **PoolERC20**: Main contract for ERC20 token operations (shield, unshield, transfer, join)
- **PoolGeneric**: Generic rollup infrastructure for batching multiple transactions
- **Noir Circuits**: Zero-knowledge proofs for transaction verification

## Prerequisites

- Node.js 20+
- pnpm
- Rust (for Noir compilation)

## Installation

```sh
pnpm install
```

## Quick Start

### 1. Deploy Contracts

Deploy contracts to Mantle Sepolia:

```sh
cd packages/contracts
source .env
pnpm hardhat deploy-and-export --gasprice 20000000 --network mantleSepolia --reset
```

**Gas Price 옵션:**
- 숫자 값 (wei 단위): `--gasprice 20000000`
- gwei 단위: `--gasprice 20gwei`
- 환경 변수 사용: `GAS_PRICE=20000000 pnpm hardhat deploy-and-export --network mantleSepolia --reset`

### 2. Run Local Test (Bob Payroll Scenario)

Test the complete payroll scenario on localhost:

```sh
cd packages/contracts
pnpm test:bob-payroll
```

Or directly:

```sh
cd packages/contracts
npx tsx scripts/test-bob-payroll-scenario.ts
```

### 3. Run Mantle Sepolia Test

Test the payroll scenario on Mantle Sepolia:

```sh
cd packages/contracts
source .env
CI=true HARDHAT_NETWORK=mantleSepolia npx tsx scripts/test-mantle-bob-payroll.ts
```

## Test Scenarios

### Bob Payroll Scenario

The test scenario demonstrates:
1. BOB shields tokens into the shielded pool
2. BOB transfers to 3 recipients (ALICE, CHARLIE, DAVID)
3. All 3 recipients unshield their tokens

**Note**: Currently, each unshield transaction immediately transfers tokens. Future improvements will batch unshield transfers in the rollup for better efficiency.

## Project Structure

```
zkPayroll/
├── packages/
│   ├── contracts/          # Core smart contracts and SDK
│   │   ├── contracts/      # Solidity contracts
│   │   ├── noir/          # Noir zero-knowledge circuits
│   │   ├── scripts/       # Test and deployment scripts
│   │   └── sdk/           # TypeScript SDK
│   ├── interface/         # Frontend application
│   └── utils/             # Shared utilities
└── apps/
    └── interface/          # SvelteKit frontend
```

## Development

### Compile Contracts

```sh
cd packages/contracts
pnpm compile
```

### Run Tests

```sh
cd packages/contracts
pnpm test
```

## License

See LICENSE file for details.

