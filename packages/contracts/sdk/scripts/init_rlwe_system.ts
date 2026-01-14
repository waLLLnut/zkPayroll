#!/usr/bin/env tsx
/**
 * RLWE Audit System Initialization Script
 *
 * Usage:
 *   pnpm rlwe:init                          # Generate new keys
 *   pnpm rlwe:init --seed "my-seed"         # Deterministic key generation
 *   pnpm rlwe:init --share-secret           # Output secret key for sharing
 *
 * This script:
 * 1. Generates RLWE keypair (pk, sk)
 * 2. Exports public key to noir/rlwe/pk.nr as compile-time constant
 * 3. Optionally stores or shares the secret key
 */

import * as path from "path";
import * as fs from "fs";
import { RlweAuditSystemManager } from "../AuditLogService";

// Parse command line arguments
const args = process.argv.slice(2);
const seedArg = args.find((arg) => arg.startsWith("--seed="));
const seed = seedArg ? seedArg.split("=")[1] : undefined;
const shareSecret = args.includes("--share-secret");
const help = args.includes("--help") || args.includes("-h");

if (help) {
  console.log(`
RLWE Audit System Initialization

Usage:
  pnpm rlwe:init [options]

Options:
  --seed=<seed>     Use deterministic seed for key generation
  --share-secret    Output secret key JSON for sharing with auditors
  --help, -h        Show this help message

Examples:
  pnpm rlwe:init                              # Generate random keys
  pnpm rlwe:init --seed="company-audit-2024"  # Deterministic keys
  pnpm rlwe:init --share-secret               # Get secret key for sharing

The public key will be exported to noir/rlwe/pk.nr for circuit compilation.
`);
  process.exit(0);
}

async function main() {
  // Paths
  const contractsDir = path.resolve(__dirname, "../..");
  const noirRlwePath = path.join(contractsDir, "noir/rlwe");
  const secretKeyPath = path.join(contractsDir, ".rlwe_secret_key.json");

  console.log("\n");
  console.log("=".repeat(70));
  console.log("  LatticA RLWE Audit System Initialization");
  console.log("=".repeat(70));
  console.log(`\nContracts directory: ${contractsDir}`);
  console.log(`Noir RLWE path: ${noirRlwePath}`);

  // Create manager
  const manager = new RlweAuditSystemManager(noirRlwePath, secretKeyPath);

  // Initialize
  const result = await manager.initialize({
    seed,
    shareSecretKey: shareSecret,
  });

  if (!result.success) {
    console.error("\nInitialization failed!");
    process.exit(1);
  }

  console.log("\n" + "=".repeat(70));
  console.log("  Initialization Complete");
  console.log("=".repeat(70));

  console.log(`\nPublic key exported to: ${result.pkNoirPath}`);
  console.log(`Seed (save this!): ${result.seed}`);

  if (shareSecret && result.secretKeyJson) {
    console.log("\n" + "-".repeat(70));
    console.log("  SECRET KEY (Share securely with auditors)");
    console.log("-".repeat(70));
    console.log(result.secretKeyJson);
    console.log("-".repeat(70));
  }

  console.log(`
Next Steps:
1. Compile the RLWE circuits:
   cd noir/rlwe && nargo compile
   cd noir/rlwe_audit && nargo compile
   cd noir/rlwe_fraud_proof && nargo compile

2. Deploy contracts with the new verification keys

3. Store the seed securely: "${result.seed}"
   This seed can regenerate the keypair if needed.

${
  shareSecret
    ? "4. Share the secret key JSON with authorized auditors SECURELY."
    : "4. Secret key stored at: " + secretKeyPath
}
`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
