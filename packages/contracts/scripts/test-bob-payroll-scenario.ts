#!/usr/bin/env tsx
/**
 * BOB Payroll 시나리오 테스트
 *
 * 시나리오:
 * 1. BOB이 토큰을 shielded pool에 shield (암호화)
 * 2. BOB이 3명(ALICE, CHARLIE, DAVID)에게 Transfer
 * 3. 3명 모두 각각 unshield로 현금화
 * 4. 이 3명의 unshield가 단일 rollup으로 한 블록에서 처리되도록
 */

import { expect } from "chai";
import { ethers, noir, typedDeployments } from "hardhat";
import { sdk } from "../sdk";
import { createBackendSdk } from "../sdk/backendSdk";
import { parseUnits } from "../shared/utils";
import { MockERC20__factory, PoolERC20__factory } from "../typechain-types";

async function main() {
  console.log("🚀 BOB Payroll 시나리오 테스트 시작\n");

  // 1. 컨트랙트 배포 및 초기화
  console.log("📦 컨트랙트 배포 중...");
  await typedDeployments.fixture();
  const [deployer, bob, alice, charlie, david] = await ethers.getSigners();
  const pool = PoolERC20__factory.connect(
    (await typedDeployments.get("PoolERC20")).address,
    deployer,
  );

  const usdc = await new MockERC20__factory(deployer).deploy("USD Coin", "USDC");
  await usdc.mintForTests(deployer, await parseUnits(usdc, "1000000"));
  await usdc.connect(deployer).approve(pool, ethers.MaxUint256);

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
  console.log("✅ 컨트랙트 배포 및 초기화 완료\n");

  // Secret keys 설정
  const bobSecretKey =
    "0x2120f33c0d324bfe571a18c1d5a1c9cdc6db60621e35bc78be1ced339f936a71";
  const aliceSecretKey =
    "0x118f09bc73ec486db2030077142f2bceba2a4d4c9e0f6147d776f8ca8ec02ff1";
  const charlieSecretKey =
    "0x038c0439a42280637b202fd2f0d25d6e8e3c11908eab966a6d85bd6797eed5d5";
  const davidSecretKey =
    "0x048c0439a42280637b202fd2f0d25d6e8e3c11908eab966a6d85bd6797eed5d5";

  const payrollAmount = 1000n; // BOB이 shield할 총 금액
  const aliceSalary = 300n; // ALICE에게 지급할 금액
  const charlieSalary = 400n; // CHARLIE에게 지급할 금액
  const davidSalary = 300n; // DAVID에게 지급할 금액

  // 2. BOB이 토큰을 shielded pool에 shield
  console.log("💰 Step 1: BOB이 토큰을 shielded pool에 shield");
  console.log(`   - Shield 금액: ${payrollAmount} USDC`);
  const { note: bobShieldNote } = await interfaceSdk.poolErc20.shield({
    account: deployer,
    token: usdc,
    amount: payrollAmount,
    secretKey: bobSecretKey,
  });
  console.log("   ✅ Shield 완료\n");

  // 3. Shield rollup (shield가 먼저 처리되어야 transfer 가능)
  console.log("🔄 Step 2: Shield rollup 처리");
  const shieldRollupTx = await backendSdk.rollup.rollup();
  const shieldRollupReceipt = await shieldRollupTx.wait();
  console.log(`   ✅ Rollup 완료 - 트랜잭션 해시: ${shieldRollupTx.hash}`);
  console.log(`   ✅ Gas 사용량: ${shieldRollupReceipt?.gasUsed?.toString()}\n`);

  // BOB의 잔액 확인
  const bobBalanceAfterShield = await interfaceSdk.poolErc20.balanceOf(
    usdc,
    bobSecretKey,
  );
  expect(bobBalanceAfterShield).to.equal(payrollAmount);
  console.log(`   ✅ BOB의 shielded balance: ${bobBalanceAfterShield} USDC\n`);

  // 4. BOB이 3명에게 Transfer (각 transfer 후 rollup 필요)
  console.log("💸 Step 3: BOB이 3명에게 Transfer");
  const bobNotes = await interfaceSdk.poolErc20.getBalanceNotesOf(
    usdc,
    bobSecretKey,
  );
  expect(bobNotes.length).to.be.greaterThan(0);

  // ALICE에게 transfer
  console.log(`   - ALICE에게 ${aliceSalary} USDC transfer`);
  const aliceWaAddress = await sdk.CompleteWaAddress.fromSecretKey(
    aliceSecretKey,
  );
  const aliceTransferAmount = await sdk.TokenAmount.from({
    token: await usdc.getAddress(),
    amount: aliceSalary,
  });
  const aliceTransferResult = await interfaceSdk.poolErc20.transfer({
    secretKey: bobSecretKey,
    fromNote: bobNotes[0],
    to: aliceWaAddress,
    amount: aliceTransferAmount,
  });
  console.log("   ✅ ALICE transfer 완료");

  // 첫 번째 transfer rollup (changeNote가 Merkle Tree에 포함되도록)
  console.log("   - 첫 번째 transfer rollup 처리 중...");
  await backendSdk.rollup.rollup();
  console.log("   ✅ 첫 번째 transfer rollup 완료");

  // CHARLIE에게 transfer (rollup 후 changeNote 사용 가능)
  console.log(`   - CHARLIE에게 ${charlieSalary} USDC transfer`);
  const charlieWaAddress = await sdk.CompleteWaAddress.fromSecretKey(
    charlieSecretKey,
  );
  const charlieTransferAmount = await sdk.TokenAmount.from({
    token: await usdc.getAddress(),
    amount: charlieSalary,
  });
  // rollup 후 changeNote를 가져옴
  const bobNotesAfterAlice = await interfaceSdk.poolErc20.getBalanceNotesOf(
    usdc,
    bobSecretKey,
  );
  expect(bobNotesAfterAlice.length).to.be.greaterThan(0);
  const charlieTransferResult = await interfaceSdk.poolErc20.transfer({
    secretKey: bobSecretKey,
    fromNote: bobNotesAfterAlice[0], // rollup 후 사용 가능한 note
    to: charlieWaAddress,
    amount: charlieTransferAmount,
  });
  console.log("   ✅ CHARLIE transfer 완료");

  // 두 번째 transfer rollup
  console.log("   - 두 번째 transfer rollup 처리 중...");
  await backendSdk.rollup.rollup();
  console.log("   ✅ 두 번째 transfer rollup 완료");

  // DAVID에게 transfer
  console.log(`   - DAVID에게 ${davidSalary} USDC transfer`);
  const davidWaAddress = await sdk.CompleteWaAddress.fromSecretKey(
    davidSecretKey,
  );
  const davidTransferAmount = await sdk.TokenAmount.from({
    token: await usdc.getAddress(),
    amount: davidSalary,
  });
  // rollup 후 changeNote를 가져옴
  const bobNotesAfterCharlie =
    await interfaceSdk.poolErc20.getBalanceNotesOf(usdc, bobSecretKey);
  expect(bobNotesAfterCharlie.length).to.be.greaterThan(0);
  const davidTransferResult = await interfaceSdk.poolErc20.transfer({
    secretKey: bobSecretKey,
    fromNote: bobNotesAfterCharlie[0], // rollup 후 사용 가능한 note
    to: davidWaAddress,
    amount: davidTransferAmount,
  });
  console.log("   ✅ DAVID transfer 완료");

  // 세 번째 transfer rollup
  console.log("   - 세 번째 transfer rollup 처리 중...");
  const transferRollupTx = await backendSdk.rollup.rollup();
  const transferRollupReceipt = await transferRollupTx.wait();
  console.log(`   ✅ Rollup 완료 - 트랜잭션 해시: ${transferRollupTx.hash}`);
  console.log(
    `   ✅ Gas 사용량: ${transferRollupReceipt?.gasUsed?.toString()}\n`,
  );

  // 각자의 잔액 확인
  const aliceBalance = await interfaceSdk.poolErc20.balanceOf(
    usdc,
    aliceSecretKey,
  );
  const charlieBalance = await interfaceSdk.poolErc20.balanceOf(
    usdc,
    charlieSecretKey,
  );
  const davidBalance = await interfaceSdk.poolErc20.balanceOf(
    usdc,
    davidSecretKey,
  );
  expect(aliceBalance).to.equal(aliceSalary);
  expect(charlieBalance).to.equal(charlieSalary);
  expect(davidBalance).to.equal(davidSalary);
  console.log(`   ✅ ALICE의 shielded balance: ${aliceBalance} USDC`);
  console.log(`   ✅ CHARLIE의 shielded balance: ${charlieBalance} USDC`);
  console.log(`   ✅ DAVID의 shielded balance: ${davidBalance} USDC\n`);

  // 6. 3명이 각각 unshield (현금화)
  console.log("💵 Step 5: 3명이 각각 unshield (현금화)");
  const aliceAddress = await alice.getAddress();
  const charlieAddress = await charlie.getAddress();
  const davidAddress = await david.getAddress();

  // ALICE unshield
  console.log(`   - ALICE unshield ${aliceSalary} USDC`);
  const aliceNotes = await interfaceSdk.poolErc20.getBalanceNotesOf(
    usdc,
    aliceSecretKey,
  );
  expect(aliceNotes.length).to.be.greaterThan(0);
  const aliceUnshieldTx = await interfaceSdk.poolErc20.unshield({
    secretKey: aliceSecretKey,
    fromNote: aliceNotes[0],
    token: await usdc.getAddress(),
    to: aliceAddress,
    amount: aliceSalary,
  });
  console.log("   ✅ ALICE unshield 완료");

  // CHARLIE unshield
  console.log(`   - CHARLIE unshield ${charlieSalary} USDC`);
  const charlieNotes = await interfaceSdk.poolErc20.getBalanceNotesOf(
    usdc,
    charlieSecretKey,
  );
  expect(charlieNotes.length).to.be.greaterThan(0);
  const charlieUnshieldTx = await interfaceSdk.poolErc20.unshield({
    secretKey: charlieSecretKey,
    fromNote: charlieNotes[0],
    token: await usdc.getAddress(),
    to: charlieAddress,
    amount: charlieSalary,
  });
  console.log("   ✅ CHARLIE unshield 완료");

  // DAVID unshield
  console.log(`   - DAVID unshield ${davidSalary} USDC`);
  const davidNotes = await interfaceSdk.poolErc20.getBalanceNotesOf(
    usdc,
    davidSecretKey,
  );
  expect(davidNotes.length).to.be.greaterThan(0);
  const davidUnshieldTx = await interfaceSdk.poolErc20.unshield({
    secretKey: davidSecretKey,
    fromNote: davidNotes[0],
    token: await usdc.getAddress(),
    to: davidAddress,
    amount: davidSalary,
  });
  console.log("   ✅ DAVID unshield 완료\n");

  // 7. 단일 rollup으로 3개의 unshield를 처리 (핵심!)
  console.log("🎯 Step 6: 단일 rollup으로 3개의 unshield 처리 (핵심!)");
  console.log("   - 3개의 unshield 트랜잭션이 하나의 rollup으로 묶여 처리됩니다");
  const unshieldRollupStartTime = Date.now();
  const unshieldRollupTx = await backendSdk.rollup.rollup();
  const unshieldRollupReceipt = await unshieldRollupTx.wait();
  const unshieldRollupEndTime = Date.now();
  const unshieldRollupDuration = unshieldRollupEndTime - unshieldRollupStartTime;

  console.log(`   ✅ Rollup 완료 - 트랜잭션 해시: ${unshieldRollupTx.hash}`);
  console.log(`   ✅ Gas 사용량: ${unshieldRollupReceipt?.gasUsed?.toString()}`);
  console.log(`   ✅ Rollup 처리 시간: ${unshieldRollupDuration}ms\n`);

  // 8. 최종 검증
  console.log("✅ Step 7: 최종 검증");
  const aliceFinalBalance = await usdc.balanceOf(aliceAddress);
  const charlieFinalBalance = await usdc.balanceOf(charlieAddress);
  const davidFinalBalance = await usdc.balanceOf(davidAddress);

  expect(aliceFinalBalance).to.equal(aliceSalary);
  expect(charlieFinalBalance).to.equal(charlieSalary);
  expect(davidFinalBalance).to.equal(davidSalary);

  console.log(`   ✅ ALICE의 최종 USDC balance: ${aliceFinalBalance.toString()}`);
  console.log(
    `   ✅ CHARLIE의 최종 USDC balance: ${charlieFinalBalance.toString()}`,
  );
  console.log(`   ✅ DAVID의 최종 USDC balance: ${davidFinalBalance.toString()}`);

  // Pending 트랜잭션 확인 (모두 처리되어야 함)
  const pendingTxs = await pool.getAllPendingTxs();
  const unrolledTxs = pendingTxs.filter((tx) => !tx.rolledUp);
  console.log(
    `   ✅ 처리되지 않은 pending 트랜잭션: ${unrolledTxs.length}개`,
  );
  expect(unrolledTxs.length).to.equal(0);

  // 각자의 shielded balance는 0이어야 함 (모두 unshield했으므로)
  const aliceShieldedBalance = await interfaceSdk.poolErc20.balanceOf(
    usdc,
    aliceSecretKey,
  );
  const charlieShieldedBalance = await interfaceSdk.poolErc20.balanceOf(
    usdc,
    charlieSecretKey,
  );
  const davidShieldedBalance = await interfaceSdk.poolErc20.balanceOf(
    usdc,
    davidSecretKey,
  );
  expect(aliceShieldedBalance).to.equal(0n);
  expect(charlieShieldedBalance).to.equal(0n);
  expect(davidShieldedBalance).to.equal(0n);
  console.log(`   ✅ ALICE의 shielded balance: ${aliceShieldedBalance}`);
  console.log(`   ✅ CHARLIE의 shielded balance: ${charlieShieldedBalance}`);
  console.log(`   ✅ DAVID의 shielded balance: ${davidShieldedBalance}\n`);

  console.log("\n🎉 BOB Payroll 시나리오 테스트 완료!");
  console.log("\n📊 요약:");
  console.log(`   - Shield rollup: ${shieldRollupTx.hash}`);
  console.log(`   - Transfer rollup: ${transferRollupTx.hash}`);
  console.log(
    `   - Unshield rollup (3개 unshield를 단일 rollup으로 처리): ${unshieldRollupTx.hash}`,
  );
  console.log(
    `   - Unshield rollup 처리 시간: ${unshieldRollupDuration}ms`,
  );
  console.log(
    `   - 총 3개의 unshield 트랜잭션이 하나의 블록에서 처리되었습니다!`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

