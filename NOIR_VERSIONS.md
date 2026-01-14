# Noir 버전 및 의존성 정리 보고서

## 📋 요약

이 프로젝트에서 사용된 Noir 관련 버전과 의존성을 정리하고 통일했습니다.

---

## 🔧 Noir 컴파일러 버전 (Nargo)

### 통일된 버전
- **Noir 컴파일러**: `0.39.0`
- **모든 Noir 서킷**: `compiler_version = ">=0.39.0"`

### 설치 방법
```bash
curl -L https://raw.githubusercontent.com/noir-lang/noirup/main/install | bash
noirup -v 0.39.0
nargo --version  # 0.39.0 확인
```

### 적용된 서킷
- `common` - 공통 라이브러리
- `erc20` - ERC20 관련 서킷
- `erc20_shield` - ERC20 Shield 서킷
- `erc20_unshield` - ERC20 Unshield 서킷
- `erc20_join` - ERC20 Join 서킷
- `erc20_transfer` - ERC20 Transfer 서킷
- `lob_router` - LOB Router 라이브러리
- `lob_router_swap` - LOB Router Swap 서킷
- `rlwe` - RLWE 암호화 서킷
- `rlwe_bench` - RLWE 벤치마크 서킷
- `rollup` - Rollup 서킷

---

## 📦 NPM 패키지 의존성

### 메인 패키지 (`packages/contracts/package.json`)

#### Noir 관련
- `@noir-lang/noir_js`: `0.39.0` ✅

#### Aztec 관련 (Noir와 함께 사용)
- `@aztec/aztec.js`: `0.66.0`
- `@aztec/bb.js`: `0.66.0`
- `@aztec/foundation`: `0.66.0`
- `@aztec/kv-store`: `0.66.0`
- `@aztec/merkle-tree`: `0.66.0`
- `@aztec/stdlib`: `0.66.0`

#### Hardhat 플러그인
- `hardhat-noir`: `0.5.0` ⚠️ (현재 비활성화됨 - hardhat.config.ts에서 주석 처리)

---

## 🔗 Git 의존성 (Nargo.toml)

### Aztec Protocol Types

#### `common/Nargo.toml` & `rollup/Nargo.toml`
- **버전**: `aztec-packages-v0.66.0` ✅ (통일됨)
- **저장소**: `https://github.com/AztecProtocol/aztec-packages/`
- **경로**: `noir-projects/noir-protocol-circuits/crates/types`

### Nodash 라이브러리

#### `common/Nargo.toml`
- **버전**: `v0.39.4`
- **저장소**: `https://github.com/olehmisar/nodash/`

---

## ⚠️ 특이점 및 주의사항

### 1. 버전 호환성
- Noir `0.39.0`과 `aztec-packages-v0.66.0`이 호환됨
- Noir `1.0.0-beta.x`는 `protocol_types`의 `u64` generic 문제로 호환 안 됨

### 2. Hardhat-Noir 플러그인 비활성화
- **위치**: `packages/contracts/hardhat.config.ts`
- **상태**: 주석 처리됨 (`// import "hardhat-noir"`)
- **이유**: Noir 버전 호환성 문제로 인해 비활성화됨
- **대안**: `nargo` CLI를 직접 사용하여 서킷 컴파일 필요

### 3. RLWE 회로
- `rlwe` 및 `rlwe_bench` 회로는 `protocol_types` 의존성 없이 독립 동작
- 기존 dark pool 회로와 통합 시 동일한 버전 체계 사용

---

## 🔍 검증 방법

### 전체 컴파일 테스트
```bash
cd packages/contracts/noir
rm -rf */target
nargo compile --workspace
```

### 개별 서킷 테스트
```bash
cd packages/contracts/noir/rlwe
nargo test
```

### NPM 패키지 버전 확인
```bash
cd packages/contracts
pnpm list @noir-lang/noir_js
pnpm list @aztec/bb.js
```

---

## 📅 최종 업데이트 날짜
2026-01-14

---

## 📚 참고 자료
- [Noir 공식 문서](https://noir-lang.org/docs/)
- [Aztec Protocol](https://aztec.network)
- [Noirup 설치 가이드](https://noir-lang.org/getting_started/nargo_installation)
