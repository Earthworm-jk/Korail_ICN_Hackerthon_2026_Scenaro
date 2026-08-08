/** 일정 엔진 입출력 타입 (docs/ENGINE_SPEC.md §2·§5·§6·§7) */

export type TripConstraints = {
  arrivalAt: string;
  departureAt: string;
  airportExitOffsetMin: number; // 90 | 120 | 직접 설정 (REQ-SRCH-002)
  airportStationId?: string; // 공항철도 출발·도착역. 생략 시 isAirport 역을 사용한다.
  gatewayStationId?: string; // 생략하면 수도권 대표 관문역을 결정적으로 선택한다.
  selectedActorIds?: string[]; // 복수 배우 선택. selectedActorId와 합쳐서 처리한다.
  /** @deprecated 기존 호출부 호환용. 새 호출부는 selectedActorIds를 사용한다. */
  selectedActorId?: string;
  selectedWorkIds: string[];
  excludedPlaceIds: string[];
  maxPlacesPerDay: number;
  dailySlackMinutes: number; // 일반 여유(소프트), 기본 120
  departureBufferMinutes: number; // 출국 안전 버퍼(하드), 기본 120 — #3에서 필드 분리
};

// #43 결정 1: 운영시간은 하드 제약이 아니다 — 판정식(#5) 결과는 제외가 아니라
// 경고로 전달하고, 세 상세는 UI 배지·경고 문구로 쓴다.
export type ActivityWindowDetail =
  | "OUTSIDE_VERIFIED_HOURS"
  | "CONSERVATIVE_BUFFER_MISMATCH"
  | "UNVERIFIED_HOURS";

// 후보 하나의 자동 제외 사유 (rejectedPlaces 전용) — #43 확정으로 열차·출국 마감만 남는다
export type CandidateRejection =
  | { code: "TRAIN_UNAVAILABLE"; placeId: string }
  | { code: "DEPARTURE_DEADLINE_EXCEEDED"; placeId: string };

// 배치된 방문의 운영시간 경고 (#43 결정 1 — 경고 누락 0건이 수용 기준)
export type CandidateWarning = {
  code: "ACTIVITY_WINDOW_MISMATCH";
  placeId: string;
  detail: ActivityWindowDetail;
};

// #3 최종 결정 + PR #9 리뷰: 가중합·상수 점수 없이 키들을 순서대로 비교(사전식).
// 관련성도 관계 유형별 '개수 벡터'로 비교해 임의 가중치를 원천 제거한다.
export type ComparisonKeys = {
  relevanceKey: {
    selectedWorkPlaceCount: number; // 1a) 높을수록 우선
    actorOtherWorkPlaceCount: number; // 1b) 1a 동점일 때, 높을수록 우선
  };
  visitablePlaceCount: number; // 2) 높을수록 우선
  activityWarningCount: number; // 3) 낮을수록 우선 — 운영시간 경고 수 (#43 결정 3, #3 개정)
  totalRailMinutes: number; // 4) 낮을수록 우선
  transferCount: number; // 5) 낮을수록 우선
  slackSatisfied: boolean; // 6) 충족 우선 (미달만 불이익, 초과 가점 없음)
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
  date: string; // KST 기준 YYYY-MM-DD
  items: ItineraryItem[];
  rides: TrainRide[];
};

// #14 ver.0.4 확정: 필수 방문·방문일 고정 입력이 없어 사용자 제약 실패(ok:false) 분기가
// 소멸했다. 결과는 planned/empty 2분기이며 status가 유일한 판별자다.
export type ItineraryResult =
  | {
      status: "planned"; // 선택된 일정이 있는 정상 상태
      days: DayPlan[];
      rejectedPlaces: CandidateRejection[]; // 숨기지 않고 사유와 함께 (REQ-ITIN-005)
      warnings: CandidateWarning[]; // 배치는 유지하되 방문 전 확인 필요 (#43)
      comparisonKeys: ComparisonKeys; // '왜 이 일정인가' 표시 재사용 (#3)
      metrics: ItineraryMetrics; // 편집 전후 비교(diff)는 앱 계층이 metrics로 계산 (PR #9 리뷰)
    }
  | {
      status: "empty"; // 정상 처리됐지만 조건을 만족하는 일정 없음 — 허위 metrics 금지 (PR #16 리뷰)
      days: [];
      rejectedPlaces: CandidateRejection[];
      warnings: CandidateWarning[]; // empty에서는 항상 빈 배열 — 배치가 없으면 경고도 없다
    };
