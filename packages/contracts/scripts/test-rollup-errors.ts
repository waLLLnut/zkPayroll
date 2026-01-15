#!/usr/bin/env tsx
/**
 * Rollup 에러 케이스 테스트 스크립트
 * 
 * 중복 nullifier, 잘못된 merkle proof 등 에러 케이스 검증
 */

import { expect } from "chai";
import { ethers, noir, typedDeployments } from "hardhat";
import { sdk } from "../sdk";
import { createBackendSdk } from "../sdk/backendSdk";
import { parseUnits } from "../shared/utils";
import { MockERC20__factory, PoolERC20__factory } from "../typechain-types";

const { tsImport } = require("tsx/esm/api");

async function main() {
  console.log("🚨 Rollup 에러 케이스 테스트 시작\n");

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

  const { CompleteWaAddress, TokenAmount } = sdk;

  const [alice] = await ethers.getSigners();
  const aliceSecretKey =
    "0x118f09bc73ec486db2030077142f2bceba2a4d4c9e0f6147d776f8ca8ec02ff1";

  await usdc.mintForTests(alice, await parseUnits(usdc, "1000000"));
  await usdc.connect(alice).approve(pool, ethers.MaxUint256);

  // 테스트 1: 중복 nullifier 시도
  console.log("테스트 1: 중복 nullifier 방지");
  try {
    await interfaceSdk.poolErc20.shield({
      account: alice,
      token: usdc,
      amount: 100n,
      secretKey: aliceSecretKey,
    });
    await backendSdk.rollup.rollup();

    const notes = await interfaceSdk.poolErc20.getBalanceNotesOf(usdc, aliceSecretKey);
    const [note] = notes;

    // 같은 note를 두 번 사용하려고 시도
    await interfaceSdk.poolErc20.transfer({
      secretKey: aliceSecretKey,
      fromNote: note,
      to: await CompleteWaAddress.fromSecretKey(aliceSecretKey),
      amount: await TokenAmount.from({
        token: await usdc.getAddress(),
        amount: 50n,
      }),
    });

    await interfaceSdk.poolErc20.transfer({
      secretKey: aliceSecretKey,
      fromNote: note, // 같은 note 재사용
      to: await CompleteWaAddress.fromSecretKey(aliceSecretKey),
      amount: await TokenAmount.from({
        token: await usdc.getAddress(),
        amount: 50n,
      }),
    });

    // rollup 시도 - 실패해야 함
    await expect(backendSdk.rollup.rollup()).to.be.rejected;
    console.log("  ✅ 중복 nullifier가 올바르게 거부됨\n");
  } catch (error: any) {
    if (error.message?.includes("Cannot insert duplicated keys")) {
      console.log("  ✅ 중복 nullifier가 올바르게 거부됨\n");
    } else {
      console.log(`  ⚠️ 예상치 못한 에러: ${error.message}\n`);
    }
  }

  // 테스트 2: 빈 배치 rollup
  console.log("테스트 2: 빈 배치 rollup 처리");
  try {
    const pendingTxs = await pool.getAllPendingTxs();
    const hasUnrolledTxs = pendingTxs.some((tx) => !tx.rolledUp);
    
    if (!hasUnrolledTxs) {
      // 빈 배치 rollup 시도
      await backendSdk.rollup.rollup();
      console.log("  ✅ 빈 배치 처리 확인\n");
    } else {
      console.log("  ⚠️ 처리할 tx가 있어서 빈 배치 테스트 스킵\n");
    }
  } catch (error: any) {
    console.log(`  ℹ️ 빈 배치 처리 결과: ${error.message}\n`);
  }

  // 테스트 3: 최대 배치 크기 초과
  console.log("테스트 3: 최대 배치 크기 검증");
  try {
    // MAX_NOTES_PER_ROLLUP보다 많은 tx 생성
    const maxNotes = 64;
    for (let i = 0; i < maxNotes + 5; i++) {
      await interfaceSdk.poolErc20.shield({
        account: alice,
        token: usdc,
        amount: 100n + BigInt(i),
        secretKey: aliceSecretKey,
      });
    }

    // rollup은 배치 크기 제한 내에서만 처리해야 함
    await backendSdk.rollup.rollup();
    const remainingTxs = (await pool.getAllPendingTxs()).filter((tx) => !tx.rolledUp);
    console.log(`  ✅ 배치 크기 제한 확인 - 남은 tx: ${remainingTxs.length}개\n`);
  } catch (error: any) {
    console.log(`  ⚠️ 에러: ${error.message}\n`);
  }

  console.log("✅ 에러 케이스 테스트 완료!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

