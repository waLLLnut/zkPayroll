import type { ProofData } from "@aztec/bb.js";
import type { CompiledCircuit } from "@noir-lang/noir_js";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { readNativeHonkProof } from "./utils.js";

export class NativeUltraHonkBackend {
  constructor(
    readonly bbPath: string,
    readonly circuit: CompiledCircuit,
  ) {
    this.bbPath = path.normalize(bbPath);
  }

  async generateProof(witness: Uint8Array) {
    const targetDir = await this.#makeTargetDir();

    const circuitHash = await this.#getCircuitHash();
    const witnessHash = await this.#getWitnessHash(witness);

    const circuitJsonPath = path.join(targetDir, `${circuitHash}_circuit.json`);
    const witnessOutputPath = path.join(
      targetDir,
      `${circuitHash}_${witnessHash}_witness.gz`,
    );
    const proofOutputPath = path.join(
      targetDir,
      `${circuitHash}_${witnessHash}_proof`,
    );

    // proofOutputPath 디렉토리 미리 생성
    fs.mkdirSync(proofOutputPath, { recursive: true });

    fs.writeFileSync(circuitJsonPath, JSON.stringify(this.circuit));
    fs.writeFileSync(witnessOutputPath, witness);
    const args = [
      "prove",
      "--scheme",
      "ultra_honk",
      "-b",
      circuitJsonPath,
      "-w",
      witnessOutputPath,
      "-o",
      proofOutputPath,
      "--oracle_hash",
      "keccak",
      "--output_format",
      "bytes_and_fields", // proof와 public inputs를 모두 출력
    ];

    const bbProcess = spawn(this.bbPath, args);
    bbProcess.stdout.on("data", (data: string) => {
      console.log(`stdout: ${data}`);
    });

    bbProcess.stderr.on("data", (data: string) => {
      console.error(`stderr: ${data}`);
    });

    return await new Promise<ProofData>((resolve, reject) => {
      bbProcess.on("close", (code: number) => {
        if (code !== 0) {
          reject(new Error(`Process exited with code ${code}`));
          return;
        }
        resolve(readNativeHonkProof(proofOutputPath));
      });

      bbProcess.on("error", (err) => {
        reject(new Error(`Failed to start process: ${err.message}`));
      });
    });
  }

  async #getCircuitHash() {
    const input = new TextEncoder().encode(JSON.stringify(this.circuit));
    return (
      "0x" +
      Buffer.from(await crypto.subtle.digest("SHA-256", input)).toString("hex")
    );
  }

  async #getWitnessHash(witness: Uint8Array) {
    return (
      "0x" +
      Buffer.from(await crypto.subtle.digest("SHA-256", witness)).toString(
        "hex",
      )
    );
  }

  async #makeTargetDir() {
    const dirname = typeof __dirname === "string" ? __dirname : "";
    const targetDir = path.normalize(path.join(dirname, "target"));
    fs.mkdirSync(targetDir, { recursive: true });
    return targetDir;
  }
}
