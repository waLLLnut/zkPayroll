#!/usr/bin/env tsx
/**
 * Mantle Sepolia BOB Payroll 시나리오 테스트
 */

import { expect } from "chai";
import { ethers, noir, typedDeployments } from "hardhat";
import { sdk } from "../sdk";
import { createBackendSdk } from "../sdk/backendSdk";
import { parseUnits } from "../shared/utils";
import { MockERC20__factory, PoolERC20__factory } from "../typechain-types";

// Unshield 받을 주소들
const ALICE_ADDRESS = "0x3D3AB5dA5bD119bF02AD0805c9ECFAc4128cFF8B";
const CHARLIE_ADDRESS = "0x997006319a1f8d98068Ac0bc39FEfacF7F728DcE";
const DAVID_ADDRESS = "0x7A98B203A1c8cE832057a6Cbf28fB2967723f20f";

async function main() {
  console.log("🚀 Mantle Sepolia BOB Payroll 시나리오 테스트 시작\n");

  // 배포된 컨트랙트 사용
  const [deployer] = await ethers.getSigners();
  console.log(`📦 Deployer: ${await deployer.getAddress()}`);

  const poolDeployment = await typedDeployments.get("PoolERC20");
  const pool = PoolERC20__factory.connect(poolDeployment.address, deployer);
  console.log(`   PoolERC20: ${poolDeployment.address}`);

  const usdcDeployment = await typedDeployments.get("MockUSDC");
  const usdc = MockERC20__factory.connect(usdcDeployment.address, deployer);
  console.log(`   MockUSDC: ${usdcDeployment.address}\n`);

  // USDC 설정
  const balance = await usdc.balanceOf(deployer);
  console.log(`   Deployer USDC balance: ${balance.toString()}`);
  if (balance < 10000n) {
    console.log("   Minting USDC...");
    await usdc.mintForTests(deployer, await parseUnits(usdc, "1000000"));
  }
  await usdc.connect(deployer).approve(pool, ethers.MaxUint256);
  console.log("✅ 컨트랙트 연결 완료\n");

  const coreSdk = sdk.createCoreSdk(pool);
  // Mantle Sepolia eth_getLogs는 10,000 블록 제한
  // 배포 블록을 자동으로 가져오거나, 최근 10,000 블록 내에서 시작
  let DEPLOYMENT_BLOCK: number | undefined;
  try {
    const poolDeploymentInfo = await typedDeployments.get("PoolERC20");
    if (poolDeploymentInfo.receipt?.blockNumber) {
      DEPLOYMENT_BLOCK = poolDeploymentInfo.receipt.blockNumber;
      console.log(`   📍 배포 블록: ${DEPLOYMENT_BLOCK}`);
    }
  } catch {
    // 배포 정보를 가져올 수 없으면 현재 블록에서 10,000 블록 전부터 시작
    const currentBlock = await ethers.provider.getBlockNumber();
    DEPLOYMENT_BLOCK = Math.max(0, currentBlock - 10000);
    console.log(`   ⚠️ 배포 블록을 찾을 수 없어 현재 블록 - 10,000 (${DEPLOYMENT_BLOCK})부터 시작`);
  }
  const trees = new sdk.TreesService(pool, { fromBlock: DEPLOYMENT_BLOCK });
  const interfaceSdk = sdk.createInterfaceSdk(coreSdk, trees, {
    shield: noir.getCircuitJson("erc20_shield"),
    unshield: noir.getCircuitJson("erc20_unshield"),
    join: noir.getCircuitJson("erc20_join"),
    transfer: noir.getCircuitJson("erc20_transfer"),
    swap: noir.getCircuitJson("lob_router_swap"),
  });
  const backendSdk = createBackendSdk(coreSdk, trees, {
    rollup: noir.getCircuitJson("rollup"),
  });

  // Secret keys
  const bobSecretKey = "0x2120f33c0d324bfe571a18c1d5a1c9cdc6db60621e35bc78be1ced339f936a71";
  const aliceSecretKey = "0x118f09bc73ec486db2030077142f2bceba2a4d4c9e0f6147d776f8ca8ec02ff1";
  const charlieSecretKey = "0x038c0439a42280637b202fd2f0d25d6e8e3c11908eab966a6d85bd6797eed5d5";
  const davidSecretKey = "0x048c0439a42280637b202fd2f0d25d6e8e3c11908eab966a6d85bd6797eed5d5";

  const payrollAmount = 1000n;
  const aliceSalary = 300n;
  const charlieSalary = 400n;
  const davidSalary = 300n;

  // Step 1: Shield
  console.log("💰 Step 1: BOB이 토큰을 shielded pool에 shield");
  console.log(`   - Shield 금액: ${payrollAmount} USDC`);
  await interfaceSdk.poolErc20.shield({
    account: deployer,
    token: usdc,
    amount: payrollAmount,
    secretKey: bobSecretKey,
  });
  console.log("   ✅ Shield 완료\n");

  // Step 2: Shield rollup
  console.log("🔄 Step 2: Shield rollup 처리");
  const shieldRollupTx = await backendSdk.rollup.rollup();
  const shieldRollupReceipt = await shieldRollupTx.wait();
  console.log(`   ✅ Rollup 완료 - 트랜잭션 해시: ${shieldRollupTx.hash}`);
  console.log(`   ✅ Gas 사용량: ${shieldRollupReceipt?.gasUsed?.toString()}\n`);

  const bobBalanceAfterShield = await interfaceSdk.poolErc20.balanceOf(usdc, bobSecretKey);
  console.log(`   ✅ BOB의 shielded balance: ${bobBalanceAfterShield} USDC\n`);

  // Step 3: Transfers
  console.log("💸 Step 3: BOB이 3명에게 Transfer");
  const bobNotes = await interfaceSdk.poolErc20.getBalanceNotesOf(usdc, bobSecretKey);

  // ALICE
  console.log(`   - ALICE에게 ${aliceSalary} USDC transfer`);
  const aliceWaAddress = await sdk.CompleteWaAddress.fromSecretKey(aliceSecretKey);
  await interfaceSdk.poolErc20.transfer({
    secretKey: bobSecretKey,
    fromNote: bobNotes[0],
    to: aliceWaAddress,
    amount: await sdk.TokenAmount.from({ token: await usdc.getAddress(), amount: aliceSalary }),
  });
  console.log("   ✅ ALICE transfer 완료");
  await backendSdk.rollup.rollup();
  console.log("   ✅ 첫 번째 transfer rollup 완료");

  // CHARLIE
  console.log(`   - CHARLIE에게 ${charlieSalary} USDC transfer`);
  const charlieWaAddress = await sdk.CompleteWaAddress.fromSecretKey(charlieSecretKey);
  const bobNotesAfterAlice = await interfaceSdk.poolErc20.getBalanceNotesOf(usdc, bobSecretKey);
  await interfaceSdk.poolErc20.transfer({
    secretKey: bobSecretKey,
    fromNote: bobNotesAfterAlice[0],
    to: charlieWaAddress,
    amount: await sdk.TokenAmount.from({ token: await usdc.getAddress(), amount: charlieSalary }),
  });
  console.log("   ✅ CHARLIE transfer 완료");
  await backendSdk.rollup.rollup();
  console.log("   ✅ 두 번째 transfer rollup 완료");

  // DAVID
  console.log(`   - DAVID에게 ${davidSalary} USDC transfer`);
  const davidWaAddress = await sdk.CompleteWaAddress.fromSecretKey(davidSecretKey);
  const bobNotesAfterCharlie = await interfaceSdk.poolErc20.getBalanceNotesOf(usdc, bobSecretKey);
  await interfaceSdk.poolErc20.transfer({
    secretKey: bobSecretKey,
    fromNote: bobNotesAfterCharlie[0],
    to: davidWaAddress,
    amount: await sdk.TokenAmount.from({ token: await usdc.getAddress(), amount: davidSalary }),
  });
  console.log("   ✅ DAVID transfer 완료");
  const transferRollupTx = await backendSdk.rollup.rollup();
  console.log(`   ✅ Rollup 완료 - 트랜잭션 해시: ${transferRollupTx.hash}\n`);

  // Verify balances
  const aliceBalance = await interfaceSdk.poolErc20.balanceOf(usdc, aliceSecretKey);
  const charlieBalance = await interfaceSdk.poolErc20.balanceOf(usdc, charlieSecretKey);
  const davidBalance = await interfaceSdk.poolErc20.balanceOf(usdc, davidSecretKey);
  console.log(`   ✅ ALICE의 shielded balance: ${aliceBalance} USDC`);
  console.log(`   ✅ CHARLIE의 shielded balance: ${charlieBalance} USDC`);
  console.log(`   ✅ DAVID의 shielded balance: ${davidBalance} USDC\n`);

  // Step 4: Unshields
  console.log("💵 Step 4: 3명이 각각 unshield (현금화)");
  console.log(`   - ALICE 받을 주소: ${ALICE_ADDRESS}`);
  console.log(`   - CHARLIE 받을 주소: ${CHARLIE_ADDRESS}`);
  console.log(`   - DAVID 받을 주소: ${DAVID_ADDRESS}`);

  const aliceNotes = await interfaceSdk.poolErc20.getBalanceNotesOf(usdc, aliceSecretKey);
  await interfaceSdk.poolErc20.unshield({
    secretKey: aliceSecretKey,
    fromNote: aliceNotes[0],
    token: await usdc.getAddress(),
    to: ALICE_ADDRESS,
    amount: aliceSalary,
  });
  console.log("   ✅ ALICE unshield 완료");

  const charlieNotes = await interfaceSdk.poolErc20.getBalanceNotesOf(usdc, charlieSecretKey);
  await interfaceSdk.poolErc20.unshield({
    secretKey: charlieSecretKey,
    fromNote: charlieNotes[0],
    token: await usdc.getAddress(),
    to: CHARLIE_ADDRESS,
    amount: charlieSalary,
  });
  console.log("   ✅ CHARLIE unshield 완료");

  const davidNotes = await interfaceSdk.poolErc20.getBalanceNotesOf(usdc, davidSecretKey);
  await interfaceSdk.poolErc20.unshield({
    secretKey: davidSecretKey,
    fromNote: davidNotes[0],
    token: await usdc.getAddress(),
    to: DAVID_ADDRESS,
    amount: davidSalary,
  });
  console.log("   ✅ DAVID unshield 완료\n");

  // Step 5: Final rollup
  console.log("🎯 Step 5: 단일 rollup으로 3개의 unshield 처리 (핵심!)");
  const unshieldRollupStartTime = Date.now();
  const unshieldRollupTx = await backendSdk.rollup.rollup();
  const unshieldRollupReceipt = await unshieldRollupTx.wait();
  const unshieldRollupDuration = Date.now() - unshieldRollupStartTime;

  console.log(`   ✅ Rollup 완료 - 트랜잭션 해시: ${unshieldRollupTx.hash}`);
  console.log(`   ✅ Gas 사용량: ${unshieldRollupReceipt?.gasUsed?.toString()}`);
  console.log(`   ✅ Rollup 처리 시간: ${unshieldRollupDuration}ms\n`);

  // Step 6: Final verification
  console.log("✅ Step 6: 최종 검증");
  const aliceFinalBalance = await usdc.balanceOf(ALICE_ADDRESS);
  const charlieFinalBalance = await usdc.balanceOf(CHARLIE_ADDRESS);
  const davidFinalBalance = await usdc.balanceOf(DAVID_ADDRESS);

  console.log(`   ✅ ALICE의 최종 USDC balance: ${aliceFinalBalance.toString()}`);
  console.log(`   ✅ CHARLIE의 최종 USDC balance: ${charlieFinalBalance.toString()}`);
  console.log(`   ✅ DAVID의 최종 USDC balance: ${davidFinalBalance.toString()}\n`);

  console.log("\n🎉 BOB Payroll 시나리오 테스트 완료!");
  console.log("\n📊 요약:");
  console.log(`   - Shield rollup: ${shieldRollupTx.hash}`);
  console.log(`   - Transfer rollup: ${transferRollupTx.hash}`);
  console.log(`   - Unshield rollup: ${unshieldRollupTx.hash}`);
  console.log(`\n📬 토큰 수령 주소:`);
  console.log(`   - ALICE: ${ALICE_ADDRESS} -> ${aliceFinalBalance.toString()} USDC`);
  console.log(`   - CHARLIE: ${CHARLIE_ADDRESS} -> ${charlieFinalBalance.toString()} USDC`);
  console.log(`   - DAVID: ${DAVID_ADDRESS} -> ${davidFinalBalance.toString()} USDC`);
  console.log(`\n🔗 Mantle Sepolia Explorer:`);
  console.log(`   https://sepolia.mantlescan.xyz/tx/${unshieldRollupTx.hash}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
