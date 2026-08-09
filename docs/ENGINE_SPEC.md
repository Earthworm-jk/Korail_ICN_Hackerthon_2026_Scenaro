# 씬나로 일정 엔진 명세 v0.3

> 근거: 이슈 #2(편집·사유 코드), #3(점수·사전식 비교), #5·#43(운영시간), #84(과선택) 최종 결정 + PR #9 리뷰 반영.
> 상위 문서: PRD v0.2, 요구사항 정의서 v0.5.

## 1. 원칙

- **순수 TypeScript 모듈** (`lib/engine`) — UI·네트워크·전역 상태에 의존하지 않는다.
- **전체 재계산**: 편집은 제약 변경 후 처음부터 다시 계산한다. 부분 패치 없음. (REQ-EDIT)
- **결정성**: 동일 입력은 항상 동일 출력. `Date.now()`·난수 사용 금지, 타이브레이커로 보장.
- **하드 제약 → 사전식 비교**: 위반 후보를 먼저 제거하고, 남은 후보만 키 순서로 비교한다.
- LLM은 엔진에 관여하지 않는다. (NFR-ACCU-002)
- 데이터 접근은 Repository 인터페이스 뒤에 둔다. P0는 JSON 구현.

```
Planner
  ├─ PlaceRepository      // 촬영지·작품 연결·운영시간·접근 추정
  ├─ TimetableRepository  // 열차 시간표 스냅샷
  └─ FlightRepository     // 항공 스냅샷(+실호출 1건은 어댑터에서 폴백)
```

## 2. 입력 타입

```ts
type TripConstraints = {
  arrivalAt: string;            // ISO, 입국편 도착
  departureAt: string;          // ISO, 출국편 출발
  airportReadyAt: string;       // ISO, 공항 출발 가능 시각 — 절대 시각 입력 (#14 차단 2)
  airportStationId?: string;    // 공항철도 출발·도착역(생략 시 Station.isAirport)
  gatewayStationId?: string;    // 관문역(생략 시 Station.isGateway·gatewayPriority)
  selectedActorIds?: string[];  // 배우 중심 탐색(복수 가능)
  selectedActorId?: string;     // 기존 호출부 호환용 단수 입력
  selectedWorkIds: string[];    // 작품 중심(복수 가능)
  excludedPlaceIds: string[];   // 사용자 제외 — 하드 제약
  maxPlacesPerDay: number;      // 내부 기본값 3 — 사용자 설정 UI 없음 (#14 ver.0.4)
  dailySlackMinutes: number;    // 일반 여유(소프트), 기본 120
  airportArrivalDeadline: string; // ISO, 공항 도착 마감 시각(하드) — 절대 시각 입력 (#14 차단 2)
};

// 단일 진입점 (REQ-EDIT-001·002·006 공통, #2 결정)
function generateItinerary(c: TripConstraints, repos: Repos): ItineraryResult;
```

편집 2동작(촬영지 제외 / 항공편 시각 변경)은 모두 `TripConstraints`의
해당 필드만 바꿔 같은 함수를 다시 호출한다. UI는 **성공 응답일 때만** 일정을 교체한다. (REQ-EDIT-005)

방문일 변경·고정과 필수 방문 입력은 PRD v0.2에서 제거됐다. 엔진은 장소를 특정 날짜에
강제하거나 반드시 포함시키는 계약을 제공하지 않는다.

### 엄격한 후보 집합과 합집합 (#51 최종 계약)

후보 포함 여부는 넓은 `Place.workIds`·`Actor.workIds`가 아니라 근거 검증을 통과한
`WorkPlaceRelation`에서 파생한다.

```
배우 집합 = reviewed: true
          ∧ actorPresenceReviewed: true
          ∧ featuredActorIds ∩ selectedActorIds ≠ ∅

작품 집합 = reviewed: true ∧ workId ∈ selectedWorkIds

최종 후보 = 배우 집합 ∪ 작품 집합 (placeId 중복 제거)
```

