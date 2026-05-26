# genai-commit

Claude Code, Cursor CLI, Codex CLI를 활용한 AI 기반 커밋 메시지 생성 도구.

[![npm version](https://badge.fury.io/js/genai-commit.svg)](https://www.npmjs.com/package/genai-commit)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub](https://img.shields.io/github/stars/Seungwoo321/genai-commit?style=social)](https://github.com/Seungwoo321/genai-commit)

> 다른 언어로 보기: [English](./README.md)

## 주요 기능

- **AI 기반 커밋 메시지** - Claude Code, Cursor CLI, Codex CLI를 사용해 의미 있는 커밋 메시지 생성
- **Conventional Commits 준수** - Conventional Commits 명세를 자동으로 따름
- **다국어 지원** - 영어 또는 한국어로 제목과 본문 생성
- **Jira 연동** - 커밋에 Jira 티켓을 할당하고 동일 티켓의 변경사항을 자동 병합
- **인터랙티브 워크플로우** - 커밋 전에 검토, 피드백, 재생성 가능
- **스마트 파일 그룹화** - 변경사항을 논리적인 단위의 커밋으로 지능적으로 분리
- **클러스터 기반 청킹** - 대규모 변경에서는 import 그래프를 만들고 연관된 파일을 같은 청크로 묶어 각 AI 호출이 일관된 단위를 보도록 처리
- **청크 간 의미 병합** - 서로 다른 청크가 같은 논리적 변경을 표현한 경우, 검증 기반 롤백이 적용된 병합 패스가 이를 통합 (잘못된 병합보다 잘못된 분리를 우선)
- **재시작 가능한 배치 커밋** - 대규모 변경은 결정론적 플랜으로 동결되어 배치 단위로 커밋되며, 언제든 멈추고 `--resume`으로 이어서 진행 가능
- **자동 스테이징** - diff 분석 전에 추적되지 않은 파일, 이름 변경, 삭제된 파일을 포함한 모든 변경사항을 스테이징
- **빈 저장소 지원** - 커밋 이력이 없어도 커밋 생성 가능
- **원격 동기화 보호** - 브랜치가 원격보다 뒤처지거나 분기된 경우 조기 종료
- **Gitignore 인식** - `.gitignore`를 존중하며 하위 디렉토리에서도 정상 동작

## 지원하는 파일 변경 유형

| 변경 유형 | 지원 여부 |
|-----------|-----------|
| 추가된 파일 | 지원 |
| 수정된 파일 | 지원 |
| 삭제된 파일 | 지원 |
| 이름 변경된 파일 | 지원 |
| 추적되지 않은 파일 | 지원 (자동 스테이징) |
| 하위 디렉토리의 파일 | 지원 |
| 빈 저장소 (커밋 이력 없음) | 지원 |

## 동작 방식

```mermaid
flowchart TD
    A[시작: genai-commit] --> A1{원격 상태 확인}
    A1 -->|뒤처짐/분기됨| A2[종료: pull 필요]
    A1 -->|정상| A3[모든 변경사항 스테이징]
    A3 --> B[Git 변경사항 수집]
    B --> C{변경사항 존재?}
    C -->|없음| D[종료: 변경사항 없음]
    C -->|있음| E[Diff와 소스 로딩]
    E --> RP{저장된 플랜 유효?}
    RP -->|예| PL[동결된 플랜 재사용 / 재시작]
    RP -->|아니오| F[Import 그래프 빌드]
    F --> G{청킹 전략}
    G -->|엣지 존재| G1[클러스터: WCC + FFD bin pack]
    G -->|엣지 없음| G2[디렉토리 기반 청킹]
    G1 --> BS[배치 개수 선택]
    G2 --> BS
    BS --> FR[플랜을 .git/genai-commit/plan.json에 동결]
    FR --> PL
    PL --> BL[다음 대기 배치]
    BL --> H[청크별 AI 생성]
    H --> I{배치 청크 &gt; 1?}
    I -->|예| J[청크 간 의미 병합]
    I -->|아니오| K[병합 생략]
    J --> J1{검증: 커버리지 + 제목}
    J1 -->|성공| L[제안된 커밋 표시]
    J1 -->|실패| K
    K --> L
    L --> M{사용자 액션}
    M -->|y| N[배치 커밋 + 청크 완료 표시]
    M -->|n| O[취소: --resume으로 이어서]
    M -->|f| P[피드백 입력]
    M -->|t| Q[Jira 티켓 할당]
    P --> H
    Q --> R[동일 티켓 커밋 병합]
    R --> L
    N --> MB{남은 배치?}
    MB -->|예| BL
    MB -->|아니오| S[완료]
```

### 아키텍처 원칙

**결정적인 로직은 코드로, 진정으로 비결정적인 부분만 LLM에 맡긴다.**

- **결정적 (프로그램 기반)**
  - 언어별 정규식 기반 import 그래프 추출 (ts/js/py/go/rust/java)
  - 연관 파일에 대한 Weakly-Connected-Components 클러스터링
  - 청크 크기 예산에 맞춘 First-Fit Decreasing bin packing
  - 커버리지 검증, 제목 길이 검사, 파일 경로 verbatim 강제
- **비결정적 (LLM 기반)**
  - 그룹화된 파일 집합으로부터 자연어 제목/본문 작성
  - 서로 다른 청크의 파일들이 같은 논리적 변경인지 판단
  - 병합 결과가 거부되면 청크별 결과로 롤백 — AI 비용을 두 배로 늘리는 재시도는 없음

## 사전 요구사항

다음 AI CLI 도구 중 최소 하나가 설치되어 있어야 합니다:

- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) - Anthropic 공식 CLI (명령어: `claude`)
- [Cursor Agent CLI](https://www.cursor.com/) - Cursor 에이전트 CLI (명령어: `agent`)
- [OpenAI Codex CLI](https://github.com/openai/codex) - OpenAI Codex CLI (명령어: `codex`)

## 프로바이더

각 프로바이더는 정식 이름 또는 단축 별칭으로 사용할 수 있습니다:

| 정식 이름 | 단축 별칭 | 실제 CLI |
|-----------|-----------|----------|
| `claude-code` | `claude` | `claude` |
| `cursor-cli` | `cursor` | `agent` |
| `codex-cli` | `codex` | `codex` |

## 설치

```bash
# 전역 설치
npm install -g genai-commit

# 또는 npx로 즉시 실행 (설치 불필요)
npx genai-commit claude
```

## 사용법

### 커밋 메시지 생성

```bash
# 정식 이름 사용
genai-commit claude-code
genai-commit cursor-cli
genai-commit codex-cli

# 단축 별칭 사용 (동일하게 동작)
genai-commit claude
genai-commit cursor
genai-commit codex

# 특정 모델 지정
genai-commit cursor --model claude-4.5-sonnet
genai-commit claude --model sonnet
genai-commit codex --model gpt-5.4

# 제목과 본문 언어를 동일하게 설정
genai-commit claude --lang ko

# 제목과 본문 언어를 분리하여 설정
genai-commit claude --title-lang en --message-lang ko
```

### 인증

```bash
# 로그인
genai-commit login cursor
genai-commit login claude
genai-commit login codex

# 상태 확인
genai-commit status claude
genai-commit status cursor
genai-commit status codex
```

### 지원 모델 목록 확인

```bash
genai-commit models cursor
genai-commit models claude
genai-commit models codex
```

### 인터랙티브 옵션

커밋 메시지 생성 후 다음과 같은 인터랙티브 메뉴가 표시됩니다:

| 옵션 | 설명 |
|------|------|
| `[y]` | 제안된 커밋 실행 (배치 모드에서는 현재 배치) |
| `[n]` | 취소 (부분 커밋된 플랜은 `--resume`으로 이어서 진행) |
| `[f]` | 피드백을 입력해 재생성 (단일 청크 배치에서만) |
| `[t]` | Jira 티켓을 할당하고 커밋 재구성 |

## 옵션

| 옵션 | 설명 | 기본값 |
|------|------|--------|
| `--lang <lang>` | 제목과 본문 언어를 함께 설정 (en\|ko) | - |
| `--title-lang <lang>` | 커밋 제목 언어 | `en` |
| `--message-lang <lang>` | 커밋 본문 언어 | `ko` |
| `--model <model>` | 사용할 모델 | `haiku` (Claude) / `claude-4.5-sonnet` (Cursor) / `gpt-5.4` (Codex) |
| `--timeout <seconds>` | AI 프로바이더 타임아웃 (초) | `120` |
| `--batches <n>` | 다중 청크 실행을 n개 배치로 분할 | 프롬프트(인터랙티브) / 한 번에 전체(비인터랙티브) |
| `--resume` | 저장된 플랜의 다음 대기 배치부터 이어서 진행 | - |
| `--fresh` | 저장된 플랜을 폐기하고 현재 변경사항으로 재계획 | - |

## 사용 예시

### 기본 사용

```bash
# git 저장소로 이동
cd my-project

# 변경사항 작성
echo "console.log('hello');" >> src/index.js

# 커밋 생성
genai-commit claude
```

### Jira 연동 사용

1. `genai-commit claude` 실행
2. 제안된 커밋 검토
3. `t`를 눌러 Jira 티켓 할당
4. 각 커밋에 대한 Jira URL 입력
5. 동일한 Jira 티켓을 가진 커밋은 자동으로 병합됨
6. `y`를 눌러 커밋 실행

### 피드백 제공

1. `genai-commit cursor` 실행
2. 제안된 커밋 검토
3. `f`를 눌러 피드백 입력
4. 피드백 작성 (예: "인증 관련 변경사항을 별도 커밋으로 분리해줘")
5. AI가 피드백을 반영해 재생성
6. `y`를 눌러 커밋 실행

## 배치 & 재시작 가능한 커밋

대규모 변경은 결정론적 청크로 분할됩니다. 실행 간에 분할이 흔들리지 않도록, 전체 청크 분할을 한 번만 계산하여 `.git/genai-commit/plan.json`에 플랜으로 동결합니다 (`.git` 내부에 있어 스테이징되지 않습니다). 동일한 변경사항은 항상 동일한 청크를 만듭니다.

이후 플랜을 배치 단위로 하나씩 커밋합니다. 한 배치의 커밋이 성공하면 해당 청크들이 플랜에서 완료로 표시됩니다. 도중에 멈추거나 배치를 취소한 경우, `--resume`으로 다시 실행하면 다음 대기 배치부터 이어서 진행합니다.

```bash
# 대규모 실행을 5개 배치로 분할 (한 배치 커밋 후 다음 배치)
genai-commit claude --batches 5

# 중단했던 지점부터 저장된 플랜 이어서 진행
genai-commit claude --resume

# 저장된 플랜을 폐기하고 현재 변경사항으로 재계획
genai-commit claude --fresh
```

- `--batches` 없이 인터랙티브로 실행하면 배치 개수를 선택하는 프롬프트가 표시됩니다.
- TTY가 없는 비인터랙티브 환경에서는 변경사항을 한 번에 모두 커밋합니다.
- 저장된 플랜은 작업 트리와 일치하는 동안 자동으로 재사용됩니다. 변경사항이 달라져 플랜이 더 이상 일치하지 않으면 재계획되며, `--resume` 사용 시에는 불일치를 보고하고 `--fresh`를 요청합니다.
- 피드백(`[f]`)은 단일 청크 배치에서만 사용할 수 있습니다. 다중 청크 배치는 커밋의 일부만 재생성하게 되기 때문입니다.

## 지원하는 커밋 타입

Conventional Commits 명세를 따릅니다:

| 타입 | 설명 |
|------|------|
| `feat` | 새 기능 |
| `fix` | 버그 수정 |
| `docs` | 문서 변경 |
| `style` | 포매팅 (코드 변경 없음) |
| `refactor` | 코드 리팩토링 |
| `test` | 테스트 추가 |
| `chore` | 유지보수 작업 |
| `perf` | 성능 개선 |
| `ci` | CI/CD 변경 |
| `build` | 빌드 시스템 변경 |

## 설정

기본값으로도 잘 동작하지만 다음 항목을 설정할 수 있습니다:

| 설정 | 기본값 | 설명 |
|------|--------|------|
| `maxInputSize` | 30000 | 청크 단위 입력 예산 (문자); 클러스터링과 bin-packing의 기준 |
| `maxDiffSize` | 15000 | 파일별 diff 최대 크기 (바이트, 초과분은 요약 처리) |
| `timeout` | 120000 | AI 요청 타임아웃 (ms) |
| `maxRetries` | 2 | 청크 단위 AI 재시도 횟수 |

## 요구사항

- Node.js >= 18.0.0
- Git 저장소
- Claude Code CLI, Cursor CLI, 또는 Codex CLI 설치 및 인증 완료

## 라이선스

MIT
