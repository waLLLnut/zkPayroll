#!/usr/bin/env tsx
/**
 * Rollup Proof 생성 테스트 스크립트
 * 
 * Mantle 배포 전 프루빙 인프라 검증용
 * 다양한 배치 크기와 시나리오로 rollup proof 생성 테스트
 */

import { ethers, noir, typedDeployments } from "hardhat";
import { sdk } from "../sdk";
import { createBackendSdk } from "../sdk/backendSdk";
import { parseUnits } from "../shared/utils";
import { MockERC20__factory, PoolERC20__factory } from "../typechain-types";

const { tsImport } = require("tsx/esm/api");

const MAX_NOTES_PER_ROLLUP = 64;
const MAX_NULLIFIERS_PER_ROLLUP = 64;

async function main() {
  console.log("🚀 Rollup Proof 생성 테스트 시작\n");

  // 1. 컨트랙트 배포 및 초기화
  console.log("📦 컨트랙트 배포 중...");
  await typedDeployments.fixture();
  const pool = PoolERC20__factory.connect(
    (await typedDeployments.get("PoolERC20")).address,
    (await ethers.getSigners())[0],
  );

  const usdc = await new MockERC20__factory((await ethers.getSigners())[0]).deploy(
    "USD Coin",
    "USDC",
  );

  const coreSdk = sdk.createCoreSdk(pool);
  const trees = new sdk.TreesService(pool);
  const { CompleteWaAddress, TokenAmount } = sdk;

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

  const [alice] = await ethers.getSigners();
  const aliceSecretKey =
    "0x118f09bc73ec486db2030077142f2bceba2a4d4c9e0f6147d776f8ca8ec02ff1";

  await usdc.mintForTests(alice, await parseUnits(usdc, "1000000"));
  await usdc.connect(alice).approve(pool, ethers.MaxUint256);

  // 2. 다양한 배치 크기 테스트
  console.log("\n📊 배치 크기별 테스트\n");

  // 작은 배치 (1-5 tx)
  console.log("테스트 1: 작은 배치 (5개 shield tx)");
  const startTime1 = Date.now();
  for (let i = 0; i < 5; i++) {
    await interfaceSdk.poolErc20.shield({
      account: alice,
      token: usdc,
      amount: 100n + BigInt(i * 10),
      secretKey: aliceSecretKey,
    });
  }
  const rollupStart1 = Date.now();
  await backendSdk.rollup.rollup();
  const rollupEnd1 = Date.now();
  console.log(`  ✅ 완료 - Rollup 시간: ${rollupEnd1 - rollupStart1}ms\n`);

  // 중간 배치 (10-20 tx)
  console.log("테스트 2: 중간 배치 (15개 shield tx)");
  const rollupStart2 = Date.now();
  for (let i = 0; i < 15; i++) {
    await interfaceSdk.poolErc20.shield({
      account: alice,
      token: usdc,
      amount: 100n + BigInt(i * 10),
      secretKey: aliceSecretKey,
    });
  }
  await backendSdk.rollup.rollup();
  const rollupEnd2 = Date.now();
  console.log(`  ✅ 완료 - Rollup 시간: ${rollupEnd2 - rollupStart2}ms\n`);

  // 큰 배치 (최대에 가까운 크기)
  console.log("테스트 3: 큰 배치 (최대 note 수에 가까운 배치)");
  const rollupStart3 = Date.now();
  // MAX_NOTES_PER_ROLLUP에 가까운 수의 tx 생성
  const largeBatchSize = Math.floor(MAX_NOTES_PER_ROLLUP / 2); // 각 shield가 1개 note 생성
  for (let i = 0; i < largeBatchSize; i++) {
    await interfaceSdk.poolErc20.shield({
      account: alice,
      token: usdc,
      amount: 100n + BigInt(i),
      secretKey: aliceSecretKey,
    });
  }
  await backendSdk.rollup.rollup();
  const rollupEnd3 = Date.now();
  console.log(`  ✅ 완료 - Rollup 시간: ${rollupEnd3 - rollupStart3}ms\n`);

  // 3. 복합 트랜잭션 테스트 (shield + transfer + join)
  console.log("테스트 4: 복합 트랜잭션 (shield + transfer + join)");
  const rollupStart4 = Date.now();
  
  // Shield
  await interfaceSdk.poolErc20.shield({
    account: alice,
    token: usdc,
    amount: 1000n,
    secretKey: aliceSecretKey,
  });
  
  // Transfer를 위해 먼저 rollup
  await backendSdk.rollup.rollup();
  
  const notes = await interfaceSdk.poolErc20.getBalanceNotesOf(usdc, aliceSecretKey);
  if (notes.length >= 2) {
    // Join
    await interfaceSdk.poolErc20.join({
      secretKey: aliceSecretKey,
      notes: notes.slice(0, 2),
    });
  }
  
  await backendSdk.rollup.rollup();
  const rollupEnd4 = Date.now();
  console.log(`  ✅ 완료 - Rollup 시간: ${rollupEnd4 - rollupStart4}ms\n`);
  
  // 4. Transfer 포함 배치 테스트
  console.log("테스트 5: Transfer 포함 배치");
  const rollupStart5 = Date.now();
  
  // Shield 후 rollup
  await interfaceSdk.poolErc20.shield({
    account: alice,
    token: usdc,
    amount: 500n,
    secretKey: aliceSecretKey,
  });
  await backendSdk.rollup.rollup();
  
  // Transfer 생성
  const transferNotes = await interfaceSdk.poolErc20.getBalanceNotesOf(usdc, aliceSecretKey);
  if (transferNotes.length > 0) {
    await interfaceSdk.poolErc20.transfer({
      secretKey: aliceSecretKey,
      fromNote: transferNotes[0],
      to: await CompleteWaAddress.fromSecretKey(aliceSecretKey),
      amount: await TokenAmount.from({
        token: await usdc.getAddress(),
        amount: 100n,
      }),
    });
  }
  
  await backendSdk.rollup.rollup();
  const rollupEnd5 = Date.now();
  console.log(`  ✅ 완료 - Rollup 시간: ${rollupEnd5 - rollupStart5}ms\n`);

  // 5. 성능 벤치마크
  console.log("📈 성능 벤치마크\n");
  const benchmarkSizes = [1, 5, 10, 20, 32];
  
  for (const size of benchmarkSizes) {
    console.log(`배치 크기: ${size}개 tx`);
    const start = Date.now();
    
    for (let i = 0; i < size; i++) {
      await interfaceSdk.poolErc20.shield({
        account: alice,
        token: usdc,
        amount: 100n + BigInt(i),
        secretKey: aliceSecretKey,
      });
    }
    
    const proofStart = Date.now();
    await backendSdk.rollup.rollup();
    const proofEnd = Date.now();
    
    const totalTime = proofEnd - start;
    const proofTime = proofEnd - proofStart;
    
    console.log(`  총 시간: ${totalTime}ms`);
    console.log(`  Proof 생성 시간: ${proofTime}ms`);
    console.log(`  tx당 평균: ${(proofTime / size).toFixed(2)}ms\n`);
  }

  // 6. 최종 상태 확인
  console.log("✅ 모든 테스트 완료!");
  const finalBalance = await interfaceSdk.poolErc20.balanceOf(usdc, aliceSecretKey);
  console.log(`최종 잔액: ${finalBalance.toString()}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

