/** 일정 엔진 입출력 타입 (docs/ENGINE_SPEC.md §2·§5·§6·§7) */
import type { GatewayLegT } from "../types/schema";
import type { SelectionGroup } from "../selection-candidates";

export type TripConstraints = {
  arrivalAt: string;
  departureAt: string;
  airportReadyAt: string; // ISO — 공항 출발 가능 시각. 절대 시각 입력 (#14 차단 2, REQ-SRCH-002 개정)
  airportStationId?: string; // 공항철도 출발·도착역. 생략 시 isAirport 역을 사용한다.
  gatewayStationId?: string; // 생략하면 수도권 대표 관문역을 결정적으로 선택한다.
  selectedActorIds?: string[]; // 복수 배우 선택. selectedActorId와 합쳐서 처리한다.
  /** @deprecated 기존 호출부 호환용. 새 호출부는 selectedActorIds를 사용한다. */
  selectedActorId?: string;
  selectedWorkIds: string[];
  excludedPlaceIds: string[];
  maxPlacesPerDay: number;
  dailySlackMinutes: number; // 일반 여유(소프트), 기본 120
  airportArrivalDeadline: string; // ISO — 공항 도착 마감 시각(하드). offset 역산 대신 절대 시각 (#14 차단 2)
  // #139: 방문일 소프트 선호. placeId → YYYY-MM-DD(KST).
  // 하드 의미의 pinnedDates(6d308d0에서 제거)를 되살리지 않는다 — 못 지켜도 일정은 나오고
  // 비교 순위만 밀린다. 실패 코드(USER_CONSTRAINT_INFEASIBLE)를 추가하지 않는 이유다.
  preferredVisitDates?: Record<string, string>;
  /**
   * 방문 순서 선호 — `[먼저, 나중]` precedence 쌍 (#145 A안).
   *
   * 방문일과 같은 **소프트 선호**다. 못 지켜도 일정은 나오고 비교 순위만 밀린다. 8/8에 폐기한
   * 하드 순서 강제(D안)를 되살리지 않는다 — 실패 경로를 늘리지 않는 것이 #139에서 이미 정한 축이다.
   *
   * 쌍으로 받는 이유는 드래그 한 번과 1:1로 대응하기 때문이다. 날짜별 전체 배열(B안)은 그 날
   * 장소 집합이 바뀌면 요청이 부분적으로 무의미해지고, 시간대(C안)는 `A 다음에 B`를 표현하지 못한다.
   *
   * 판정은 **전체 방문 순서** 기준이다. 두 장소가 다른 날에 배치돼도 앞뒤가 맞으면 지킨 것으로 센다 —
   * 어느 날에 두느냐는 `preferredVisitDates`가 맡는 축이라 여기서 겹쳐 판정하지 않는다.
   */
  preferredOrder?: ReadonlyArray<readonly [string, string]>;
};

// #43 결정 1: 운영시간은 하드 제약이 아니다 — 판정식(#5) 결과는 제외가 아니라
// 경고로 전달하고, 세 상세는 UI 배지·경고 문구로 쓴다.
export type ActivityWindowDetail =
  | "OUTSIDE_VERIFIED_HOURS"
  | "CONSERVATIVE_BUFFER_MISMATCH"
  | "UNVERIFIED_HOURS";

