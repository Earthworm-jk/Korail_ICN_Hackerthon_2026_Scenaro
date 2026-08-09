/**
 * 일정 재계산 전후 비교 (#103 · 발표 시나리오 "열차를 놓쳐도 일정이 스스로 다시 선다")
 *
 * 조건이 바뀌어 일정을 다시 계산하면 지금은 새 일정이 옛 일정을 조용히 덮어쓴다.
 * 사용자는 무엇이 달라졌는지 알 수 없다 — 어떤 열차를 놓쳤는지, 어떤 방문이 다음 날로
 * 밀렸는지, 어떤 장소가 빠졌는지.
 *
 * #103이 정한 원칙은 "조용히 축소하지 않고 영향을 설명한 뒤 사용자가 선택하게 한다"이고,
 * 그러려면 먼저 **무엇이 바뀌었는지**를 계산해야 한다. 이 모듈이 그 계산만 한다.
 * 문구·화면은 만들지 않는다 (엔진은 분 값과 코드만 내리고 라벨은 locale이 조합한다 —
 * REQ-ITIN-006 · PR #59 리뷰 1).
 *
 * 비교는 두 결과를 받아 순수 함수로 수행한다. 재계산을 촉발한 원인(항공 지연·사용자의
 * 열차 변경)은 이 모듈의 관심사가 아니다 — 같은 diff가 두 경우 모두를 설명한다.
 */
import type {
  CandidateRejection,
  DayPlan,
  ItineraryResult,
  TrainRide,
} from "./engine/types";

/** 열차 한 편의 동일성 — 같은 편이 같은 구간을 같은 시각에 달리면 같은 탑승이다 */
function rideKey(ride: TrainRide): string {
  return [ride.trainNo, ride.fromStationId, ride.toStationId, ride.departAt].join("\0");
}

export type RideDiff = {
  /** 이전 일정에 있었고 새 일정에는 없는 탑승 전부 */
  dropped: TrainRide[];
  /**
   * `dropped` 중 **주어진 경계 때문에 탈 수 없게 된** 편.
   * 나머지 `dropped`는 엔진이 전체를 다시 최적화하며 바뀐 것이지 못 타게 된 것이 아니다.
   * 이 둘을 뭉치면 사실이 아닌 설명이 된다.
   * `unusable` 옵션이 없으면 항상 빈 배열이다 — 경계를 모르면 판정하지 않는다.
   */
  missed: TrainRide[];
  /** 새 일정에만 있는 탑승 — "재선택된 열차" */
  added: TrainRide[];
  /** 양쪽에 그대로 있는 탑승 */
  kept: TrainRide[];
};

/**
 * 무엇 때문에 열차를 탈 수 없게 됐는지. **범위를 함께 선언해야 한다** (PR #105 리뷰).
 *
 * 경계를 시각 하나로만 받으면 범위가 전역이 되어, 특정 구간을 늦춘 경우에도 앞선 날짜의
 * 무관한 구간까지 "못 타게 됐다"로 분류된다. 그 열차는 재최적화로 바뀐 것이지 사용자가
 * 놓친 것이 아니다.
 */
export type UnusableScope =
  /**
   * 여행 시작 경계가 뒤로 밀린 경우 — 항공 지연 등. 그 시각 이전 출발은 전부 탈 수 없다.
   */
  | { kind: "trip_start"; notBefore: string }
  /**
   * 사용자가 특정 구간을 늦춘 경우 (#103 `transitOverrides`). **그 구간의 편만** 본다.
   *
   * 경로가 중간역에서 쪼개져 정확히 일치하는 구간이 없으면 `missed`는 비어 있다 —
   * 판정할 수 없으면 판정하지 않는다.
   */
  | { kind: "segment"; fromStationId: string; toStationId: string; notBefore: string };

export type DiffOptions = {
  unusable?: UnusableScope;
};

export type PlaceDiff = {
  /** 같은 날 그대로 유지 */
  kept: Array<{ placeId: string; date: string }>;
  /** 방문은 유지되지만 다른 날로 옮겨짐 — 지연 시나리오의 "다음 날로 밀린 일정" */
  moved: Array<{ placeId: string; fromDate: string; toDate: string }>;
  /** 새 일정에서 빠진 방문. 사유는 새 결과의 rejectedPlaces에서 찾되 없으면 undefined로 둔다 */
  dropped: Array<{ placeId: string; reason?: CandidateRejection["code"] }>;
  /** 새 일정에만 있는 방문 */
  added: Array<{ placeId: string; date: string }>;
};

