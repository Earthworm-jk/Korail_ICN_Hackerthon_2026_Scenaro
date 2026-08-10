# Korail_ICN_Hackerthon_2026_Scenaro

## 문서

- [씬나로 MVP PRD](docs/PRD.md)
- [일정 엔진 명세](docs/ENGINE_SPEC.md)
- [와이어프레임 가이드](docs/WIREFRAME_GUIDE.md)
- [팀 Git·GitHub 규칙](docs/TEAM_RULES.md)

## 개발

- Node 24 LTS / pnpm (`packageManager` 필드로 고정, `corepack enable` 권장)
- `pnpm install` → `pnpm dev` (http://localhost:3000)
- `pnpm test` — 엔진·스키마·번역 키 테스트 (Vitest)
- `pnpm typecheck` — tsc --noEmit
- API 키는 `.env.local` (`.env.example` 참조) — 커밋 금지 (docs/TEAM_RULES.md)
- 런타임 장소 승격: `python3 scripts/promote_runtime_catalog.py` — 데이터·관련성 랭킹 동시 갱신
- 오프라인 점검: `python3 scripts/promote_runtime_catalog.py --check` — API 키 없이 시드·랭킹 계약 확인

## 구조

- `app/` 서버 진입점과 상호작용 Client Component
- `lib/actions` UI가 호출하는 Server Actions — 엔진·Repository·어댑터의 단일 서버 접점
- `lib/engine` 코스 생성·재계산 순수 TS (docs/ENGINE_SPEC.md)
- `lib/types` Zod 시드 스키마(단일 진실 공급원) / `lib/repositories` 서버 전용 JSON 구현
- `lib/env` 서버 전용 환경변수 / `lib/i18n` ko/en 번역 객체
- `lib/adapters` 서버 전용 항공·열차 API(폴백 포함, 도입 시 `server-only` 적용)
- `data/` 시드 JSON (Python 파이프라인 산출물) / `data/raw/` 원천 스냅샷
- `scripts/` 수집·정제·집계 Python

Route Handler는 외부에서 호출할 공개 API가 실제로 필요할 때만 같은 내부 함수를 감싸는 얇은 래퍼로 추가한다.
