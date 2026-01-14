import type { CompiledCircuit } from "@noir-lang/noir_js";
import { ethers } from "ethers";
import { mapValues } from "lodash-es";
import type { AsyncOrSync } from "ts-essentials";
import type { PoolERC20 } from "../typechain-types";
import { EncryptionService } from "./EncryptionService";
import { LobService } from "./LobService";
import { MpcProverService } from "./mpc/MpcNetworkService";
import { PoolErc20Service } from "./PoolErc20Service";
import { type ITreesService } from "./RemoteTreesService";

export * from "./EncryptionService";
export * from "./PoolErc20Service";
export * from "./RemoteTreesService";
export * from "./AuditLogService";
export * from "./RlweKeygenService";
export * from "./RlweAuditService";

// Note: NonMembershipTree and TreesService are server-only (use @aztec/kv-store/lmdb)
// Import them from "./serverSdk" instead

export function createCoreSdk(contract: PoolERC20) {
  const encryption = EncryptionService.getSingleton();
  return {
    contract,
    encryption,
  };
}

export function createInterfaceSdk(
  coreSdk: ReturnType<typeof createCoreSdk>,
  trees: ITreesService,
  compiledCircuits: Record<
    "shield" | "unshield" | "join" | "transfer" | "swap",
    AsyncOrSync<CompiledCircuit>
  >,
) {
  const circuits = ethers.resolveProperties(
    mapValues(compiledCircuits, getCircuit),
  );
  const poolErc20 = new PoolErc20Service(
    coreSdk.contract,
    coreSdk.encryption,
    trees,
    circuits,
  );
  const mpcProver = new MpcProverService();
  const lob = new LobService(
    coreSdk.contract,
    trees,
    poolErc20,
    mpcProver,
    circuits,
  );

  return {
    poolErc20,
    lob,
  };
}

async function getCircuit(artifact: AsyncOrSync<CompiledCircuit>) {
  const { Noir } = await import("@noir-lang/noir_js");
  const { UltraHonkBackend } = await import("@aztec/bb.js");
  artifact = await artifact;
  const noir = new Noir(artifact);
  const backend = new UltraHonkBackend(artifact.bytecode);
  return { circuit: artifact, noir, backend };
}
