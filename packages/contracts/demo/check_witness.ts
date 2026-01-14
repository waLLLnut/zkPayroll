import { Noir } from "@noir-lang/noir_js";
import * as fs from "fs";

async function main() {
  const circuitJson = JSON.parse(fs.readFileSync("noir/target/rlwe_audit.json", "utf8"));
  const noir = new Noir(circuitJson);

  const N = 1024;
  const inputs = {
    nullifier: "0x1b810e558f7eddb692b3b5d5c6a4bcaae98d6c078db5bcd7679b2dc789d19422",
    wa_commitment: "0x0548f6d951878a4049cf367311bdbac8ad1150487cfe39bf1747d277c6468286",
    secret_key: "0x118f09bc73ec486db2030077142f2bceba2a4d4c9e0f6147d776f8ca8ec02ff1",
    note_hash: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
    rlwe_witness: {
      r: Array(N).fill("0"),
      e1_sparse: Array(32).fill("0"),
      e2: Array(N).fill("0"),
    },
  };

  console.log("Executing noir...");
  const result = await noir.execute(inputs);
  console.log("Witness length:", result.witness.length);
  console.log("Witness type:", typeof result.witness);
  console.log("Is Uint8Array:", result.witness instanceof Uint8Array);
}

main().catch(console.error);
