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
      → (계층 1) 외부 공공 API — 유일한 런타임 실호출
```

## 2. 계층 1 — 외부 공공 API (서버 전용)

### 2.1 실호출 1건: 인천공항 여객편 운항 현황 (REQ-DATA-003, P1)

| 항목 | 값 |
|---|---|
| 엔드포인트 | `https://apis.data.go.kr/B551177/StatusOfPassengerFlightsDeOdp` — `getPassengerArrivalsDeOdp` / `getPassengerDeparturesDeOdp` (#46 확정: 주간 현황 DSOdp 대신 상세조회, 2026-08-08 실측) |
| 인증 | `AIRPORT_API_KEY` (.env.local, 커밋 금지) |
| 사용 필드 | 편명, 예정/변경 시각, 운항 상태, 터미널 |
| 타임아웃·폴백 | **5초 초과 또는 오류 시 `data/flights-snapshot.json`으로 자동 전환**, UI에 스냅샷 기준임을 표시 |
| 호출 특성 | `searchday`(조회일 기준 D-3~D+6)·`flight_id` 필터로 해당 편만 수신. 편명·날짜별 5분 캐시(일 500건 쿼터 보호). 단일 발급 키는 원형 우선·인증 오류 시 반대 인코딩형 1회 재시도. live 200+편명 없음은 오류 폴백과 구분해 미검색 처리 (#46, `lib/adapters/flights-live.ts`) |
| 호출 시점 | 데모 중 입국편 확인 1회. 오프라인 모드에서는 호출하지 않음(NFR-DEMO-001) |

### 2.2 런타임에 호출하지 않는 것 (명시)

- **KTX 시간표**: `data/train-snapshot.json` 스냅샷만 사용. 실시간 조회 없음
- **역 편의시설**: `data/station-facilities.json` 스냅샷만 사용
  (생성: `scripts/build_station_facilities.py`, 한국철도공사 편의시설정보 B551457). 실시간 조회 없음
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
}>;
// REQ-SRCH-003·004. 결과 0건이어도 예외가 아니라 빈 배열 (REQ-SRCH-008은 UI 처리)

// lib/actions/places.ts
getCandidatePlaces(selection: {
  selectedActorIds: string[];
  selectedWorkIds: string[];
}): Promise<PlaceCandidate[]>;
// PlaceCandidate = PlaceT + {
//   relation: "selected_work" | "actor_other_work",  // §2 파생(상호 배타)
//   relationDetails: RelationDetail[],               // #51 — 작품별 회차·장면·장면 배우(검증값 그대로)
//   badge?: "CONSERVATIVE_BUFFER_MISMATCH"           // 방문 가능성 직접 확인 필요
//         | "UNVERIFIED_HOURS"                       // 운영시간 확인 필요
// }  // ActivityWindowDetail과 동일 열거값 — 화면 배지 2종(WIREFRAMES S3)과 1:1
// RelationDetail = WorkPlaceRelation의 workId·episodeLabel?·sceneNote?·featuredActorIds?·actorPresenceReviewed?
//   — 선택 작품 ∪ 선택 배우 출연작 관계만 포함 (무관 작품 관계 미노출, PR #65 리뷰 1)
// REQ-SRCH-005·006·007. 정렬은 UI에서 (관련성 / officialSourceCount 토글).
// #51 배우 선택 필터는 표시 레벨(lib/candidates.ts splitByActorPresence) — 판정 순서
//   confirmed → unreviewed → absent. 배우 모드의 미등장·미확인 후보는 최초 로드에서
//   초기 미선택(initialSelectedIds, PR #65 리뷰 2)이며 재열람 복원은 excluded 목록 기준(#35)

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
//   { status: "planned", days, rejectedPlaces, warnings, comparisonKeys, metrics }
//   { status: "empty",   days: [], rejectedPlaces, warnings }
// empty는 정상 응답이며 comparisonKeys·metrics를 포함하지 않는다(허위 값 금지)

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