// 후보 하나의 자동 제외 사유 (rejectedPlaces 전용) — #43 확정으로 열차·출국 마감만 남는다
// #84 P0-1: 실제 원인이 다른 실패를 한 코드로 뭉치지 않는다. 하루 장소 수 상한 때문에
// 밀린 경우와 여행 마감 안에 못 넣는 경우는 사용자가 할 수 있는 일이 다르다 —
// 전자는 선택을 줄이거나 날짜를 늘리면 되고, 후자는 항공·기간 조건을 바꿔야 한다.
// #84 §2 · #171 — **"장소 단독 불가능"과 "최선 부분집합에서 밀림"을 한 코드로 뭉치지 않는다.**
// 앞의 셋은 그 장소를 혼자 넣어도 안 되는 경우다: 연결편이 없거나, 하루 상한에 걸리거나,
// 출국 마감을 못 지킨다. 사용자가 할 수 있는 일은 조건을 바꾸는 것뿐이다.
//
// `NOT_IN_BEST_SUBSET`은 다르다 — **혼자면 갈 수 있는데 지금 조합에서 밀린 것**이다.
// 선택을 줄이면 들어온다. 이 둘을 뭉치면 화면이 "KTX가 없다"고 말하는데 실제로는 KTX가
// 멀쩡히 다니는 상황이 생기고, 사용자는 고칠 수 있는 문제를 못 고친다.
export type CandidateRejection =
  | { code: "TRAIN_UNAVAILABLE"; placeId: string }
  // #178 — 심야 환승 규칙이 없었다면 연결 가능했던 장소. 열차는 있는데 밤샘 대기 연결뿐이라
  // 안 쓰는 것이므로 "열차가 없다"와 원인이 다르다 — 한 코드에 뭉치지 않는다(#84 원칙).
  | { code: "OVERNIGHT_TRANSFER_REQUIRED"; placeId: string }
  | { code: "DAILY_CAPACITY_EXCEEDED"; placeId: string }
  | { code: "DEPARTURE_DEADLINE_EXCEEDED"; placeId: string }
  | { code: "NOT_IN_BEST_SUBSET"; placeId: string };

// 배치된 방문의 운영시간 경고 (#43 결정 1 — 경고 누락 0건이 수용 기준)
export type CandidateWarning = {
  code: "ACTIVITY_WINDOW_MISMATCH";
  placeId: string;
  detail: ActivityWindowDetail;
};

// #3 최종 결정: 가중합·상수 점수 없이 선택 그룹 충족부터 키를 순서대로 비교한다.
export type ComparisonKeys = {
  selectionGroupCoverageCount: number; // 1) 배우·작품 요청 그룹 중 실제 방문에 반영된 수(최대 2)
  selectedUnionPlaceCount: number; // 2) 두 엄격 후보 집합 합집합의 고유 방문 장소 수
  verifiedHoursMismatchCount: number; // 3) 낮을수록 우선 — 검증된 운영시간 밖 배치 수 (#198)
  // 4) 낮을수록 우선 — 선호 날짜를 못 지킨 수 (#139). 경고 뒤·이동시간 앞:
  //    운영시간 신뢰를 깎으면서까지 선호를 강제하지는 않되, 단순 이동시간보다는 사용자 의사를 앞에 둔다.
  preferredDateMismatchCount: number;
  // 5) 낮을수록 우선 — 못 지킨 순서 쌍 수 (#145). **방문일과 합치지 않는다**: 하나로 합치면
  //    엔진이 방문일 하나를 어기고 순서 하나를 지키는 식으로 맞바꿀 수 있는데 둘은 같은 무게가 아니다.
  preferredOrderMismatchCount: number;
  totalTravelMinutes: number; // 6) 열차 + 역–장소 왕복 추정(문전간), 낮을수록 우선
  transferCount: number; // 7) 낮을수록 우선
  slackSatisfied: boolean; // 8) 충족 우선 (미달만 불이익, 초과 가점 없음)
};

export type SelectionGroupUncoveredReason =
  | CandidateRejection["code"]
  | "NO_STRICT_CANDIDATES"
  | "EXCLUDED_BY_USER"
  | "NOT_SCHEDULED";

/** #3: 한 그룹을 반영하지 못해도 가능한 일정은 유지하고 그룹·사유를 함께 반환한다. */
export type SelectionGroupSummary = {
  requested: SelectionGroup[];
  covered: SelectionGroup[];
  uncovered: Array<{ group: SelectionGroup; reasons: SelectionGroupUncoveredReason[] }>;
};

export type ItineraryMetrics = {
  totalTravelMinutes: number; // 열차 + 역-장소 왕복 추정 합
  totalRailMinutes: number;
  transferCount: number;
  departureSlackMinutes: number;
};