미등장 확정·등장 미검토 관계는 배우 후보에 포함하지 않는다. 작품 후보는 선택 배우의
장면 등장 여부를 요구하지 않는다. 한 장소가 두 집합에 모두 속하면 후보는 한 번만 만들되
`actor`·`work` 두 그룹 소속을 모두 보존한다.

## 3. 시드 데이터 스키마 (Zod 요약)

Python 파이프라인이 생성하고, Repository 초기화 시(Planner 요청 처리 전에) Zod로 검증한다(REQ-DATA-004, 정의서 v0.5). 스키마가 곧 데이터 명세다.

```ts
const OpeningHours = z.discriminatedUnion("type", [
  z.object({ type: z.literal("always_open"), source: z.string(), verifiedAt: z.string() }),
  z.object({
    type: z.literal("hours"),
    open: z.string(), close: z.string(),          // HH:mm
    lastEntry: z.string().optional(),             // 마지막 입장
    closedDays: z.array(z.enum(["sun", "mon", "tue", "wed", "thu", "fri", "sat"])).optional(),
    source: z.string(), verifiedAt: z.string(),
  }),
  z.object({ type: z.literal("unverified") }),    // 자동 제외하지 않고 경고 대상 (#43)
]);

// PR #9 리뷰 1: 부분 누락을 Zod에서 원천 차단하기 위해 통합 객체로
const AccessEstimate = z.object({
  minutes: z.number(),
  source: z.string(),
  verifiedAt: z.string(),
});

const Place = z.object({
  id: z.string(),
  name: z.object({ ko: z.string(), en: z.string() }),   // #4: 데모 시드 en 필수
  workIds: z.array(z.string()),        // 관계 유형은 저장하지 않음 — §2 파생 규칙
  nearestStationId: z.string(),
  accessEstimate: AccessEstimate,      // 역→장소 추정 (#5)
  openingHours: OpeningHours,
  stayMinutes: z.number(),
  verificationLevel: z.enum(["원본확인", "교차확인", "TourAPI대조"]),
  officialSourceCount: z.number(),     // UI 정렬 전용 — 엔진 점수와 분리 (#3)
  reasonText: z.object({ ko: z.string(), en: z.string() }), // 사전 작성 추천 사유
});

const Station = z.object({
  id: z.string(),
  name: z.object({ ko: z.string(), en: z.string() }),
  lineType: z.enum(["KTX", "ITX", "AREX", "일반"]),
  regionId: RegionId,
  isGateway: z.boolean().optional(),
  gatewayPriority: z.number().int().nonnegative().optional(),
  isAirport: z.boolean().optional(),
});

// #58: 열차로 가장하지 않는 목적지 중립 공항 진입 구간
const GatewayLeg = z.object({
  id: z.string(),
  routeId: z.string(),
  direction: z.enum(["outbound", "inbound"]),
  mode: z.literal("airport_bus"),
  fromStationId: z.string(),       // 플래너 권역 앵커
  toStationId: z.string(),
  fromName: LocalizedText,         // 실제 승차 터미널 표시명
  toName: LocalizedText,
  departAt: IsoDateTime,
  arriveAt: IsoDateTime,
  serviceName: LocalizedText,
  operator: LocalizedText,
  sourceUrls: z.array(HttpUrl).min(1),
  verifiedAt: IsoDate,
  scheduleKind: z.literal("observed_snapshot"),
  recheckRequired: z.literal(true),
});
```

