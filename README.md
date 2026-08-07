# Korail_ICN_Hackerthon_2026_Scenaro

## 개발

- Node 26 / pnpm (`packageManager` 필드로 고정, `corepack enable` 권장)
- `pnpm install` → `pnpm dev` (http://localhost:3000)
- `pnpm test` — 엔진·스키마·번역 키 테스트 (Vitest)
- `pnpm typecheck` — tsc --noEmit
- API 키는 `.env.local` (`.env.example` 참조) — 커밋 금지 (docs/TEAM_RULES.md)

## 구조

- `app/` 화면·Route Handler / `components/` UI
- `lib/engine` 코스 생성·재계산 순수 TS (docs/ENGINE_SPEC.md)
- `lib/types` Zod 시드 스키마(단일 진실 공급원) / `lib/repositories` JSON 구현
- `lib/i18n` ko/en 번역 객체 / `lib/adapters` 항공·열차 API(폴백 포함)
- `data/` 시드 JSON (Python 파이프라인 산출물) / `data/raw/` 원천 스냅샷
- `scripts/` 수집·정제·집계 Python