export type ItineraryItem = {
  placeId: string;
  arriveAt: string; // 절대시각 ISO. 직렬화는 UTC(Z), DayPlan.date만 KST 기준이다.
  departAt: string;
  // 편도 접근시간 예산(분). 완성 문장 대신 숫자만 내려 UI가 locale에 맞춰
  // '약 N분 · 추정치' 라벨과 함께 포맷한다 (REQ-ITIN-006, PR #59 리뷰 1)
  accessMinutes: number;
};

export type TrainRide = {
  trainNo: string;
  fromStationId: string;
  toStationId: string;
  departAt: string;
  arriveAt: string;
};

/** #58 — 열차로 가장하지 않는 검증 공항 진입 구간. */
export type GatewayRide = GatewayLegT;

// #33 확정 계약 — 역·권역 단위 현지 활용 가능 시간. UI는 availableMinutes를
// "약 N시간 M분 활용 가능"으로 포맷만 하고 경계·시각을 재해석·재계산하지 않는다.
export type RegionWindowStartBoundary =
  | "AIRPORT_READY" // 공항 출발 가능 시각에서 바로 시작 (선행 열차 없음)
  | "GATEWAY_ARRIVAL" // 공항 진입 구간(공항역 출발 leg — 공항철도, 추후 검증 버스 동일 규칙) 도착
  | "TRAIN_ARRIVAL"
  | "DAY_START"; // KST 자정 분할의 이어지는 창

export type RegionWindowEndBoundary =
  | "TRAIN_DEPARTURE"
  | "AIRPORT_DEADLINE" // 공항 도착 마감이 창을 끊음 (종점이 관문역인 경우 등)
  | "DAY_END"; // KST 자정 분할의 앞 창

export type RegionWindow = {
  stationId: string;
  regionId: string;
  startAt: string; // ISO (UTC 직렬화)
  endAt: string;
  /** 하루 활동 가능 시간대(09:00-21:00 KST, 내부 기본 — #33 확정)와의 겹침. 접근·체류·여유 미차감 */
  availableMinutes: number;
  startBoundary: RegionWindowStartBoundary;
  endBoundary: RegionWindowEndBoundary;
};

export type DayPlan = {
  date: string; // KST 기준 YYYY-MM-DD
  items: ItineraryItem[];
  rides: TrainRide[];
  gatewayLegs?: GatewayRide[]; // 저장 레코드 v2 호환을 위한 additive optional
  regionWindows: RegionWindow[]; // #33 — 해당 날짜(KST) 시작 창만, startAt 오름차순
};

export type GatewayAlternative = {
  id: string;
  kind: "gateway_bus";
  routeId: string;
  serviceName: { ko: string; en: string };
  operator: { ko: string; en: string };
  days: DayPlan[]; // 부분 패치가 아닌 전체 교체 일정
  rejectedPlaces: CandidateRejection[];
  warnings: CandidateWarning[];
  metrics: ItineraryMetrics & { totalGatewayMinutes: number };
  effects: { localUseDeltaMinutes: number; excludedPlaceIds: string[] };
  schedule: {
    kind: "observed_snapshot";
    verifiedAt: string;
    recheckRequired: true;
  };
};

export type VerifiedAlternativeImprovement = "faster" | "fewer_transfers";

/**
 * #198 — 검증 시간표와 동일한 하드 제약을 통과한 전체 일정 대안.
 *
 * `improvements`·`changes`·`deltas`는 추천 원본 대비 구조화된 사실이다. UI는 이 값만으로
 * 개선과 맞교환되는 손실을 말하며, 해당 사실이 없으면 문구도 만들지 않는다.
 */