버퍼는 저장하지 않고 파생: `bufferMin = max(20, ceil(accessEstimate.minutes * 0.5))`. (#5)

## 4. 알고리즘 (전체 재계산, 7단계)

```
1. 입력 검증           — Zod. 실패는 예외(사유 코드 아님)
2. 후보 장소 수집       — §2 파생 규칙으로 selected_work / actor_other_work 후보만
3. 하드 필터           — 아래 5.의 제약 위반 장소·후보 제거, 사유 코드 기록
4. 일자 슬롯 구성       — airportReadyAt ... airportArrivalDeadline 사이,
                         maxPlacesPerDay·일자별 dailySlackMinutes 반영
5. 열차 선택           — 공항철도를 포함한 시간표 스냅샷에서 연결 가능한 편 탐색
6. 후보 일정 생성·비교   — 사전식 비교(아래 6.)로 최선 일정 선택
7. 결과 조립           — days, rejectedPlaces(사유 코드), comparisonKeys, metrics
```

철도 추천 일정과 별도로, 같은 `routeId`의 outbound/inbound `GatewayLeg` 쌍마다
공항 준비시각 이후 출발·공항 도착 마감 이전 귀환을 먼저 하드 필터한다. 통과한 쌍은
도착 권역 앵커에서 귀환 버스 출발 전까지 플래너를 실행하고, 버스 구간을 포함한
`regionWindows[]`와 **전체 `days[]` 대안**을 만든다. 단일 열차 구간만 바꾸지 않는다.
선택 촬영지와 같은 권역의 앵커만 후보가 되며 목적지 이름·강릉 ID를 알고리즘에 하드코딩하지 않는다.

핵심 철도 추천의 NFR-PERF-001(2초)을 공항버스 전체 재계산이 막지 않도록 실행 경로를
둘로 나눈다. `generateItinerary()`는 핵심 추천을 먼저 반환하고, UI는 별도
`planGatewayAlternatives(request, baseline)` Server Action으로 공항버스 전체 대안을 비차단 보강한다.
`baseline`은 핵심 추천에서 축약한 중복 없는 방문 장소 ID와 지역 사용 시간 합뿐이며,
대안의 `effects` 비교값에만 쓴다. Action은 이 입력을 검증한 뒤 핵심 철도 추천을 다시 계산하지
않고 공항버스 후보만 생성한다. baseline은 권한·저장 판단의 신뢰 입력이 아니다.
늦게 도착한 이전 요청의 대안은 요청 순번으로 폐기한다. 순수 엔진 회귀에서는
`generateItineraryWithGatewayAlternatives()`로 결합 결과를 검증한다.

현재 GatewayLeg는 미래 운행을 보장하는 예약 데이터가 아니라 공식 당일 API·예매처에서
특정 편을 확인한 `observed_snapshot`이다. 결과에는 가장 오래된 `verifiedAt`을 보수적으로
표시하고, `recheckRequired: true`에 따라 출발 전 운영사·예매처 재확인을 항상 안내한다.

### 지역 내 이동 모델 — 역 허브, 왕복 동일 추정 (PR #9 리뷰 A)

지역 내 직접 경로는 계산하지 않는다. **역을 허브로 보고, 모든 방문은 `역 → 장소 → 역`으로
모델링하며 복귀에도 동일한 `accessEstimate.minutes + buffer`를 보수적으로 적용한다.**
같은 역 권역에서 여러 장소를 방문해도 각 방문은 역 기준 왕복으로 시간을 소비한 것으로 계산한다
(보수적 — 실제보다 여유 있게 잡히며, 과장 금지 원칙과 일치).

공항↔관문역은 지역 내 이동 추정과 다르다. `airportStationId`에서 출발해 공항철도
스냅샷 leg를 실제 열차 구간처럼 탐색하고, 귀환도 공항역 도착 시각이
`airportArrivalDeadline` 이하여야 한다. 다른 열차번호로 갈아탈 때는 최소
15분의 환승 간격을 적용한다.

`dailySlackMinutes`는 출국 전 잔여시간의 대리값으로 쓰지 않는다. 각 방문일을 KST 0시 기준으로
나누고, 해당 일자의 여행 가능 구간에서 열차·역–장소 왕복·체류가 점유한 시간을 제외한 여유가
기본값 이상인지 날짜별로 판정한다.

## 5. 하드 제약과 운영시간 경고

| 제약 | 사유 코드 |
|---|---|
| 연결 가능한 열차 존재 | TRAIN_UNAVAILABLE |
| 하루별 장소 수 상한 안에서 배치 가능 | DAILY_CAPACITY_EXCEEDED |
| 출국 역산: 마지막 방문의 역 복귀 + 열차 + 공항 이동 완료 ≤ airportArrivalDeadline | DEPARTURE_DEADLINE_EXCEEDED |
| 사용자 제외 장소 미포함 | (후보 수집 단계에서 제거, 코드 불필요 — 사용자 직접 제외는 rejectedPlaces에 넣지 않는다) |

### 과선택 결과 계약 (#84)

엔진은 비교 규칙에 따른 최선 부분집합을 계속 계산하지만, UI는 선택 장소가 모두 배치되지 않은
결과를 최종 일정으로 확정하거나 저장하지 않는다. 결과 화면은 배치된 고유 장소를 기준으로 아래
세 수치를 함께 표시한다.

```text
선택 N / 배치 가능 M / 최소 K곳 제외 필요
K = N - M
```

부분 일정은 사용자가 제외 대상을 판단하기 위한 미리보기로만 표시한다. 엔진이 제외할 장소를
자동 확정하지 않으며, 사용자가 최소 K곳을 직접 선택 해제한 뒤 전체 재계산한다. 재계산 후에도
미배치가 남으면 같은 안내와 `rejectedPlaces`의 구체적인 사유를 반복한다.

### 운영시간 판정식 (PR #9 리뷰 A — open·stayMinutes 포함)

```
estimatedArrival = stationArrival + accessEstimate.minutes + buffer
visitStart       = max(estimatedArrival, open)
lastEntry가 있으면: visitStart <= lastEntry
visitEnd         = visitStart + stayMinutes
판정: visitEnd <= close
복귀: visitEnd + accessEstimate.minutes + buffer  → 다음 열차·출국 역산의 기준 시각
```

- `always_open`(출처 확인)은 판정을 통과 처리하되 복귀시간 모델은 동일 적용. (#5)
- 운영시간 판정 결과는 배치 선호와 경고에 사용한다. 장소가 철거 또는 접근 불가가 아니라면
  운영시간 밖이라는 이유만으로 후보에서 제거하지 않는다.

```ts
type ActivityWindowDetail =
  | "OUTSIDE_VERIFIED_HOURS"        // 검증된 운영시간 밖
  | "CONSERVATIVE_BUFFER_MISMATCH"  // 기본 추정 가능, 버퍼 적용 시 불가
  | "UNVERIFIED_HOURS";             // 운영시간 미확인

// 후보 하나의 자동 제외 사유
type CandidateRejection =
  | { code: "TRAIN_UNAVAILABLE"; placeId: string }
  | { code: "DAILY_CAPACITY_EXCEEDED"; placeId: string }
  | { code: "DEPARTURE_DEADLINE_EXCEEDED"; placeId: string };

// 자동 제외하지 않고 사용자에게 표시하는 운영시간 경고
type CandidateWarning = {
  code: "ACTIVITY_WINDOW_MISMATCH";
  placeId: string;
  detail: ActivityWindowDetail;
};

```

- UI 후보 목록: 세 상세 사유를 운영시간·방문 가능성 확인 배지로 표시한다.
- 발표 표현: 실제 운영시간 위반을 단정하지 않고 **보수 추정 기준상 활동 시간대 불일치**로 설명.

## 6. 후보 비교 — 사전식 (#3, 가중합 아님)

키를 순서대로 비교하고, 앞 키에서 갈리면 뒤 키는 보지 않는다.
작품을 배우보다 절대 우선하지 않는다. 두 선택 그룹의 사용자 의도를 먼저 지키고,
그 뒤 고유 방문 장소 수와 운영 품질을 비교한다.

```ts
type ComparisonKeys = {
  selectionGroupCoverageCount: number; // 1) 배우·작품 요청 그룹 중 실제 방문에 반영된 수
  selectedUnionPlaceCount: number;     // 2) 엄격 합집합의 고유 방문 장소 수
  activityWarningCount: number;        // 3) 낮을수록 우선 (#43)
  totalTravelMinutes: number;          // 4) 열차 + 역–장소 왕복 추정(문전간), 낮을수록 우선
  transferCount: number;               // 5) 낮을수록 우선
  slackSatisfied: boolean;             // 6) 충족 우선 (미달만 불이익, 초과 가점 없음)
};
```

동점 타이브레이커(결정성 보장): **출국 전 여유 큼 → 장소 ID·열차번호 사전순.**
비교 키에 이미 포함된 환승·이동시간은 동점 시점에 같으므로 반복하지 않는다(정의서 v0.5).
beam pruning도 동일한 1차 키(선택 그룹 충족 수)를 먼저 사용하고, 그 다음
`readyAt`과 안정 ID로 정렬한다. MVP beam 상한은 1,000개이며 회귀 프리셋으로 결과를 고정한다.

## 7. 출력 타입

엔진은 이전 일정을 입력받지 않고 단일 constraints 입력으로 새 일정을 계산한다. MVP는 별도의
편집 전후 요약을 제공하지 않으므로, UI는 성공한 새 결과를 명확히 표시하는 데 `metrics`를 쓴다.

```ts
type ItineraryMetrics = {
  totalTravelMinutes: number;  // 열차 + 역-장소 왕복 추정 합
  totalRailMinutes: number;
  transferCount: number;
  departureSlackMinutes: number;
};

type SelectionGroupSummary = {
  requested: ("actor" | "work")[];
  covered: ("actor" | "work")[];
  uncovered: Array<{
    group: "actor" | "work";
    reasons: Array<CandidateRejection["code"]
      | "NO_STRICT_CANDIDATES" | "EXCLUDED_BY_USER" | "NOT_SCHEDULED">;
  }>;
};

type ItineraryResult =
  | {
      status: "planned";            // 선택된 일정이 있는 정상 상태
      days: DayPlan[];              // 장소·열차편(시각·역)·추정 이동 라벨 포함
      rejectedPlaces: CandidateRejection[];
      warnings: CandidateWarning[];
      selectionGroups: SelectionGroupSummary; // 요청·반영·미반영 그룹과 사유 (#3)
      comparisonKeys: ComparisonKeys;     // '왜 이 일정인가' 화면 재사용 (#3)
      metrics: ItineraryMetrics;
      gatewayAlternatives?: GatewayAlternative[]; // #58 비차단 후속 보강 전체 일정 대안
    }
  | {
      status: "empty";              // 정상 처리, 조건을 만족하는 일정 없음
      days: [];
      rejectedPlaces: CandidateRejection[];
      warnings: CandidateWarning[];
      selectionGroups: SelectionGroupSummary;
    };
```

후보가 전멸하면 **`status: "empty"`**로 반환한다. 최초 생성에서는 빈 상태를 표시하고,
기존 일정 편집 중에는 이전 일정을 유지한다. empty 상태에는 선택된 일정이 없으므로
comparisonKeys·metrics를 포함하지 않는다(허위 값 금지, PR #16 리뷰).

`DayPlan.date`는 KST 기준 `YYYY-MM-DD`이고, 항목·열차의 `arriveAt`·`departAt`은 절대시각
ISO 문자열(직렬화 시 UTC `Z`)이다. UI는 표시에만 사용자 시간대/KST 변환을 적용한다.

### 7.1 역·권역 활용 창 `regionWindows` (#33 확정)

`DayPlan.regionWindows: RegionWindow[]` — 역 체류 구간(도착→다음 출발)을 KST 자정에서
분할한 창. **UI는 `availableMinutes`를 "약 N시간 M분 활용 가능"으로 포맷만 하고 경계
시각·역·권역을 재해석·재계산하지 않는다.**

```ts
type RegionWindow = {
  stationId: string;
  regionId: string;
  startAt: string;   // ISO — 역 경계 (접근·체류 반영 전 원본 창)
  endAt: string;
  availableMinutes: number;
  startBoundary: "AIRPORT_READY" | "GATEWAY_ARRIVAL" | "TRAIN_ARRIVAL" | "DAY_START";
  endBoundary: "TRAIN_DEPARTURE" | "AIRPORT_DEADLINE" | "DAY_END";
};
```

- **산식(#33 코멘트 확정)**: 내부 기본 활동시간 **KST 09:00-21:00**(사용자 설정 UI 없음).
  날짜별 `availableMinutes = max(0, min(endAt, 21:00) - max(startAt, 09:00))`.
  접근시간·체류시간·`dailySlackMinutes`는 배치 검증에 이미 사용되므로 **다시 차감하지
  않는다**(이중 차감 금지). 값의 의미: "역 도착·출발 경계 안에서 서비스 기본 활동시간
  기준으로 확보된 권역 창".
- 자정 분할: 첫날은 실제 시작 경계, 중간 날짜는 `DAY_START → DAY_END`, 마지막 날은 실제
  종료 경계. 각 창은 단일 KST 날짜에 속하며 시작 날짜의 `DayPlan`에 귀속된다.
- **배치 정합(PR #45 리뷰)**: 같은 활동 경계를 방문 배치에도 적용한다 — 역 출발 가능
  시각 >= 09:00(장소 도착 하한 = 09:00 + 접근·보수 버퍼), 방문 + 역 복귀 완료 <= 21:00.
  따라서 모든 실제 활동은 출력 창 안에 있으며, `availableMinutes = 0`인 창은 출력하지 않는다.
- 공항역(`isAirport`) 체류(수속·대기)는 창을 만들지 않는다. 공항역에서 출발한 진입
  구간(현재 공항철도, 추후 검증 공항버스 `GatewayLeg` 동일 규칙)의 도착이
  `GATEWAY_ARRIVAL` 경계다. 출국 마감(`airportArrivalDeadline`) 이후 시간은 계산하지 않는다.

## 8. 회귀 프리셋 3개


공통 fixture(정의서 v0.5 ITIN-003과 동일): 김고은 / 작품 4편 / 촬영지 12곳 시드(#61 확정 — KTX 비범위 춘천·죽림동성당 제외), 기준 입국 2026-08-12 10:00 / 출국 2026-08-14 18:00 / 시간표 스냅샷 2026-08-07.

| 프리셋 | 조작 | 기대 결과 |
|---|---|---|
| 촬영지 제외 | 나주영상테마파크 포함 → 제외 | ktx_시각조회.py 정답값과 일치하는 재구성 |
| 항공 변경 | 정상 도착 → 2시간 지연 | korail_시나리오확정.py 정답값 — 첫날 일정 재구성 (REQ-EDIT-006) |
| 복수 선택 합집합 | 배우와 별도 작품을 함께 선택 | 두 선택의 검증 장소 합집합을 중복 없이 사용하고 동일 입력에 동일 결과 |

기대 순위(사전식 키 값 포함)는 테스트 코드에 상수로 명시한다. 08-09 플래너 P0 완료 후
PR 필수 체크로 활성화(팀 규칙 CI 절).

## 9. 성능·기타

- 핵심 철도 재계산은 후보 50곳에서 2초 이내(REQ-EDIT-001, NFR-PERF-001).
- 핵심 추천과 공항버스 전체 대안을 결합한 엔진 경로는 후보 50곳에서 5초 이내(NFR-PERF-002, #87).
- 열차 시간표·항공은 스냅샷 기준. 항공 실호출 1건은 어댑터 계층에서 5초 폴백(REQ-DATA-003).
- 엔진 단위 테스트는 Vitest, UI 없이 실행 가능해야 한다.

## 10. REQ 매핑

| 이 문서 | 정의서 |
|---|---|
| 2. 입력·단일 진입점·관계 파생 | REQ-EDIT-001·002·006, REQ-SRCH-002 |
| 3. 시드 스키마 | REQ-DATA-001·002·004·005, NFR-I18N-001 |
| 4. 역 허브 이동 모델 | REQ-ITIN-006 |
| 5. 하드 제약·운영시간 경고·판정식 | REQ-ITIN-003·005·006, NFR-ACCU-001·003 |
| 6. 사전식 비교 | REQ-ITIN-008 '코스 선택 기준' |
| 7. 출력·metrics | REQ-EDIT-001·005, REQ-ITIN-005 |
| 8. 회귀 프리셋 | NFR-TEST-001, 팀 규칙 CI 절 |
