# 씬나로 API 명세 v0.1

> 원칙: **앱이 실제로 호출하는 것만 수록한다.** (지난 프로젝트 요구사항·API v1.3에서 검증된 원칙)
> 상위 문서: PRD §7·§8, 엔진 명세 v0.2, 요구사항 정의서 v0.3.

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
| 엔드포인트 | `https://apis.data.go.kr/B551177/StatusOfPassengerFlightsDSOdp` (상세 오퍼레이션은 구현 시 확정) |
| 인증 | `AIRPORT_API_KEY` (.env.local, 커밋 금지) |
| 사용 필드 | 편명, 예정/변경 시각, 운항 상태, 터미널 |
| 타임아웃·폴백 | **5초 초과 또는 오류 시 `data/flights-snapshot.json`으로 자동 전환**, UI에 스냅샷 기준임을 표시 |
| 호출 시점 | 데모 중 입국편 확인 1회. 오프라인 모드에서는 호출하지 않음(NFR-DEMO-001) |

### 2.2 런타임에 호출하지 않는 것 (명시)

- **KTX 시간표**: `data/train-snapshot.json` 스냅샷만 사용. 실시간 조회 없음
- **TourAPI·레일포털 등**: 오프라인 데이터 파이프라인(Python, 시드 생성 단계)에서만 사용.
  앱 런타임 호출 없음
- 위 항목이 바뀌면(런타임 실호출 추가) 이 문서를 먼저 갱신한다 — "실호출만 수록" 원칙

## 3. 계층 2 — 앱 내부 계약

### 3.1 방식: Server Actions (제안 — 리뷰에서 확정 요청)

Route Handler 대신 **Server Actions**를 기본으로 제안한다.

- 근거: 엔진·스키마와 TS 타입을 그대로 공유(직렬화 계약 별도 관리 불필요), CORS·포트 개념
  없음, 폼·버튼 연동이 짧음. 2인 병렬 작업의 접점이 "함수 시그니처"로 줄어든다
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
  selectedActorId?: string;
  selectedWorkIds: string[];
}): Promise<PlaceCandidate[]>;
// PlaceCandidate = PlaceT + {
//   relation: "selected_work" | "actor_other_work",  // §2 파생(상호 배타)
//   badge?: "CONSERVATIVE_BUFFER_MISMATCH"           // 방문 가능성 직접 확인 필요
//         | "UNVERIFIED_HOURS"                       // 운영시간 확인 필요
// }  // ActivityWindowDetail과 동일 열거값 — 화면 배지 2종(WIREFRAMES S3)과 1:1
// REQ-SRCH-005·006·007. 정렬은 UI에서 (관련성 / officialSourceCount 토글)

// lib/actions/itinerary.ts
planItinerary(constraints: TripConstraints): Promise<ItineraryResult>;
// 생성과 편집 재계산 모두 이 액션 하나 (#2 단일 진입점).
// 편집 3동작 = constraints 필드 변경 후 재호출. diff는 UI가 이전 metrics와 비교(REQ-EDIT-004)

// lib/actions/flights.ts
type FlightInfo = {
  flightNo: string;
  direction: "arrival" | "departure";
  scheduledAt: string;           // 예정 시각
  estimatedAt?: string;          // 변경(예상) 시각 — live 조회 시
  status?: string;               // 운항 상태 문구 — live 조회 시
  terminal?: string;
};
getFlightInfo(flightNo: string, direction: "arrival" | "departure"): Promise<
  | { ok: true; flight: FlightInfo; source: "live" | "snapshot" }  // 폴백 여부 UI 표시
  | { ok: false; reason: "FLIGHT_NOT_FOUND" }                      // 미검색 편명 — 수동 시각 입력 유도
>;
// 시드 FlightT는 스냅샷 최소 필드이며, live 응답은 FlightInfo로 정규화한다
```

### 3.3 오류 계약

- 도메인 실패(일정 불가)는 예외가 아니라 `ItineraryResult { ok: false, reason }` 값으로 반환
- 시드·입력 스키마 위반은 Zod 예외 → 개발 중에만 발생해야 정상(기동 시 검증)
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