export type VerifiedItineraryAlternative = {
  id: string;
  kind: "verified_itinerary";
  improvements: VerifiedAlternativeImprovement[];
  days: DayPlan[];
  rejectedPlaces: CandidateRejection[];
  warnings: CandidateWarning[];
  selectionGroups: SelectionGroupSummary;
  comparisonKeys: ComparisonKeys;
  metrics: ItineraryMetrics;
  preferredDateOutcomes?: PreferredDateOutcome[];
  preferredOrderOutcomes?: PreferredOrderOutcome[];
  changes: {
    removedPlaceIds: string[]; // 추천에는 있지만 대안에는 없는 장소
    addedPlaceIds: string[]; // 대안에 새로 들어온 장소
  };
  deltas: {
    totalTravelMinutes: number; // 대안 - 추천. 음수면 더 빠름
    transferCount: number; // 대안 - 추천. 음수면 환승 적음
    verifiedHoursMismatchCount: number;
    preferredDateMismatchCount: number;
    preferredOrderMismatchCount: number;
    warningCount: number;
  };
};

/**
 * #139 — 선호 날짜 하나하나의 반영 결과. 실패 분기 대신 이 목록으로 알린다.
 *
 * - `honored`   요청한 날짜에 배치됨
 * - `adjusted`  일정에는 들어갔지만 다른 날짜로 조정됨 (`scheduledDate`)
 * - `unplaced`  일정에 포함되지 못함 — 사유는 rejectedPlaces가 따로 말한다
 *
 * 원인을 증명할 수 없으면 단정하지 않는다. UI 문구는 "요청한 날짜를 반영하지 못해
 * 가능한 일정으로 조정했어요" 수준으로만 쓴다 (#139 4절).
 */
/**
 * 순서 선호 하나의 반영 결과 (#145).
 *
 * `adjusted`는 둘 다 배치됐지만 요청한 앞뒤가 아닌 경우다. 실험에서 이 비율이 14.9%였고
 * 그때도 장소가 줄거나 이동시간이 크게 늘지는 않았다 — 못 지키면 원래 순서로 남을 뿐이다.
 */
export type PreferredOrderOutcome = {
  firstPlaceId: string;
  secondPlaceId: string;
  outcome: "honored" | "adjusted" | "unplaced";
};

export type PreferredDateOutcome = {
  placeId: string;
  requestedDate: string; // YYYY-MM-DD (KST)
  outcome: "honored" | "adjusted" | "unplaced";
  scheduledDate?: string; // adjusted에서만 — 실제 배치된 날짜
};

// #14 ver.0.4 확정: 필수 방문·방문일 고정 입력이 없어 사용자 제약 실패(ok:false) 분기가
// 소멸했다. 결과는 planned/empty 2분기이며 status가 유일한 판별자다.
// #139의 소프트 선호도 이 2분기를 바꾸지 않는다 — 선호는 preferredDateOutcomes로만 보고된다.
export type ItineraryResult =
  | {
      status: "planned"; // 선택된 일정이 있는 정상 상태
      days: DayPlan[];
      rejectedPlaces: CandidateRejection[]; // 숨기지 않고 사유와 함께 (REQ-ITIN-005)
      warnings: CandidateWarning[]; // 배치는 유지하되 방문 전 확인 필요 (#43)
      selectionGroups: SelectionGroupSummary;
      comparisonKeys: ComparisonKeys; // '왜 이 일정인가' 표시 재사용 (#3)
      metrics: ItineraryMetrics; // 편집 전후 비교(diff)는 앱 계층이 metrics로 계산 (PR #9 리뷰)
      gatewayAlternatives?: GatewayAlternative[]; // #58 검증 직행버스 전체 일정 대안
      verifiedAlternatives?: VerifiedItineraryAlternative[]; // #198 검증 시간표 기반 전체 일정 대안
      // #139 — 선호 입력이 있을 때만. 요청한 placeId 사전순. 선호가 없으면 필드 자체가 없다
      preferredDateOutcomes?: PreferredDateOutcome[];
      // #145 — 순서 선호가 있을 때만. `[먼저, 나중]` 사전순
      preferredOrderOutcomes?: PreferredOrderOutcome[];
    }
  | {
      status: "empty"; // 정상 처리됐지만 조건을 만족하는 일정 없음 — 허위 metrics 금지 (PR #16 리뷰)
      days: [];
      rejectedPlaces: CandidateRejection[];
      warnings: CandidateWarning[]; // empty에서는 항상 빈 배열 — 배치가 없으면 경고도 없다
      selectionGroups: SelectionGroupSummary;
    };
