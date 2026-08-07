/** 일정 엔진 입출력 타입 (docs/ENGINE_SPEC.md §2·§5·§6·§7) */

export type TripConstraints = {
  arrivalAt: string;
  departureAt: string;
  airportExitOffsetMin: number; // 90 | 120 | 직접 설정 (REQ-SRCH-002)
  selectedActorId?: string;
  selectedWorkIds: string[];
  requiredPlaceIds: string[];
  excludedPlaceIds: string[];
  pinnedDates: Record<string, string>; // placeId → YYYY-MM-DD
  maxPlacesPerDay: number;
  dailySlackMinutes: number; // 일반 여유(소프트), 기본 120
  departureBufferMinutes: number; // 출국 안전 버퍼(하드), 기본 120 — #3에서 필드 분리
};

// PR #9 리뷰: 세 경우 모두 자동 일정에서 제외되며, detail로 상세를 구분한다.
// CONSERVATIVE_BUFFER_MISMATCH·UNVERIFIED_HOURS는 UI에서 '방문 가능성 직접 확인 필요' 배지.
export type ActivityWindowDetail =
  | "OUTSIDE_VERIFIED_HOURS"
  | "CONSERVATIVE_BUFFER_MISMATCH"
  | "UNVERIFIED_HOURS";

// 후보 하나의 자동 제외 사유 (rejectedPlaces 전용) — 정의서 v0.4 REQ-ITIN-005
export type CandidateRejection =
  | { code: "TRAIN_UNAVAILABLE"; placeId: string }
  | { code: "DEPARTURE_DEADLINE_EXCEEDED"; placeId: string }
  | { code: "ACTIVITY_WINDOW_MISMATCH"; placeId: string; detail: ActivityWindowDetail };

// 전체 재계산 실패 사유 (ok:false 전용) — 후보 제외가 아니라 요청 실패
export type ConstraintFailure = {
  code: "USER_CONSTRAINT_INFEASIBLE";
  constraintType: "REQUIRED_PLACE" | "PINNED_DATE";
  targetId: string;
};

// #3 최종 결정 + PR #9 리뷰: 가중합·상수 점수 없이 키들을 순서대로 비교(사전식).
// 관련성도 관계 유형별 '개수 벡터'로 비교해 임의 가중치를 원천 제거한다.
export type ComparisonKeys = {
  relevanceKey: {
    selectedWorkPlaceCount: number; // 1a) 높을수록 우선
    actorOtherWorkPlaceCount: number; // 1b) 1a 동점일 때, 높을수록 우선
  };
  visitablePlaceCount: number; // 2) 높을수록 우선
  totalRailMinutes: number; // 3) 낮을수록 우선
  transferCount: number; // 4) 낮을수록 우선
  slackSatisfied: boolean; // 5) 충족 우선 (미달만 불이익, 초과 가점 없음)
};

export type ItineraryMetrics = {
  totalTravelMinutes: number; // 열차 + 역-장소 왕복 추정 합
  totalRailMinutes: number;
  transferCount: number;
  departureSlackMinutes: number;
};

export type ItineraryItem = {
  placeId: string;
  arriveAt: string;
  departAt: string;
  accessMinutesLabel: string; // 항상 '추정치' 라벨과 함께 표시 (REQ-ITIN-006)
};

export type TrainRide = {
  trainNo: string;
  fromStationId: string;
  toStationId: string;
  departAt: string;
  arriveAt: string;
};

export type DayPlan = {
  date: string; // YYYY-MM-DD
  items: ItineraryItem[];
  rides: TrainRide[];
};

export type ItineraryResult =
  | {
      ok: true;
      status: "planned"; // 선택된 일정이 있는 정상 상태
      days: DayPlan[];
      rejectedPlaces: CandidateRejection[]; // 숨기지 않고 사유와 함께 (REQ-ITIN-005)
      comparisonKeys: ComparisonKeys; // '왜 이 일정인가' 표시 재사용 (#3)
      metrics: ItineraryMetrics; // 편집 전후 비교(diff)는 앱 계층이 metrics로 계산 (PR #9 리뷰)
    }
  | {
      ok: true;
      status: "empty"; // 정상 처리됐지만 조건을 만족하는 일정 없음 — 허위 metrics 금지 (PR #16 리뷰)
      days: [];
      rejectedPlaces: CandidateRejection[];
    }
  | { ok: false; reason: ConstraintFailure }; // 사용자 제약 위반 — UI는 기존 일정 유지
