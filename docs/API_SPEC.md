# 씬나로 API 명세 v0.2

> 원칙: **앱이 실제로 호출하는 것만 수록한다.** (지난 프로젝트 요구사항·API v1.3에서 검증된 원칙)
> 상위 문서: PRD v0.2, 엔진 명세 v0.3, 요구사항 정의서 v0.5.

## 1. 계층 구조

```
브라우저 UI
  → (계층 2) 앱 내부 계약: Server Actions
    → lib/engine  (순수 함수, ENGINE_SPEC)
    → lib/repositories (JSON 시드, 기동 시 Zod 검증)
    → lib/adapters
      → (계층 1) 외부 API — 런타임 실호출
```

## 2. 계층 1 — 외부 API (서버 전용)

### 2.1 실호출 1건: 인천공항 여객편 운항 현황 (REQ-DATA-003, P1)

| 항목 | 값 |
|---|---|
| 엔드포인트 | `https://apis.data.go.kr/B551177/StatusOfPassengerFlightsDeOdp` — `getPassengerArrivalsDeOdp` / `getPassengerDeparturesDeOdp` (#46 확정: 주간 현황 DSOdp 대신 상세조회, 2026-08-08 실측) |
| 인증 | `AIRPORT_API_KEY` (.env.local, 커밋 금지) |
| 사용 필드 | 편명, 예정/변경 시각, 운항 상태, 터미널 |
| 타임아웃·폴백 | **5초 초과 또는 오류 시 `data/flights-snapshot.json`으로 자동 전환**, UI에 스냅샷 기준임을 표시 |
| 호출 특성 | `searchday`(조회일 기준 D-3~D+6)·`flight_id` 필터로 해당 편만 수신. 편명·날짜별 5분 캐시(일 500건 쿼터 보호). 단일 발급 키는 원형 우선·인증 오류 시 반대 인코딩형 1회 재시도. live 200+편명 없음은 오류 폴백과 구분해 미검색 처리 (#46, `lib/adapters/flights-live.ts`) |
| 호출 시점 | 데모 중 입국편 확인 1회. 오프라인 모드에서는 호출하지 않음(NFR-DEMO-001) |

### 2.2 실호출 2건: OpenAI 검색 입력 해석 (#78 P1)

| 항목 | 값 |
|---|---|
| 엔드포인트 | `POST https://api.openai.com/v1/responses` — strict JSON Schema 구조화 출력 |
| 인증 | `OPENAI_API_KEY` (`.env.local`/배포 서버 환경변수, 커밋·클라이언트 노출 금지) |
| 호출 조건 | 기존 배우·작품 ko/en 결정적 검색이 0건이고 정규화 질의가 3–80자일 때만 |
| 역할 | 외국어 표기·대표 별칭·명백한 오탈자를 서버가 제공한 배우·작품 ID allowlist로 해석 |
| 타임아웃·폴백 | 5초 초과·키 없음·HTTP/응답/스키마 오류·낮은 확신은 기존 빈 검색 결과 유지 |
| 안전 경계 | 장소·장면·인물 관계 추론 금지, allowlist 밖 ID 폐기, 원시 응답·키 클라이언트 미전달 |
| 비용 방어 | UI 300ms 디바운스, 결정적 검색 우선, 성공한 구조화 응답의 정규화 질의별 5분·최대 100개 서버 메모리 캐시, 최대 출력 120토큰, 응답 저장 비활성화 |

### 2.3 런타임에 호출하지 않는 것 (명시)

- **KTX 시간표**: `data/train-snapshot.json` 스냅샷만 사용. 실시간 조회 없음
- **역 편의시설**: `data/station-facilities.json` 스냅샷만 사용
  (생성: `scripts/build_station_facilities.py`, 한국철도공사 편의시설정보 B551457). 실시간 조회 없음
- **공항버스**: `data/gateway-legs.json`의 검증 왕복편만 사용. 인천공항공사 버스정보와
  TAGO 시외버스정보는 `scripts/verify_gateway_snapshot.py`의 오프라인 교차검증에만 사용하고,
  티머니 공식 운행정보의 데모 날짜 시각을 함께 고정한다. 런타임 시간표·좌석 조회 없음 (#58)
- **AI 촬영지 랭킹**: `data/place-rankings.json` 스냅샷만 사용
  (생성: `scripts/build_place_rankings.py` — OpenAI 호출은 이 오프라인 스크립트에서만).
  미탑재·미검토·하한 미달은 "점수 없음"으로 결정적 폴백 (#48, PLACE_RANKING.md)
- **TourAPI·레일포털 등**: 오프라인 데이터 파이프라인(Python, 시드 생성 단계)에서만 사용.
  앱 런타임 호출 없음
- 위 항목이 바뀌면(런타임 실호출 추가) 이 문서를 먼저 갱신한다 — "실호출만 수록" 원칙

## 3. 계층 2 — 앱 내부 계약

### 3.1 방식: Server Actions (확정)

UI의 서버 접점은 Route Handler 대신 **Server Actions**를 기본으로 한다.

- 근거: 엔진·스키마와 TS 타입을 그대로 공유(직렬화 계약 별도 관리 불필요), CORS·포트 개념
  없음, 폼·버튼 연동이 짧음. 2인 병렬 작업의 접점이 "함수 시그니처"로 줄어든다
- UI는 `lib/actions/`만 호출하고, `lib/repositories`·`lib/env`·`lib/adapters`는
  `server-only` 경계 안에서만 사용한다
- Route Handler가 필요해지는 경우: 외부에서 호출 가능한 데모 API를 심사에 보여주고 싶을 때.
  그 경우 같은 함수를 `app/api/*/route.ts`로 얇게 감싸 추가한다(계약 동일)

### 3.2 액션 목록 (UI가 호출하는 전부)

```ts
// lib/actions/search.ts
searchEntities(query: string): Promise<{
  actors: ActorSummary[];   // id, name(ko/en)
  works: WorkSummary[];
  interpretedByAi?: true;   // LLM 보조로 allowlist ID가 확정된 경우만. 원시 응답·확신도 미노출
}>;
// REQ-SRCH-003·004. ko/en 결정적 검색 우선. 0건일 때만 #78 LLM 보조를 시도하며,
// 키 없음·오류·낮은 확신은 빈 배열 (REQ-SRCH-008은 UI 처리)

// lib/actions/places.ts
getCandidatePlaces(selection: {
  selectedActorIds: string[];
  selectedWorkIds: string[];
}): Promise<{ candidates: PlaceCandidate[]; stations: StationSummary[]; works: WorkSummary[] }>;
// PlaceCandidate = PlaceT + {
//   relation: "selected_work" | "actor_other_work",  // 기존 표시·랭킹 호환 필드
//   selectionGroups: ("actor" | "work")[],           // #3·#51 실제 집합 소속(둘 다 가능)
//   relationDetails: RelationDetail[],               // #51 — 작품별 회차·장면·장면 배우(검증값 그대로)
//   aiRank?: number,                                 // #48 — 서버 파생 순위(선택 관련 작품 범위, 1=최고)
//   aiReason?: { ko, en },                           // #48 — 검토된 관련 이유. 원시 점수·검토 메타는 서버 전용
//   badge?: "CONSERVATIVE_BUFFER_MISMATCH"           // 방문 가능성 직접 확인 필요
//         | "UNVERIFIED_HOURS"                       // 운영시간 확인 필요
// }  // ActivityWindowDetail과 동일 열거값 — 화면 배지 2종(WIREFRAMES S3)과 1:1
// RelationDetail = WorkPlaceRelation의 workId·episodeLabel?·sceneNote?·featuredActorIds?·actorPresenceReviewed?
//   — 선택 작품 검토 관계 ∪ 선택 배우 장면 등장 확정 관계만 포함
// REQ-SRCH-005·006·007. 정렬은 UI에서 (관련성 / officialSourceCount 토글).
// #51 최종 계약: 배우 후보는 actorPresenceReviewed:true + featuredActorIds 포함 관계만,
// 작품 후보는 사람이 검토한 선택 작품 관계 전체, 복합 선택은 두 집합의 합집합이다.
// 미등장·미검토 관계는 배우 후보의 별도 선택 영역에도 노출하지 않는다.

// lib/actions/itinerary.ts
planItinerary(request: PlanRequest): Promise<PlanActionResult>;
// 생성과 편집 재계산 모두 이 액션 하나 (#2 단일 진입점).
// 편집 2동작(#14 ver.0.4 — 방문일 변경 제외) = 촬영지 선택 변경·항공 시각 변경 후 재호출.
// 별도 전후 diff를 만들지 않고 성공한 갱신 일정을 표시한다.
//
// PlanRequest — 필드 확정 (PR #42, #14 차단 2 절대 시각 전환):
type PlanRequest = {
  arrivalAt: string;              // ISO(오프셋 포함), 입국편 도착
  departureAt: string;            // ISO(오프셋 포함), 출국편 출발
  airportReadyAt: string;         // ISO — 공항 출발 가능 시각 (절대 시각, #14 차단 2)
  airportArrivalDeadline: string; // ISO — 공항 도착 마감 시각 (하드, #14 차단 2)
  selectedActorIds: string[];
  selectedWorkIds: string[];
  excludedPlaceIds: string[];
};
// 경계 순서 계약: arrivalAt <= airportReadyAt < airportArrivalDeadline <= departureAt
//   위반 시 INVALID_REQUEST + fieldErrors(필드 경로별 첫 오류 메시지)
// 사용자 설정 없는 내부 기본값은 Action이 채운다 — maxPlacesPerDay, dailySlackMinutes
// PlanActionResult (PR #30 리뷰 ③ — Action 계층의 입력 검증 래퍼):
//   { ok: true;  result: ItineraryResult }
//   { ok: false; code: "INVALID_REQUEST"; fieldErrors: Record<string, string> }
// Action의 ok는 "요청이 유효했는가"이며, 엔진 ItineraryResult에는 ok가 없다 —
// 계산 결과는 ENGINE_SPEC §7의 status 2분기(#14 ver.0.4 — 필수·고정일 제거로 실패 분기 소멸):
// #43: 운영시간 밖·미확인 배치는 자동 제외하지 않고 warnings에 담는다.
//   { status: "planned", days, rejectedPlaces, warnings, selectionGroups, comparisonKeys, metrics }
//   { status: "empty",   days: [], rejectedPlaces, warnings, selectionGroups }
// empty는 정상 응답이며 comparisonKeys·metrics를 포함하지 않는다(허위 값 금지)

// #58 공항버스 대안은 핵심 추천의 2초 응답을 막지 않는 후속 보강 Action이다.
// planItinerary(request)는 철도 추천을 먼저 반환하고, 성공한 planned 결과 뒤에 호출한다.
type GatewayPlanningBaseline = {
  visitedPlaceIds: string[]; // 핵심 추천 결과의 중복 없는 방문 장소 ID
  localUseMinutes: number;   // 핵심 추천 regionWindows.availableMinutes 합
};
planGatewayAlternatives(request, baseline: GatewayPlanningBaseline): Promise<
  | { ok: true; alternatives: GatewayAlternative[] }
  | { ok: false; code: "INVALID_REQUEST" | "INVALID_BASELINE"; fieldErrors: Record<string, string> }
>;
// baseline은 핵심 추천을 재계산하지 않고 effects 비교값만 만들기 위한 표시용 입력이다.
// 권한·저장 판단에는 사용하지 않으며, Action은 중복·미등록·제외 장소 ID, 음수·여행창 초과
// 시간을 거부한다. UI는 서버가 반환한 핵심 추천에서 gatewayPlanningBaselineOf()로 생성한다.
// UI는 이전 요청의 늦은 응답을 폐기한다. 보강 실패는 이미 표시한 추천을 실패로 되돌리지 않는다.
// GatewayAlternative.schedule은 observed_snapshot·verifiedAt·recheckRequired:true를 포함한다.

// lib/actions/account.ts — #25 lazy login (Supabase Auth, 서버 세션 재검증 #36)
getAccountStatus(): Promise<{ configured: boolean; authenticated: boolean }>;
signIn(email, password) / signUp(email, password): Promise<{ ok: true } | { ok: false; reason: "NOT_CONFIGURED" | "AUTH_FAILED" }>;
signOutAccount(): Promise<void>;
// env(NEXT_PUBLIC_SUPABASE_*) 미설정 = NOT_CONFIGURED — UI는 in-memory 스텁(#35)으로 폴백(스텁 배지)

// lib/actions/saved-itineraries.ts — #25 §6 저장·내 일정 (RLS 소유자 강제)
saveItinerary(entry): Promise<{ ok: true; record } | { ok: false; reason: "NOT_CONFIGURED" | "UNAUTHENTICATED" | "STORAGE_FAILED" }>;
listSavedItineraries(): Promise<{ ok: true; records; invalidCount } | { ok: false; reason }>;
// schema_version은 앱 SAVED_SCHEMA_VERSION 명시 기록(기본값 의존 금지), 깨진 행은 목록 제외

// lib/actions/flights.ts
type FlightInfo = {
  flightNo: string;
  direction: "arrival" | "departure";
  scheduledAt: string;           // 예정 시각
  estimatedAt?: string;          // 변경(예상) 시각 — live 조회 시
  status?: string;               // 운항 상태 문구 — live 조회 시
  terminal?: string;
};
getFlightInfo(flightNo: string, direction: "arrival" | "departure", date?: string): Promise<
  | { ok: true; flight: FlightInfo; source: "live" | "snapshot" }  // 폴백 여부 UI 표시
  | { ok: false; reason: "FLIGHT_NOT_FOUND" }                      // 미검색 편명 — 수동 시각 입력 유도
>;
// 시드 FlightT는 스냅샷 최소 필드이며, live 응답은 FlightInfo로 정규화한다
```

### 3.3 빈 결과·오류 계약

- 일정 계산에 실패 응답은 없다 — 후보가 전멸하면 `status: "empty"` 정상 응답이며
  최초 생성에서는 빈 상태를 표시하고 편집 재계산 중에는 기존 일정을 유지한다.
- 방문일 고정과 필수 방문 입력이 없으므로 `USER_CONSTRAINT_INFEASIBLE` 오류 계약은 사용하지 않는다.
- 입력 스키마 위반은 예외가 아니다 — Action이 safeParse 후 `INVALID_REQUEST`로 반환하고
  UI는 1단계 검증 화면으로 안내한다(1단계 검증을 우회한 요청에서만 발생해야 정상).
  입출국 순서·공항 경계 순서(3.2의 경계 순서 계약) 위반도 같은 경로로 필드별 오류를 담는다
- 시드 스키마 위반은 Repository 초기화 실패(`SeedValidationError`) — 기동 단계에서만
  발생해야 정상(REQ-DATA-004, PR #29)
- 외부 API 실패는 폴백으로 흡수하고 `source: "snapshot"`으로 알린다 — 사용자에게 오류를
  던지지 않는다 (PRD 9.2)

## 4. REQ 매핑

| 계약 | 정의서 |
|---|---|
| searchEntities | REQ-SRCH-003·004·008 |
| getCandidatePlaces | REQ-SRCH-005·006·007, REQ-DATA-002 |
| planItinerary | REQ-ITIN-001..008, REQ-EDIT-001..006 |
| getFlightInfo | REQ-SRCH-001, REQ-DATA-003, NFR-DEMO-001 |

참고: 요구사항 정의서의 구 표기 GET /flights는 v0.4에서 getFlightInfo(API_SPEC)로 동기화 완료.
