# Supabase — saved_itineraries

저장 일정(`saved_itineraries`) 스키마와 RLS 정책. 근거: 이슈 #25 PRD §6 (최소 스키마·스냅샷 버전·중복 판별), #23 (저장·내 일정·다시 열기 MVP 포함).

## 적용 절차 (수동 — 콘솔 계정 필요)

1. [Supabase](https://supabase.com)에서 프로젝트 생성 (조직 계정 담당자)
2. 프로젝트 대시보드 → **SQL Editor** → `migrations/20260810000000_saved_itineraries.sql` 내용 붙여넣고 실행
   - 또는 CLI: `supabase link --project-ref <ref>` 후 `supabase db push`
3. **Authentication → Providers**에서 Email 활성화 (#25 확정: 관리형 이메일+비밀번호, Google OAuth 후순위)
4. `.env.local`에 키 추가 (커밋 금지 — `.env.example`에 키 이름만 추가 예정):

   ```
   NEXT_PUBLIC_SUPABASE_URL=...
   NEXT_PUBLIC_SUPABASE_ANON_KEY=...
   ```

## 설계 메모

- **RLS**: 소유자(`auth.uid() = user_id`)만 select/insert/update/delete. `anon`에는 권한 없음 — 저장·조회는 인증 후에만(lazy login과 정합).
- **중복 판별**: `constraints_hash`는 조회용 인덱스만. #25 §6이 중복 시 "새로 저장 또는 덮어쓰기" 선택을 확정했으므로 UNIQUE로 막지 않고 앱이 안내 분기를 처리한다.
- **재열람**: `snapshot_version`이 현재 스냅샷 기준일과 다르면 "이전 시간표 기준입니다 — 다시 계산하기" 안내(#25 §6).
- **연결 코드**: 앱 쪽 인증·저장 액션은 8/11 슬롯에서 `lib/actions/`에 추가 예정. 그 전까지 UI는 in-memory 스텁(PR #35)으로 동작한다.
