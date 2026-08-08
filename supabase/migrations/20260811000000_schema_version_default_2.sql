-- 직렬화 계약 v2 — 절대 시각 constraints 전환 (#14 차단 2, PR #42)
-- v1: airportExitOffsetMin·departureBufferMinutes (분 offset)
-- v2: airportReadyAt·airportArrivalDeadline (오프셋 포함 ISO 절대 시각)
--
-- 스텁 단계라 기존 행은 없다 — 기본값만 v2로 올린다. 저장 Action은 이 기본값에
-- 의존하지 않고 앱의 SAVED_SCHEMA_VERSION을 항상 명시적으로 기록한다(supabase/README.md).
alter table public.saved_itineraries alter column schema_version set default 2;

comment on column public.saved_itineraries.schema_version is
  'constraints 직렬화 계약 버전 — 앱 SAVED_SCHEMA_VERSION을 명시 기록(기본값 의존 금지). v2 = 절대 시각(#14 차단 2)';
