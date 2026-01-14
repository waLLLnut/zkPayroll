import { DeployFunction } from "hardhat-deploy/types";
import { ethers } from "hardhat";

declare module "hardhat/types/runtime" {
  interface TypedHardhatDeployNames {
    AuditLog: "AuditLog";
  }
}

/**
 * Deploy AuditLog contract for RLWE-encrypted audit functionality
 *
 * The AuditLog contract stores encrypted sender identities (RLWE ciphertexts)
 * and manages 2-of-3 threshold decryption requests for compliance.
 */
const deploy: DeployFunction = async ({
  deployments,
  typedDeployments,
  safeGetNamedAccounts,
  getNamedAccounts,
  network,
}) => {
  const { deployer } = await safeGetNamedAccounts({ deployer: true });

  console.log(`\n📦 Deploying AuditLog to ${network.name}...`);
  console.log(`   Deployer: ${deployer}`);

  // For demo purposes, we use a placeholder public key hash
  // In production, this would be the hash of the actual RLWE public key
  // generated during the threshold key ceremony
  const rlwePublicKeyHash = ethers.keccak256(
    ethers.toUtf8Bytes("demo_rlwe_pk_commitment_v1")
  );

  // For demo, the deployer acts as all 3 auditors
  // In production, these would be separate addresses:
  // - auditor_govt: Government regulator
  // - auditor_company: Company compliance officer
  // - auditor_third: Independent third-party auditor
  const auditors: [string, string, string] = [
    deployer,  // In production: government regulator
    deployer,  // In production: company compliance
    deployer,  // In production: third-party auditor
  ];

  console.log(`   RLWE PK Hash: ${rlwePublicKeyHash}`);
  console.log(`   Auditors: [${auditors.join(", ")}]`);

  const auditLog = await typedDeployments.deploy("AuditLog", {
    from: deployer,
    log: true,
    args: [rlwePublicKeyHash, auditors],
  });

  console.log(`\n✅ AuditLog deployed at: ${auditLog.address}`);

  // Log deployment summary
  console.log(`\n📊 Deployment Summary:`);
  console.log(`   Contract: AuditLog`);
  console.log(`   Address: ${auditLog.address}`);
  console.log(`   Network: ${network.name}`);
  console.log(`   RLWE Ciphertext Size: 1056 Field elements (32 c0 + 1024 c1)`);
  console.log(`   Threshold: 2-of-3 auditor approval required`);
};

deploy.tags = ["AuditLog"];

export default deploy;
