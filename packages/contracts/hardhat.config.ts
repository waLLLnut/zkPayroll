import "@nomicfoundation/hardhat-toolbox";
import "hardhat-deploy";
import "hardhat-noir";
import { HardhatUserConfig } from "hardhat/config";
import envConfig from "./envConfig";
import "./shared/typed-hardhat-deploy";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: {
        enabled: true,
        runs: 100000000,
      },
    },
  },
  noir: {
    version: "1.0.0-beta.5",
  },
  networks: {
    mantleSepolia: {
      url: process.env.RPC_URL || "https://rpc.sepolia.mantle.xyz",
      chainId: 5003,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      // Gas price can be set via environment variable or command line flag
      gasPrice: process.env.GAS_PRICE
        ? parseInt(process.env.GAS_PRICE)
        : undefined,
    },
    mantleTestnet: {
      url: process.env.MANTLE_TESTNET_RPC_URL || "https://rpc.testnet.mantle.xyz",
      chainId: 5001,
      accounts: process.env.DEPLOYER_PRIVATE_KEY
        ? [process.env.DEPLOYER_PRIVATE_KEY]
        : [],
    },
    mantleMainnet: {
      url: process.env.MANTLE_MAINNET_RPC_URL || "https://rpc.mantle.xyz",
      chainId: 5000,
      accounts: process.env.DEPLOYER_PRIVATE_KEY
        ? [process.env.DEPLOYER_PRIVATE_KEY]
        : [],
    },
  },
  etherscan: {
    apiKey: {
      sepolia: "BSFWY85F56JH998I6GBM1R4YZJTM6G5WGA",
    },
  },
  namedAccounts: {
    deployer: {
      hardhat: 0,
      localhost: 0,
      baseSepolia: `privatekey://${envConfig.DEPLOYER_PRIVATE_KEY}`,
      mantleSepolia: process.env.PRIVATE_KEY
        ? `privatekey://${process.env.PRIVATE_KEY}`
        : `privatekey://${envConfig.DEPLOYER_PRIVATE_KEY}`,
      mantleTestnet: `privatekey://${envConfig.DEPLOYER_PRIVATE_KEY}`,
      mantleMainnet: `privatekey://${envConfig.DEPLOYER_PRIVATE_KEY}`,
    },
  },
  mocha: {
    timeout: 999999999,
  },
};

export default config;
