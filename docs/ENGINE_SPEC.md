# 씬나로 일정 엔진 명세 v0.2

> 근거: 이슈 #2(편집·사유 코드), #3(점수·사전식 비교), #5(운영시간) 최종 결정 + PR #9 리뷰 반영.
> 상위 문서: 요구사항 정의서(v0.3에서 REQ-ITIN-008 '코스 선택 기준'·회귀 테스트 요구 신설 예정).

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
  airportExitOffsetMin: 90 | 120 | number; // 착륙 후 출발 가능시점 (REQ-SRCH-002)
  selectedActorId?: string;     // 배우 중심 탐색
  selectedWorkIds: string[];    // 작품 중심(복수 가능)
  requiredPlaceIds: string[];   // 필수 방문 — 하드 제약
  excludedPlaceIds: string[];   // 사용자 제외 — 하드 제약
  pinnedDates: Record<string, string>; // placeId → YYYY-MM-DD, 고정 방문일 — 하드 제약
  maxPlacesPerDay: number;      // 여행 속도 (REQ-ITIN-001)
  dailySlackMinutes: number;    // 일반 여유(소프트), 기본 120
  departureBufferMinutes: number; // 출국 안전 버퍼(하드), 기본 120 — #3 결정으로 필드 분리
};

// 단일 진입점 (REQ-EDIT-001·002·006 공통, #2 결정)
function generateItinerary(c: TripConstraints, repos: Repos): ItineraryResult;
```

편집 3동작(촬영지 제외 / 방문일 변경 / 항공편 시각 변경)은 모두 `TripConstraints`의
해당 필드만 바꿔 같은 함수를 다시 호출한다. UI는 **성공 응답일 때만** 일정을 교체한다. (REQ-EDIT-005)

### 관계 유형은 시드가 아니라 constraints에서 파생한다 (PR #9 리뷰 B)

장소–선택의 관계는 무엇을 선택했는지에 따라 달라지므로 시드에 정적으로 저장하지 않는다.

```
place.workIds ∩ selectedWorkIds ≠ ∅            → selected_work
selectedActorId가 있고
place.workIds ∩ actor(selectedActorId).workIds ≠ ∅ → actor_other_work
둘 다 아님                                        → 후보 아님 (NFR-ACCU-001)
```

## 3. 시드 데이터 스키마 (Zod 요약)

Python 파이프라인이 생성하고, 앱 기동 시 Zod로 검증한다(REQ-DATA-004). 스키마가 곧 데이터 명세다.

```ts
const OpeningHours = z.discriminatedUnion("type", [
  z.object({ type: z.literal("always_open"), source: z.string(), verifiedAt: z.string() }),
  z.object({
    type: z.literal("hours"),
    open: z.string(), close: z.string(),          // HH:mm
    lastEntry: z.string().optional(),             // 마지막 입장
    closedDays: z.array(z.string()).optional(),   // 휴무
    source: z.string(), verifiedAt: z.string(),
  }),
  z.object({ type: z.literal("unverified") }),    // 자동 일정 제외 대상 (#5)
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
```

버퍼는 저장하지 않고 파생: `bufferMin = max(20, ceil(accessEstimate.minutes * 0.5))`. (#5)

## 4. 알고리즘 (전체 재계산, 7단계)

```
1. 입력 검증           — Zod. 실패는 예외(사유 코드 아님)
2. 후보 장소 수집       — §2 파생 규칙으로 selected_work / actor_other_work 후보만
3. 하드 필터           — 아래 5.의 제약 위반 장소·후보 제거, 사유 코드 기록
4. 일자 슬롯 구성       — 입국+airportExitOffset ... 출국-departureBuffer 사이,
                         maxPlacesPerDay·dailySlackMinutes 반영
5. 열차 선택           — 시간표 스냅샷에서 역 간 연결 가능한 편 탐색
6. 후보 일정 생성·비교   — 사전식 비교(아래 6.)로 최선 일정 선택
7. 결과 조립           — days, rejectedPlaces(사유 코드), comparisonKeys, metrics
```

### 지역 내 이동 모델 — 역 허브, 왕복 동일 추정 (PR #9 리뷰 A)

지역 내 직접 경로는 계산하지 않는다. **역을 허브로 보고, 모든 방문은 `역 → 장소 → 역`으로
모델링하며 복귀에도 동일한 `accessEstimate.minutes + buffer`를 보수적으로 적용한다.**
같은 역 권역에서 여러 장소를 방문해도 각 방문은 역 기준 왕복으로 시간을 소비한 것으로 계산한다
(보수적 — 실제보다 여유 있게 잡히며, 과장 금지 원칙과 일치).

## 5. 하드 제약 (위반 시 점수 계산 전 제거)

| 제약 | 사유 코드 |
|---|---|
| 연결 가능한 열차 존재 | TRAIN_UNAVAILABLE |
| 출국 역산: 마지막 방문의 역 복귀 + 열차 + 공항 이동 + departureBufferMinutes ≤ 출국 시각 | DEPARTURE_DEADLINE_EXCEEDED |
| 운영시간 판정(아래 판정식) | ACTIVITY_WINDOW_MISMATCH (+detail) |
| 필수 장소 포함 / 고정 방문일 준수 불가 | USER_CONSTRAINT_INFEASIBLE (+constraintType, targetId) |
| 사용자 제외 장소 미포함 | (후보 수집 단계에서 제거, 코드 불필요 — 사용자 직접 제외는 rejectedPlaces에 넣지 않는다) |

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
- 판정 실패의 상세는 detail로 구분하며, 세 경우 모두 자동 일정에서 제외된다:

```ts
type ActivityWindowDetail =
  | "OUTSIDE_VERIFIED_HOURS"        // 검증된 운영시간 밖
  | "CONSERVATIVE_BUFFER_MISMATCH"  // 기본 추정 가능, 버퍼 적용 시 불가
  | "UNVERIFIED_HOURS";             // 운영시간 미확인

type RejectionReason =
  | { code: "TRAIN_UNAVAILABLE"; placeId: string }
  | { code: "DEPARTURE_DEADLINE_EXCEEDED"; placeId: string }
  | { code: "ACTIVITY_WINDOW_MISMATCH"; placeId: string; detail: ActivityWindowDetail }
  | {
      code: "USER_CONSTRAINT_INFEASIBLE";
      constraintType: "REQUIRED_PLACE" | "PINNED_DATE"; targetId: string;
    };
```

- UI 후보 목록: `CONSERVATIVE_BUFFER_MISMATCH`·`UNVERIFIED_HOURS`는
  `방문 가능성 직접 확인 필요` 배지로 표시. (#5)
- 발표 표현: 실제 운영시간 위반을 단정하지 않고 **보수 추정 기준상 활동 시간대 불일치**로 설명.

## 6. 후보 비교 — 사전식 (#3, 가중합 아님)

키를 순서대로 비교하고, 앞 키에서 갈리면 뒤 키는 보지 않는다.
**관련성도 상수 점수(5/3)가 아니라 관계 유형별 개수 벡터로 비교한다** (PR #9 리뷰 B —
가중합 오해 원천 제거):

```ts
type ComparisonKeys = {
  relevanceKey: {
    selectedWorkPlaceCount: number;   // 1a) 높을수록 우선
    actorOtherWorkPlaceCount: number; // 1b) 1a 동점일 때, 높을수록 우선
  };
  visitablePlaceCount: number;        // 2) 높을수록 우선
  totalRailMinutes: number;           // 3) 낮을수록 우선
  transferCount: number;              // 4) 낮을수록 우선
  slackSatisfied: boolean;            // 5) 충족 우선 (미달만 불이익, 초과 가점 없음)
};
```

동점 타이브레이커(결정성 보장): 환승 적음 → 총 이동시간 짧음 → 출국 전 여유 큼 →
장소 ID·열차번호 사전순.

## 7. 출력 타입 (PR #9 리뷰 C — diff는 앱 계층 책임)

엔진은 이전 일정을 입력받지 않는다(단일 constraints 입력 유지). 대신 `metrics`를 반환하고,
**편집 전후 비교(diff)는 UI/애플리케이션 계층이 이전 결과의 metrics와 새 결과의 metrics를
비교해 만든다.** (REQ-EDIT-004)

```ts
type ItineraryMetrics = {
  totalTravelMinutes: number;  // 열차 + 역-장소 왕복 추정 합
  totalRailMinutes: number;
  transferCount: number;
  departureSlackMinutes: number;
};

type ItineraryResult =
  | {
      ok: true;
      days: DayPlan[];              // 장소·열차편(시각·역)·추정 이동 라벨 포함
      rejectedPlaces: RejectionReason[];  // 엔진이 자동 제외한 후보 (REQ-ITIN-005)
      comparisonKeys: ComparisonKeys;     // '왜 이 일정인가' 화면 재사용 (#3)
      metrics: ItineraryMetrics;
    }
  | { ok: false; reason: RejectionReason };       // UI는 기존 일정 유지 (REQ-EDIT-005)
```

## 8. 회귀 프리셋 3개 (기존 Python 시나리오 정답값 이식)

공통 fixture: 김고은 / 작품 4편 / 촬영지 14곳 시드(가안 — #1 수동 검증 완료 시 확정), 기준 항공편.

| 프리셋 | 조작 | 기대 결과 |
|---|---|---|
| 촬영지 제외 | 나주영상테마파크 포함 → 제외 | ktx_시각조회.py 정답값과 일치하는 재구성 |
| 항공 변경 | 정상 도착 → 2시간 지연 | korail_시나리오확정.py 정답값 — 첫날 일정 재구성 (REQ-EDIT-006) |
| 방문일 고정 | 특정 장소를 다른 날로 고정 | 두 날짜 모두 제약 위반 0건 또는 USER_CONSTRAINT_INFEASIBLE(PINNED_DATE) |

기대 순위(사전식 키 값 포함)는 테스트 코드에 상수로 명시한다. 08-09 플래너 P0 완료 후
PR 필수 체크로 활성화(팀 규칙 CI 절).

## 9. 성능·기타

- 재계산 목표 2초 이내(REQ-EDIT-001, 정의서 v0.3에서 NFR-PERF-001을 P0로 승격 예정).
- 열차 시간표·항공은 스냅샷 기준. 항공 실호출 1건은 어댑터 계층에서 5초 폴백(REQ-DATA-003).
- 엔진 단위 테스트는 Vitest, UI 없이 실행 가능해야 한다.

## 10. REQ 매핑

| 이 문서 | 정의서 |
|---|---|
| 2. 입력·단일 진입점·관계 파생 | REQ-EDIT-001·002·006, REQ-SRCH-002 |
| 3. 시드 스키마 | REQ-DATA-001·002·004·005, NFR-I18N-001 |
| 4. 역 허브 이동 모델 | REQ-ITIN-006 |
| 5. 하드 제약·사유 코드·판정식 | REQ-ITIN-003·005·006, NFR-ACCU-001·003 |
| 6. 사전식 비교 | 정의서 v0.3 신설 예정 REQ-ITIN-008 '코스 선택 기준' |
| 7. 출력·metrics | REQ-EDIT-004·005, REQ-ITIN-005 |
| 8. 회귀 프리셋 | 정의서 v0.3 회귀 테스트 요구 신설 예정, 팀 규칙 CI 절 |
