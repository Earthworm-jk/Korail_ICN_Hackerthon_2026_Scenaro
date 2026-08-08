-- saved_itineraries — 저장 일정 최소 스키마 (#25 PRD §6 확정)
-- 적용 절차는 supabase/README.md 참조. Supabase 프로젝트 생성·적용은 수동(콘솔 계정 필요).
--
-- 설계 근거:
-- - 필드 구성은 #25 §6 표 그대로: 제목 자동 생성, constraints/itinerary JSON 직렬화,
--   schema_version(직렬화 계약 버전), snapshot_version(열차·항공 스냅샷 기준일)
-- - constraints_hash는 동일 일정 중복 "판별"용이다. #25 §6은 중복이어도 사용자가
--   "새로 저장"을 선택할 수 있게 확정했으므로 UNIQUE 제약이 아니라 조회용 인덱스만 둔다
--   (중복 안내·덮어쓰기 분기는 앱 계층 책임)
-- - 재열람 시 snapshot_version이 현재와 다르면 "이전 시간표 기준" 안내 후 재계산 유도

create table if not exists public.saved_itineraries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  constraints jsonb not null,
  constraints_hash text not null,
  itinerary jsonb not null,
  schema_version integer not null default 1,
  snapshot_version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.saved_itineraries is
  '저장 일정 (#25 §6). constraints로 전체 재계산 재현, itinerary는 저장 시점 표시용 스냅샷';
comment on column public.saved_itineraries.constraints_hash is
  '정규화 직렬화한 constraints의 해시 — 중복 판별용, UNIQUE 아님(새로 저장 허용)';
comment on column public.saved_itineraries.snapshot_version is
  '열차·항공 스냅샷 기준 — 재열람 시 불일치면 재계산 안내';

-- 내 일정 목록(최신순)과 중복 판별 조회 경로
create index if not exists saved_itineraries_user_updated_idx
  on public.saved_itineraries (user_id, updated_at desc);
create index if not exists saved_itineraries_user_hash_idx
  on public.saved_itineraries (user_id, constraints_hash);

-- updated_at 자동 갱신 (덮어쓰기 저장 시)
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists saved_itineraries_set_updated_at on public.saved_itineraries;
create trigger saved_itineraries_set_updated_at
  before update on public.saved_itineraries
  for each row execute function public.set_updated_at();

-- RLS — 소유자만 접근 (#25 확정: Supabase Auth + PostgreSQL + RLS)
alter table public.saved_itineraries enable row level security;

drop policy if exists "saved_itineraries_select_own" on public.saved_itineraries;
create policy "saved_itineraries_select_own"
  on public.saved_itineraries for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "saved_itineraries_insert_own" on public.saved_itineraries;
create policy "saved_itineraries_insert_own"
  on public.saved_itineraries for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "saved_itineraries_update_own" on public.saved_itineraries;
create policy "saved_itineraries_update_own"
  on public.saved_itineraries for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "saved_itineraries_delete_own" on public.saved_itineraries;
create policy "saved_itineraries_delete_own"
  on public.saved_itineraries for delete
  to authenticated
  using (auth.uid() = user_id);

-- anon에는 아무 권한도 주지 않는다 — 저장·조회 모두 인증 후에만 (lazy login과 정합)
grant select, insert, update, delete on public.saved_itineraries to authenticated;
