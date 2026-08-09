-- PR #36 리뷰 후속 조건: 트리거 함수의 search_path 고정.
-- search_path를 비우면 함수 내부 이름 해석이 스키마 주입에 흔들리지 않는다
-- (Supabase database linter 0011_function_search_path_mutable 대응).
alter function public.set_updated_at() set search_path = '';
