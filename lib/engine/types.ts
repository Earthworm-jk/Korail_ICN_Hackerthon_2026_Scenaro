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

export type RejectionReason =
  | { code: "TRAIN_UNAVAILABLE"; placeId: string }
  | { code: "DEPARTURE_DEADLINE_EXCEEDED"; placeId: string }
  | { code: "ACTIVITY_WINDOW_MISMATCH"; placeId: string; severity: "excluded" | "warning" }
  | {
      code: "USER_CONSTRAINT_INFEASIBLE";
      constraintType: "REQUIRED_PLACE" | "PINNED_DATE";
      targetId: string;
    };

// #3 최종 결정: 가중합이 아니라 이 키들을 순서대로 비교(사전식)
export type ComparisonKeys = {
  relevanceScore: number; // 높을수록 우선
  visitablePlaceCount: number; // 높을수록 우선
  totalRailMinutes: number; // 낮을수록 우선
  transferCount: number; // 낮을수록 우선
  slackSatisfied: boolean; // 충족 우선 (미달만 불이익, 초과 가점 없음)
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
      days: DayPlan[];
      rejectedPlaces: RejectionReason[]; // 숨기지 않고 사유와 함께 (REQ-ITIN-005)
      comparisonKeys: ComparisonKeys; // '왜 이 일정인가' 표시 재사용 (#3)
      diff?: { totalTravelDeltaMinutes: number }; // 편집 전후 비교 (REQ-EDIT-004)
    }
  | { ok: false; reason: RejectionReason }; // UI는 기존 일정 유지 (REQ-EDIT-005)

// #3: 관련성 점수는 시드가 아니라 엔진 상수에서 파생
export const RELEVANCE_SCORE = {
  selected_work: 5,
  actor_other_work: 3,
} as const;