export type ItineraryDiff = {
  rides: RideDiff;
  places: PlaceDiff;
  /** 하나라도 달라졌는가 — 화면이 "변경 없음"을 구분해 말할 수 있게 한다 */
  changed: boolean;
};

function ridesOf(days: readonly DayPlan[]): TrainRide[] {
  return days.flatMap((day) => day.rides);
}

/** placeId → 방문한 날짜(KST). 같은 장소가 두 번 배치되는 일은 엔진 계약상 없다 */
function visitDateByPlace(days: readonly DayPlan[]): Map<string, string> {
  const byPlace = new Map<string, string>();
  for (const day of days) {
    for (const item of day.items) {
      if (!byPlace.has(item.placeId)) byPlace.set(item.placeId, day.date);
    }
  }
  return byPlace;
}

function daysOf(result: ItineraryResult): readonly DayPlan[] {
  return result.status === "planned" ? result.days : [];
}

/**
 * 이 탑승이 주어진 경계 때문에 탈 수 없게 됐는가.
 *
 * 시각만으로 판정하지 않는다 — `segment` 범위에서는 그 구간의 편만 본다. 앞선 날짜나
 * 다른 구간의 편은 경계보다 이르더라도 재최적화로 바뀐 것이지 못 타게 된 것이 아니다.
 */
function becameUnusable(ride: TrainRide, scope: UnusableScope | undefined): boolean {
  if (scope === undefined) return false;
  if (Date.parse(ride.departAt) >= Date.parse(scope.notBefore)) return false;
  if (scope.kind === "trip_start") return true;
  return ride.fromStationId === scope.fromStationId
    && ride.toStationId === scope.toStationId;
}

/**
 * 두 일정 결과를 비교한다.
 *
 * `before`가 `empty`여도(= 이전에 세운 일정이 없어도) 동작한다 — 그 경우 모든 것이
 * `added`가 된다. 반대로 `after`가 `empty`면 모두 `dropped`이며, 이때 사유는
 * 새 결과의 `rejectedPlaces`에서 가져온다.
 */
export function diffItineraries(
  before: ItineraryResult,
  after: ItineraryResult,
  options: DiffOptions = {},
): ItineraryDiff {
  const beforeDays = daysOf(before);
  const afterDays = daysOf(after);

  const beforeRides = ridesOf(beforeDays);
  const afterRides = ridesOf(afterDays);
  const afterRideKeys = new Set(afterRides.map(rideKey));
  const beforeRideKeys = new Set(beforeRides.map(rideKey));

  const dropped = beforeRides.filter((ride) => !afterRideKeys.has(rideKey(ride)));
  const rides: RideDiff = {
    dropped,
    missed: dropped.filter((ride) => becameUnusable(ride, options.unusable)),
    added: afterRides.filter((ride) => !beforeRideKeys.has(rideKey(ride))),
    kept: beforeRides.filter((ride) => afterRideKeys.has(rideKey(ride))),
  };

  const beforeVisits = visitDateByPlace(beforeDays);
  const afterVisits = visitDateByPlace(afterDays);

  // 사유는 새 결과에만 있다 — 이전 결과의 사유를 재활용하면 옛 원인을 새 원인처럼 말하게 된다
  const reasonByPlace = new Map(
    after.rejectedPlaces.map(({ placeId, code }) => [placeId, code] as const),
  );

  const places: PlaceDiff = { kept: [], moved: [], dropped: [], added: [] };
  for (const [placeId, fromDate] of beforeVisits) {
    const toDate = afterVisits.get(placeId);
    if (toDate === undefined) {
      places.dropped.push({ placeId, reason: reasonByPlace.get(placeId) });
    } else if (toDate === fromDate) {
      places.kept.push({ placeId, date: fromDate });
    } else {
      places.moved.push({ placeId, fromDate, toDate });
    }
  }
  for (const [placeId, date] of afterVisits) {
    if (!beforeVisits.has(placeId)) places.added.push({ placeId, date });
  }

  const changed =
    rides.dropped.length > 0 ||
    rides.added.length > 0 ||
    places.moved.length > 0 ||
    places.dropped.length > 0 ||
    places.added.length > 0;

  return { rides, places, changed };
}
