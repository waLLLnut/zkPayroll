/**
 * __LatticA__ RLWE Audit Benchmark
 *
 * Measures:
 * 1. Compile time for rlwe_audit circuit
 * 2. Proving time
 * 3. Memory usage
 * 4. Gas cost estimation
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const NOIR_DIR = path.join(__dirname, "../noir");
const RLWE_AUDIT_DIR = path.join(NOIR_DIR, "rlwe_audit");

interface BenchmarkResult {
  metric: string;
  value: string;
  unit: string;
}

const results: BenchmarkResult[] = [];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + " KB";
  if (bytes < 1024 * 1024 * 1024)
    return (bytes / 1024 / 1024).toFixed(2) + " MB";
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + " GB";
}

function measureMemory(): { heapUsed: number; heapTotal: number; rss: number } {
  const usage = process.memoryUsage();
  return {
    heapUsed: usage.heapUsed,
    heapTotal: usage.heapTotal,
    rss: usage.rss,
  };
}

async function runBenchmark() {
  console.log("=".repeat(60));
  console.log("__LatticA__ RLWE Audit Circuit Benchmark");
  console.log("=".repeat(60));
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`Noir Dir: ${NOIR_DIR}`);
  console.log();

  // ========================================
  // 1. Compile Time
  // ========================================
  console.log("[1/4] Measuring compile time...");

  const compileStart = Date.now();
  try {
    execSync(`cd ${RLWE_AUDIT_DIR} && nargo compile 2>&1`, {
      encoding: "utf8",
      maxBuffer: 50 * 1024 * 1024,
    });
  } catch (error: any) {
    console.log("  Compile output:", error.stdout || error.message);
  }
  const compileTime = (Date.now() - compileStart) / 1000;

  results.push({
    metric: "Compile Time",
    value: compileTime.toFixed(2),
    unit: "seconds",
  });
  console.log(`  Compile time: ${compileTime.toFixed(2)} seconds`);

  // ========================================
  // 2. Circuit Size (ACIR opcodes)
  // ========================================
  console.log("\n[2/4] Getting circuit info...");

  try {
    const infoOutput = execSync(`cd ${RLWE_AUDIT_DIR} && nargo info 2>&1`, {
      encoding: "utf8",
      maxBuffer: 50 * 1024 * 1024,
    });

    // Parse ACIR opcodes from output
    const opcodeMatch = infoOutput.match(/ACIR opcodes:\s*(\d+)/i);
    if (opcodeMatch) {
      results.push({
        metric: "ACIR Opcodes",
        value: opcodeMatch[1]!,
        unit: "opcodes",
      });
      console.log(`  ACIR Opcodes: ${opcodeMatch[1]}`);
    }

    // Parse circuit size
    const sizeMatch = infoOutput.match(/Circuit size:\s*(\d+)/i);
    if (sizeMatch) {
      results.push({
        metric: "Circuit Size",
        value: sizeMatch[1]!,
        unit: "gates",
      });
      console.log(`  Circuit Size: ${sizeMatch[1]} gates`);
    }
  } catch (error: any) {
    console.log("  Info output:", error.stdout || error.message);
  }

  // ========================================
  // 3. Test Time (includes proving)
  // ========================================
  console.log("\n[3/4] Measuring test execution time...");

  const memBefore = measureMemory();
  const testStart = Date.now();

  try {
    execSync(`cd ${RLWE_AUDIT_DIR} && nargo test 2>&1`, {
      encoding: "utf8",
      maxBuffer: 100 * 1024 * 1024,
    });
  } catch (error: any) {
    console.log("  Test output:", error.stdout || error.message);
  }

  const testTime = (Date.now() - testStart) / 1000;
  const memAfter = measureMemory();

  results.push({
    metric: "Test Execution Time",
    value: testTime.toFixed(2),
    unit: "seconds",
  });
  console.log(`  Test execution time: ${testTime.toFixed(2)} seconds`);

  // Memory delta
  const memDelta = memAfter.rss - memBefore.rss;
  results.push({
    metric: "Memory Delta (RSS)",
    value: formatBytes(Math.max(0, memDelta)),
    unit: "",
  });
  console.log(`  Memory delta: ${formatBytes(Math.max(0, memDelta))}`);

  // ========================================
  // 4. Artifact Size
  // ========================================
  console.log("\n[4/4] Measuring artifact sizes...");

  const targetDir = path.join(RLWE_AUDIT_DIR, "target");
  if (fs.existsSync(targetDir)) {
    const files = fs.readdirSync(targetDir);
    for (const file of files) {
      const filePath = path.join(targetDir, file);
      const stats = fs.statSync(filePath);
      if (stats.isFile()) {
        results.push({
          metric: `Artifact: ${file}`,
          value: formatBytes(stats.size),
          unit: "",
        });
        console.log(`  ${file}: ${formatBytes(stats.size)}`);
      }
    }
  }

  // ========================================
  // 5. Gas Estimation
  // ========================================
  console.log("\n[5/5] Estimating gas costs...");

  // Base gas estimates for Solidity verifier
  // These are approximate based on typical ZK proof verification
  const gasEstimates = {
    verifierDeployment: 2_500_000, // One-time deployment
    proofVerification: 300_000, // Per proof verification
    calldata: 100_000, // Proof calldata (~1KB)
    stateUpdate: 50_000, // Emit event + storage
  };

  const totalGasPerUnshield =
    gasEstimates.proofVerification +
    gasEstimates.calldata +
    gasEstimates.stateUpdate;

  results.push({
    metric: "Est. Gas per Unshield",
    value: totalGasPerUnshield.toLocaleString(),
    unit: "gas",
  });
  results.push({
    metric: "Est. Gas (3 batch)",
    value: (totalGasPerUnshield * 3).toLocaleString(),
    unit: "gas",
  });

  console.log(`  Est. gas per unshield: ${totalGasPerUnshield.toLocaleString()}`);
  console.log(
    `  Est. gas (3 batch): ${(totalGasPerUnshield * 3).toLocaleString()}`,
  );

  // Gas cost in USD (assuming 30 gwei, $3000 ETH)
  const gweiPrice = 30;
  const ethPrice = 3000;
  const gasCostUsd =
    (totalGasPerUnshield * gweiPrice * ethPrice) / 1e18;
  results.push({
    metric: "Est. Cost per Unshield",
    value: gasCostUsd.toFixed(2),
    unit: "USD (30 gwei, $3k ETH)",
  });
  console.log(`  Est. cost per unshield: $${gasCostUsd.toFixed(2)}`);

  // ========================================
  // Summary
  // ========================================
  console.log("\n" + "=".repeat(60));
  console.log("BENCHMARK SUMMARY");
  console.log("=".repeat(60));
  console.log(
    "Metric".padEnd(30) + "Value".padEnd(20) + "Unit",
  );
  console.log("-".repeat(60));

  for (const r of results) {
    console.log(
      r.metric.padEnd(30) + r.value.padEnd(20) + r.unit,
    );
  }

  console.log("-".repeat(60));

  // Export results
  const outputPath = path.join(__dirname, "benchmark_results.json");
  fs.writeFileSync(
    outputPath,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        results,
      },
      null,
      2,
    ),
  );
  console.log(`\nResults saved to: ${outputPath}`);
}

// Run benchmark
runBenchmark().catch(console.error);
