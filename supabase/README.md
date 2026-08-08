# Supabase — saved_itineraries

저장 일정(`saved_itineraries`) 스키마와 RLS 정책. 근거: 이슈 #25 PRD §6 (최소 스키마·스냅샷 버전·중복 판별), #23 (저장·내 일정·다시 열기 MVP 포함).

## 적용 절차 (수동 — 콘솔 계정 필요)

1. [Supabase](https://supabase.com)에서 프로젝트 생성 (조직 계정 담당자)
2. 프로젝트 대시보드 → **SQL Editor** → `migrations/`의 SQL 파일을 파일명 순서대로 붙여넣고 실행
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
- **schema_version**: constraints 직렬화 계약 버전. 저장 액션은 DB 기본값에 의존하지 않고 앱의 `SAVED_SCHEMA_VERSION`(`lib/saved-itineraries-stub.ts`)을 **항상 명시적으로 기록**한다. v2 = 절대 시각 constraints(#14 차단 2, PR #42) — 기본값 변경은 후속 migration으로만.
- **연결 코드**: 앱 쪽 인증·저장 액션은 8/11 슬롯에서 `lib/actions/`에 추가 예정. 그 전까지 UI는 in-memory 스텁(PR #35)으로 동작한다.
