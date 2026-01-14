# Noir 버전 및 의존성 정리 보고서

## 📋 요약

이 프로젝트에서 사용된 Noir 관련 버전과 의존성을 정리하고 통일했습니다.

---

## 🔧 Noir 컴파일러 버전 (Nargo)

### 통일된 버전
- **모든 Noir 서킷**: `compiler_version = ">=0.39.0"`

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
- `test_lwe_standalone` - 독립 LWE 테스트

**이전 문제점**: RLWE 관련 서킷들이 `>=0.34.0`을 사용하고 있었으나, 모든 서킷을 `>=0.39.0`으로 통일했습니다.

---

## 📦 NPM 패키지 의존성

### 메인 패키지 (`packages/contracts/package.json`)

#### Noir 관련
- `@noir-lang/noir_js`: `1.0.0-beta.5` ✅

#### Aztec 관련 (Noir와 함께 사용)
- `@aztec/aztec.js`: `0.86.0`
- `@aztec/bb.js`: `0.86.0`
- `@aztec/foundation`: `0.86.0`
- `@aztec/kv-store`: `0.86.0`
- `@aztec/merkle-tree`: `0.86.0`
- `@aztec/stdlib`: `0.86.0`

#### Hardhat 플러그인
- `hardhat-noir`: `0.5.0` ⚠️ (현재 비활성화됨 - hardhat.config.ts에서 주석 처리)

### 데모 패키지 (`packages/contracts/demo/package.json`)

**수정 전**:
- `@noir-lang/noir_js`: `^0.36.0` ❌ (구버전)
- `@aztec/bb.js`: `^0.63.1` ❌ (구버전)

**수정 후**:
- `@noir-lang/noir_js`: `1.0.0-beta.5` ✅ (메인과 동일)
- `@aztec/bb.js`: `0.86.0` ✅ (메인과 동일)

---

## 🔗 Git 의존성 (Nargo.toml)

### Aztec Protocol Types

#### `common/Nargo.toml` & `rollup/Nargo.toml`
- **버전**: `v3.0.1` ✅ (통일됨)
- **저장소**: `https://github.com/AztecProtocol/aztec-packages/`
- **경로**: `noir-projects/noir-protocol-circuits/crates/types`

**이전 문제점**: `rollup/Nargo.toml`이 `v0.86.0`을 사용하고 있었으나, `common`과 동일하게 `v3.0.1`로 통일했습니다.

### Nodash 라이브러리

#### `common/Nargo.toml`
- **버전**: `v0.41.2`
- **저장소**: `https://github.com/olehmisar/nodash/`

---

## ⚠️ 특이점 및 주의사항

### 1. Hardhat-Noir 플러그인 비활성화
- **위치**: `packages/contracts/hardhat.config.ts`
- **상태**: 주석 처리됨 (`// import "hardhat-noir"`)
- **이유**: Noir 버전 호환성 문제로 인해 비활성화됨
- **영향**: Hardhat에서 직접 Noir 서킷을 컴파일할 수 없음
- **대안**: `nargo` CLI를 직접 사용하여 서킷 컴파일 필요

### 2. 버전 불일치 해결
- ✅ **해결됨**: `demo/package.json`의 `@noir-lang/noir_js` 버전을 `0.36.0` → `1.0.0-beta.5`로 업데이트
- ✅ **해결됨**: `rollup/Nargo.toml`의 `protocol_types` 버전을 `v0.86.0` → `v3.0.1`로 통일
- ✅ **해결됨**: RLWE 서킷들의 컴파일러 버전을 `>=0.34.0` → `>=0.39.0`으로 통일

### 3. 패키지 버전 명시 방식
- **변경 전**: `^` (caret) 사용으로 유연한 버전 범위 허용
- **변경 후**: 정확한 버전 명시 (예: `"1.0.0-beta.5"` → `"1.0.0-beta.5"`)
- **이유**: 재현 가능한 빌드를 위해 정확한 버전 고정

### 4. Aztec 패키지 버전
- 모든 `@aztec/*` 패키지가 `0.86.0`으로 통일되어 있음
- `protocol_types`는 `v3.0.1`을 사용 (Aztec 패키지 버전과 다름)
- 이는 정상적인 설정이며, `protocol_types`는 별도의 버전 관리 체계를 따름

### 5. 컴파일러 버전 요구사항
- 모든 서킷이 `>=0.39.0`을 요구하므로, **최소 Noir 0.39.0 이상**이 필요합니다
- 설치 방법:
  ```bash
  curl -L https://raw.githubusercontent.com/noir-lang/noirup/main/install | bash
  noirup
  nargo --version  # 0.39.0 이상 확인
  ```

---

## 📝 권장 사항

1. **Noir 버전 업데이트 시 주의**
   - 모든 서킷의 `compiler_version`을 동시에 업데이트해야 함
   - 업데이트 후 모든 서킷 테스트 필요: `nargo test`

2. **의존성 동기화**
   - `@aztec/*` 패키지와 `protocol_types` 버전을 함께 고려해야 함
   - 버전 불일치 시 컴파일 오류 발생 가능

3. **Hardhat-Noir 재활성화 검토**
   - 향후 Noir 버전 호환성 문제 해결 시 `hardhat-noir` 플러그인 재활성화 고려
   - 현재는 `nargo` CLI 사용이 더 안정적

4. **정기적인 버전 확인**
   - `package.json`과 `Nargo.toml`의 버전을 주기적으로 확인
   - 새로운 서킷 추가 시 기존 서킷과 버전 통일 유지

---

## 🔍 검증 방법

### Noir 컴파일러 버전 확인
```bash
nargo --version
```

### 서킷 컴파일 테스트
```bash
cd packages/contracts/noir/[circuit_name]
nargo check
nargo compile
nargo test
```

### NPM 패키지 버전 확인
```bash
cd packages/contracts
npm list @noir-lang/noir_js
npm list @aztec/bb.js
```

---

## 📅 최종 업데이트 날짜
2024년 (현재 날짜)

---

## 📚 참고 자료
- [Noir 공식 문서](https://noir-lang.org/docs/)
- [Aztec Protocol](https://aztec.network)
- [Noirup 설치 가이드](https://noir-lang.org/getting_started/nargo_installation)

