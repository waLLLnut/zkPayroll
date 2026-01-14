/**
 * Measure actual proving time and memory usage with bb.js
 */

import { Noir } from "@noir-lang/noir_js";
import { UltraHonkBackend } from "@aztec/bb.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RLWE_AUDIT_JSON = path.join(
  __dirname,
  "../noir/target/rlwe_audit.json"
);

interface TimingResult {
  witnessGenTime: number;
  provingTime: number;
  verifyTime: number;
  memoryPeakMB: number;
  proofSizeBytes: number;
}

function formatTime(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
  return `${(ms / 60000).toFixed(2)}min`;
}

function formatMemory(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function getMemoryUsage(): number {
  const used = process.memoryUsage();
  return used.heapUsed + used.external;
}

async function main() {
  console.log("=".repeat(60));
  console.log("  __LatticA__ RLWE Audit - Proving Benchmark");
  console.log("=".repeat(60));
  console.log();

  // Check if circuit exists
  if (!fs.existsSync(RLWE_AUDIT_JSON)) {
    console.log("Compiling rlwe_audit circuit first...");
    const { execSync } = await import("child_process");
    execSync("nargo compile", {
      cwd: path.join(__dirname, "../noir/rlwe_audit"),
      stdio: "inherit",
    });
  }

  // Load circuit
  console.log("[1/5] Loading circuit...");
  const circuitJson = JSON.parse(fs.readFileSync(RLWE_AUDIT_JSON, "utf8"));
  console.log(`  Circuit: rlwe_audit`);
  console.log(`  Bytecode size: ${circuitJson.bytecode.length} chars`);

  // Prepare inputs
  console.log("\n[2/5] Preparing inputs...");

  // These must match the circuit's expected inputs
  // Values computed by running `nargo test --show-output` in noir/rlwe_audit
  const secret_key = "0x118f09bc73ec486db2030077142f2bceba2a4d4c9e0f6147d776f8ca8ec02ff1";
  const note_hash = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";

  // Pre-computed values from Noir test (poseidon2_hash_with_separator)
  const nullifier = "0x1b810e558f7eddb692b3b5d5c6a4bcaae98d6c078db5bcd7679b2dc789d19422";
  const wa_commitment = "0x0548f6d951878a4049cf367311bdbac8ad1150487cfe39bf1747d277c6468286";

  // RLWE witness - all zeros for simplest case
  const N = 1024;
  const rlwe_witness = {
    r: Array(N).fill("0"),
    e1_sparse: Array(32).fill("0"),
    e2: Array(N).fill("0"),
  };

  const inputs = {
    nullifier,
    wa_commitment,
    secret_key,
    note_hash,
    rlwe_witness,
  };

  console.log(`  Inputs prepared`);

  // Initialize Noir and Backend
  console.log("\n[3/5] Initializing UltraHonk backend...");
  const memBefore = getMemoryUsage();

  const noir = new Noir(circuitJson);

  console.log("  Creating UltraHonkBackend (includes SRS loading)...");
  const setupStart = performance.now();
  const backend = new UltraHonkBackend(circuitJson.bytecode);
  await backend.instantiate();
  const setupTime = performance.now() - setupStart;
  console.log(`  Backend setup: ${formatTime(setupTime)}`);
  console.log(`  Memory after init: ${formatMemory(getMemoryUsage() - memBefore)}`);

  // Generate witness
  console.log("\n[4/5] Generating witness...");
  const witnessStart = performance.now();
  let witness;
  try {
    const result = await noir.execute(inputs);
    witness = result.witness;
    console.log(`  Witness generation: ${formatTime(performance.now() - witnessStart)}`);
  } catch (e: any) {
    console.log(`  Witness generation failed: ${e.message}`);
    console.log(`  (This is expected if inputs don't match circuit expectations)`);
    console.log(`  Skipping proving benchmark...`);

    // Instead, just run nargo test with timing
    console.log("\n[Alternative] Running nargo test with timing...");
    const { execSync } = await import("child_process");
    const testStart = performance.now();
    try {
      execSync("nargo test --show-output", {
        cwd: path.join(__dirname, "../noir/rlwe_audit"),
        stdio: "pipe",
      });
      console.log(`  Test execution: ${formatTime(performance.now() - testStart)}`);
    } catch (testErr: any) {
      console.log(`  Test output: ${testErr.stdout?.toString() || testErr.message}`);
    }

    return;
  }

  // Generate proof
  console.log("\n[5/5] Generating proof (UltraHonk)...");
  const memBeforeProve = getMemoryUsage();
  const proveStart = performance.now();

  const { proof, publicInputs } = await backend.generateProof(witness);

  const provingTime = performance.now() - proveStart;
  const memPeak = getMemoryUsage() - memBefore;

  console.log(`  Proving time: ${formatTime(provingTime)}`);
  console.log(`  Proof size: ${proof.length} bytes`);
  console.log(`  Memory peak: ${formatMemory(memPeak)}`);

  // Verify
  console.log("\n[6/6] Verifying proof...");
  const verifyStart = performance.now();
  const isValid = await backend.verifyProof({ proof, publicInputs });
  const verifyTime = performance.now() - verifyStart;

  console.log(`  Verification: ${isValid ? "VALID" : "INVALID"}`);
  console.log(`  Verify time: ${formatTime(verifyTime)}`);

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("  SUMMARY");
  console.log("=".repeat(60));
  console.log(`  Witness generation: ${formatTime(performance.now() - witnessStart - provingTime)}`);
  console.log(`  Proving time:       ${formatTime(provingTime)}`);
  console.log(`  Verify time:        ${formatTime(verifyTime)}`);
  console.log(`  Proof size:         ${proof.length} bytes`);
  console.log(`  Memory peak:        ${formatMemory(memPeak)}`);
  console.log();

  // Gas estimation
  const proofSizeWords = Math.ceil(proof.length / 32);
  const calldataGas = proofSizeWords * 16; // 16 gas per non-zero byte (approx)
  const verifyGas = 300000; // UltraHonk verification ~300k gas
  const totalGas = calldataGas + verifyGas;

  console.log("  Gas Estimation:");
  console.log(`    Calldata:     ${calldataGas.toLocaleString()} gas`);
  console.log(`    Verification: ${verifyGas.toLocaleString()} gas`);
  console.log(`    Total:        ${totalGas.toLocaleString()} gas`);

  const ethPrice = 3000; // USD
  const gasPrice = 30; // gwei
  const costUSD = (totalGas * gasPrice * 1e-9 * ethPrice).toFixed(4);
  console.log(`    Cost:         $${costUSD} (at ${gasPrice} gwei, $${ethPrice} ETH)`);

}

main().catch(console.error);
