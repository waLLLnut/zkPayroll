import { DeployFunction } from "hardhat-deploy/types";

declare module "hardhat/types/runtime" {
  interface TypedHardhatDeployNames {
    PoolERC20: "PoolERC20";
    MockERC20: "MockERC20";
  }
}

const deploy: DeployFunction = async ({
  deployments,
  typedDeployments,
  safeGetNamedAccounts,
}) => {
  const { deployer } = await safeGetNamedAccounts({ deployer: true });

  async function deployVerifier(name: string, circuitName: string) {
    return await deployments.deploy(name, {
      from: deployer,
      log: true,
      args: [],
      contract: `contracts/verifiers/${circuitName}.sol:HonkVerifier`,
    });
  }
  const shieldVerifier = await deployVerifier(
    "Erc20ShieldVerifier",
    "erc20_shield",
  );
  const unshieldVerifier = await deployVerifier(
    "Erc20UnshieldVerifier",
    "erc20_unshield",
  );
  const joinVerifier = await deployVerifier("Erc20JoinVerifier", "erc20_join");
  const transferVerifier = await deployVerifier(
    "Erc20TransferVerifier",
    "erc20_transfer",
  );
  const swapVerifier = await deployVerifier(
    "LobRouterSwapVerifier",
    "lob_router_swap",
  );
  const rollupVerifier = await deployVerifier("RollupVerifier", "rollup");

  // __LatticA__: Mock LWE public key hash for testing
  // In production, this would be derived from the threshold RLWE public key
  const lwePublicKeyHash = "0x" + "1".repeat(64);

  const pool = await typedDeployments.deploy("PoolERC20", {
    from: deployer,
    log: true,
    args: [
      shieldVerifier.address,
      unshieldVerifier.address,
      joinVerifier.address,
      transferVerifier.address,
      swapVerifier.address,
      rollupVerifier.address,
      lwePublicKeyHash,  // __LatticA__: RLWE public key hash for audit log verification
    ],
  });

  // Deploy MockERC20 for testing
  const mockERC20 = await typedDeployments.deploy("MockERC20", {
    from: deployer,
    log: true,
    args: ["USD Coin", "USDC"],
  });
};

export default deploy;
