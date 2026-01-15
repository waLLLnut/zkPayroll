#!/usr/bin/env tsx
/**
 * Mantle 테스트넷에서 Rollup 테스트 스크립트
 * 
 * 실제 Mantle 네트워크에서 rollup proof 생성 및 검증
 */

import { ethers, noir, typedDeployments } from "hardhat";
import { sdk } from "../sdk";
import { createBackendSdk } from "../sdk/backendSdk";
import { parseUnits } from "../shared/utils";
import { MockERC20__factory, PoolERC20__factory } from "../typechain-types";

async function main() {
  console.log("🌐 Mantle 테스트넷 Rollup 테스트\n");

  // Mantle 테스트넷 설정 확인
  const network = await ethers.provider.getNetwork();
  console.log(`네트워크: ${network.name} (Chain ID: ${network.chainId})\n`);

  // 컨트랙트 연결 (이미 배포된 경우)
  const poolAddress = process.env.POOL_ADDRESS;
  if (!poolAddress) {
    console.error("❌ POOL_ADDRESS 환경변수가 설정되지 않았습니다.");
    console.log("배포를 먼저 실행하세요: pnpm deploy --network mantleTestnet");
    process.exit(1);
  }

  const pool = PoolERC20__factory.connect(
    poolAddress,
    (await ethers.getSigners())[0],
  );

  console.log(`Pool 컨트랙트: ${poolAddress}\n`);

  const coreSdk = sdk.createCoreSdk(pool);
  const trees = new sdk.TreesService(pool);
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

  // 현재 상태 확인
  const pendingTxs = await pool.getAllPendingTxs();
  const unrolledTxs = pendingTxs.filter((tx) => !tx.rolledUp);
  console.log(`대기 중인 트랜잭션: ${unrolledTxs.length}개\n`);

  if (unrolledTxs.length === 0) {
    console.log("⚠️ Rollup할 트랜잭션이 없습니다.");
    console.log("새로운 트랜잭션을 생성하거나 기다려주세요.\n");
    return;
  }

  // Rollup 실행
  console.log("🔄 Rollup 실행 중...");
  const startTime = Date.now();
  
  try {
    const tx = await backendSdk.rollup.rollup();
    const receipt = await tx.wait();
    const endTime = Date.now();

    console.log(`✅ Rollup 완료!`);
    console.log(`  트랜잭션 해시: ${receipt?.hash}`);
    console.log(`  Gas 사용량: ${receipt?.gasUsed?.toString()}`);
    console.log(`  소요 시간: ${endTime - startTime}ms\n`);

    // 상태 확인
    const newPendingTxs = await pool.getAllPendingTxs();
    const newUnrolledTxs = newPendingTxs.filter((tx) => !tx.rolledUp);
    console.log(`남은 대기 트랜잭션: ${newUnrolledTxs.length}개\n`);
  } catch (error: any) {
    console.error("❌ Rollup 실패:", error.message);
    if (error.reason) {
      console.error("  이유:", error.reason);
    }
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

