import type { Repositories } from "../repositories/json";
import {
  deriveStrictSelectionMemberships,
  selectionGroupsOf,
  type SelectionGroup,
} from "../selection-candidates";
import { accessBufferMinutes, type PlaceT, type TrainLegT } from "../types/schema";
import { compareCandidates, type Candidate } from "./compare";
import { buildRegionWindows, DAY_ACTIVITY_END, DAY_ACTIVITY_START } from "./region-windows";
import type {
  ActivityWindowDetail,
  CandidateRejection,
  CandidateWarning,
  DayPlan,
  ItineraryItem,
  ItineraryResult,
  PreferredDateOutcome,
  PreferredOrderOutcome,
  RegionWindow,
  SelectionGroupSummary,
  TrainRide,
  TripConstraints,
} from "./types";

const KOREA_OFFSET_MS = 9 * 60 * 60 * 1_000;
const MINUTE_MS = 60_000;
const MAX_BEAM_SIZE = 1_000;
const MIN_TRANSFER_MINUTES = 15;

type CandidatePlace = {
  place: PlaceT;
  selectionGroups: SelectionGroup[];
};

type ScheduledVisit = {
  place: PlaceT;
  selectionGroups: SelectionGroup[];
  visitStart: number;
  visitEnd: number;
  stationReadyAt: number;
  warning: ActivityWindowDetail | null; // #43: 운영시간 판정 결과 — 배치는 유지, 경고로 전달
};

// #56 A+B 합의(B): 빔 정리·비교마다 재계산하던 파생값을 상태 전이 시 1회만 갱신한다.
// 원본(visits·rides)에서 언제든 재계산 가능해야 하며, PLANNER_VERIFY_DERIVED=1이면
// 모든 상태 전이에서 원본 재계산값과 대조한다 (수용 기준 4).
type DerivedState = {
  sortedVisitOrdinals: number[]; // 방문 장소 서수 오름차순 — id 사전순 서수라 기존 id .sort()와 동순
  sortedVisitKey: string; // sortedVisitOrdinals.join(",") — pruneStates 서명용(짧은 키)
  visitPath: string; // 방문 id join("/") — 안정 타이브레이커 앞부분
  ridePath: string; // 탑승 trainNo join("/") — 안정 타이브레이커 뒷부분
  stableKey: string; // 완성된 안정 타이브레이커 — 비교자에서 재조립하지 않도록 전이 시 확정
  dateCountsKey: string; // 날짜별 배치 수 서명 — pruneStates 서명용
  warningCount: number;
  // #139 — 선호 날짜에 배치된 방문 수. 여기에 담는 것은 '지킨 수'이고 비교 키는 '못 지킨 수'다.
  // 한 실행 안에서 총 선호 수가 상수라 (mismatch 오름차순) ≡ (honored 내림차순)이고,
  // beam 단계에서는 총량 없이 이 값만으로 최종 비교와 같은 방향을 만들 수 있다.
  preferredHonoredCount: number;
  /**
   * 지킨 순서 쌍 수 (#145). 장소 `P`를 이어 붙일 때 쌍 `(A, P)`는 **`A`가 이미 방문에 있으면
   * 지킨 것**이다. 뒤에 무엇이 오든 이 판정은 바뀌지 않으므로 증분으로 셀 수 있고, 결정적이다.
   */
  preferredOrderHonoredCount: number;
  actorGroupCovered: boolean;
  workGroupCovered: boolean;
};

type PlannerState = {
  stationId: string;
  readyAt: number;
  visits: ScheduledVisit[];
  rides: TrainLegT[];
  railMinutes: number;
  transferCount: number;
  localTravelMinutes: number;
  dateCounts: readonly number[]; // ctx.tripDates 자리별 배치 수 — 내부 표현(서명·상한 검사 전용)
  derived: DerivedState;
};

type Transition =
  | { ok: true; state: PlannerState }
  | { ok: false; reason: CandidateRejection };

// #56 NFR-PERF-001: 경로 탐색이 (상태 × 후보 × 깊이)만큼 호출되므로 스냅샷 규모(203건+)에서
// 호출마다 전체 legs 정렬·Date.parse를 반복하면 실시드 요청이 2초 계약을 깬다.
// 실행 시작 시 1회 파싱·정렬한 인덱스와 실행 단위 경로 메모를 공유한다 — 탐색 의미론은 불변.
type IndexedLeg = { leg: TrainLegT; departMs: number; arriveMs: number };

type RouteContext = {
  legs: IndexedLeg[]; // 출발 시각 오름차순, 동시각은 trainNo — 기존 per-call 정렬과 동일 순서
  cache: Map<string, TrainLegT[] | null>;
};

function buildRouteContext(trainLegs: TrainLegT[]): RouteContext {
  const legs = trainLegs
    .map((leg) => ({ leg, departMs: Date.parse(leg.departAt), arriveMs: Date.parse(leg.arriveAt) }))
    .sort((a, b) => a.departMs - b.departMs || a.leg.trainNo.localeCompare(b.leg.trainNo, "en"));
  return { legs, cache: new Map() };
}

// #56 A+B 합의(A): KST 날짜·시각 변환 메모. 프로파일 결과 비용의 45%가 같은 값의
// Date 재생성이었다. 캐시는 실행(planItinerary 호출) 단위로 생성·폐기한다 —
// 전역 가변 캐시 금지·요청 간 오염 방지 (수용 기준 5).
type PlanContext = {
  routes: RouteContext;
  /** koreaDate 메모 — KST 일 단위 버킷당 1회만 포맷한다 */
  dateOf: (epoch: number) => string;
  /** koreaDateTime 메모 — (날짜, 시각) 키 */
  timeOf: (date: string, time: string) => number;
  /** enumerateDates 메모 — (시작일, 끝일) 키. 결과는 읽기 전용으로만 순회한다 */
  datesBetween: (start: string, end: string) => readonly string[];
  /** 여행 가능 날짜(공항 준비일-마감일, KST) — dateCounts 배열의 자리 배정 */
  tripDates: readonly string[];
  dateIndex: ReadonlyMap<string, number>;
  /** 날짜별 고정 시각 메모 — 활동 시작(09:00)·종료(21:00)·자정. timeOf와 같은 값 */
  activityStartOf: (date: string) => number;
  activityEndOf: (date: string) => number;
  dayStartOf: (date: string) => number;
  /** 장소 id → 실행 단위 서수 (id 사전순) — 서명 키 축약용. 단사라 그룹핑 동등성 보존 */
  placeOrdinalOf: (placeId: string) => number;
  /** #139 — 장소 id → 선호 방문일(KST). 제외된 장소·비후보는 이미 걸러진 상태로 들어온다 */
  preferredDateOf: (placeId: string) => string | undefined;
  /** 유효한 선호 입력 수. mismatch = preferredCount - 지킨 수 (총량이 상수라 단조 관계) */
  preferredCount: number;
  /** placeId를 `나중`으로 갖는 쌍들의 `먼저` 장소 목록 (#145) */
  orderPredecessorsOf: (placeId: string) => readonly string[];
  /** 유효한 순서 선호 쌍 수. mismatch = preferredOrderCount - 지킨 수 */
  preferredOrderCount: number;
};

const DAY_MS = 24 * 60 * MINUTE_MS;

function buildPlanContext(
  trainLegs: TrainLegT[],
  places: readonly PlaceT[],
  availableAt: number,
  deadline: number,
  preferredVisitDates: ReadonlyMap<string, string>,
  preferredOrder: readonly (readonly [string, string])[],
): PlanContext {
  const predecessors = new Map<string, string[]>();
  for (const [first, second] of preferredOrder) {
    predecessors.set(second, [...(predecessors.get(second) ?? []), first]);
  }
  const dayCache = new Map<number, string>();
  const timeCache = new Map<string, number>();
  const rangeCache = new Map<string, readonly string[]>();
  const ctx: {
    -readonly [K in keyof PlanContext]: PlanContext[K];
  } = {
    routes: buildRouteContext(trainLegs),
    dateOf: (epoch) => {
      const day = Math.floor((epoch + KOREA_OFFSET_MS) / DAY_MS);
      let value = dayCache.get(day);
      if (value === undefined) {
        value = koreaDate(epoch);
        dayCache.set(day, value);
      }
      return value;
    },
    timeOf: (date, time) => {
      const key = `${date}T${time}`;
      let value = timeCache.get(key);
      if (value === undefined) {
        value = koreaDateTime(date, time);
        timeCache.set(key, value);
      }
      return value;
    },
    datesBetween: (start, end) => {
      const key = `${start}|${end}`;
      let value = rangeCache.get(key);
      if (value === undefined) {
        value = enumerateDates(ctx, start, end);
        rangeCache.set(key, value);
      }
      return value;
    },
    tripDates: [],
    dateIndex: new Map(),
    activityStartOf: (date) => ctx.timeOf(date, DAY_ACTIVITY_START),
    activityEndOf: (date) => ctx.timeOf(date, DAY_ACTIVITY_END),
    dayStartOf: (date) => ctx.timeOf(date, "00:00"),
    placeOrdinalOf: () => -1,
    preferredDateOf: (placeId) => preferredVisitDates.get(placeId),
    preferredCount: preferredVisitDates.size,
    orderPredecessorsOf: (placeId) => predecessors.get(placeId) ?? [],
    preferredOrderCount: preferredOrder.length,
  };
  const placeOrdinals = new Map(
    [...places].map(({ id }) => id).sort().map((id, ordinal) => [id, ordinal] as const),
  );
  ctx.placeOrdinalOf = (placeId) => placeOrdinals.get(placeId) ?? -1;
  const activityStartCache = new Map<string, number>();
  const activityEndCache = new Map<string, number>();
  const dayStartCache = new Map<string, number>();
  ctx.activityStartOf = (date) => {
    let value = activityStartCache.get(date);
    if (value === undefined) {
      value = koreaDateTime(date, DAY_ACTIVITY_START);
      activityStartCache.set(date, value);
    }
    return value;
  };
  ctx.activityEndOf = (date) => {
    let value = activityEndCache.get(date);
    if (value === undefined) {
      value = koreaDateTime(date, DAY_ACTIVITY_END);
      activityEndCache.set(date, value);
    }
    return value;
  };
  ctx.dayStartOf = (date) => {
    let value = dayStartCache.get(date);
    if (value === undefined) {
      value = koreaDateTime(date, "00:00");
      dayStartCache.set(date, value);
    }
    return value;
  };
  const tripDates = tripDatesOf(availableAt, deadline);
  ctx.tripDates = tripDates;
  ctx.dateIndex = new Map(tripDates.map((date, index) => [date, index]));
  return ctx;
}

function initialDerived(ctx: PlanContext): DerivedState {
  return {
    sortedVisitOrdinals: [],
    sortedVisitKey: "",
    visitPath: "",
    ridePath: "",
    stableKey: "",
    dateCountsKey: dateCountsKeyOf(ctx.tripDates.map(() => 0)),
    warningCount: 0,
    preferredHonoredCount: 0,
    preferredOrderHonoredCount: 0,
    actorGroupCovered: false,
    workGroupCovered: false,
  };
}

function stableKeyOf(visitPath: string, ridePath: string): string {
  if (visitPath === "") return ridePath;
  if (ridePath === "") return visitPath;
  return `${visitPath}/${ridePath}`;
}

function dateCountsKeyOf(dateCounts: readonly number[]): string {
  return dateCounts.join(",");
}

function appendDerived(
  ctx: PlanContext,
  parent: DerivedState,
  placeId: string,
  selectionGroups: readonly SelectionGroup[],
  warning: ActivityWindowDetail | null,
  route: TrainLegT[],
  dateCounts: readonly number[],
  honorsPreference: boolean,
  visitedPlaceIds: ReadonlySet<string>,
): DerivedState {
  const ordinal = ctx.placeOrdinalOf(placeId);
  const sortedVisitOrdinals = [...parent.sortedVisitOrdinals];
  let at = sortedVisitOrdinals.length;
  while (at > 0 && ordinal < sortedVisitOrdinals[at - 1]) at -= 1;
  sortedVisitOrdinals.splice(at, 0, ordinal);
  const routePath = route.map(({ trainNo }) => trainNo).join("/");
  const visitPath = parent.visitPath === "" ? placeId : `${parent.visitPath}/${placeId}`;
  const ridePath = routePath === "" ? parent.ridePath
    : parent.ridePath === "" ? routePath : `${parent.ridePath}/${routePath}`;
  return {
    sortedVisitOrdinals,
    sortedVisitKey: sortedVisitOrdinals.join(","),
    visitPath,
    ridePath,
    stableKey: stableKeyOf(visitPath, ridePath),
    dateCountsKey: dateCountsKeyOf(dateCounts),
    warningCount: parent.warningCount + (warning !== null ? 1 : 0),
    preferredHonoredCount: parent.preferredHonoredCount + (honorsPreference ? 1 : 0),
    preferredOrderHonoredCount: parent.preferredOrderHonoredCount
      + ctx.orderPredecessorsOf(placeId).filter((first) => visitedPlaceIds.has(first)).length,
    actorGroupCovered: parent.actorGroupCovered || selectionGroups.includes("actor"),
    workGroupCovered: parent.workGroupCovered || selectionGroups.includes("work"),
  };
}

/** 수용 기준 4: 파생 캐시를 원본(visits·rides)에서 재계산해 대조 — 검증 플래그에서만 실행 */
function recomputeDerived(state: PlannerState, ctx: PlanContext): DerivedState {
  const ids = state.visits.map(({ place }) => place.id);
  const sortedVisitOrdinals = ids.map((id) => ctx.placeOrdinalOf(id)).sort((a, b) => a - b);
  const visitPath = ids.join("/");
  const ridePath = state.rides.map(({ trainNo }) => trainNo).join("/");
  return {
    sortedVisitOrdinals,
    sortedVisitKey: sortedVisitOrdinals.join(","),
    visitPath,
    ridePath,
    stableKey: stableKeyOf(visitPath, ridePath),
    // 원본 재계산: 방문 기록의 visitStart에서 날짜별 수를 다시 센다 (배열 신뢰 안 함)
    dateCountsKey: dateCountsKeyOf(ctx.tripDates.map((date) =>
      state.visits.filter(({ visitStart }) => koreaDate(visitStart) === date).length)),
    warningCount: state.visits.filter(({ warning }) => warning !== null).length,
    // 원본 재계산: 방문 기록의 visitStart 날짜와 선호 입력을 직접 대조한다 (증분 값 신뢰 안 함)
    preferredHonoredCount: state.visits.filter(({ place, visitStart }) =>
      ctx.preferredDateOf(place.id) === koreaDate(visitStart)).length,
    // 원본 재계산: 방문 순서에서 쌍을 다시 센다
    preferredOrderHonoredCount: state.visits.reduce((total, { place }, index) => {
      const earlier = new Set(state.visits.slice(0, index).map((v) => v.place.id));
      return total + ctx.orderPredecessorsOf(place.id).filter((f) => earlier.has(f)).length;
    }, 0),
    actorGroupCovered: state.visits.some(({ selectionGroups }) => selectionGroups.includes("actor")),
    workGroupCovered: state.visits.some(({ selectionGroups }) => selectionGroups.includes("work")),
  };
}

function assertDerivedIntegrity(states: PlannerState[], ctx: PlanContext): void {
  for (const state of states) {
    const expected = recomputeDerived(state, ctx);
    const actual = state.derived;
    if (actual.sortedVisitKey !== expected.sortedVisitKey
      || actual.visitPath !== expected.visitPath
      || actual.ridePath !== expected.ridePath
      || actual.stableKey !== expected.stableKey
      || actual.dateCountsKey !== expected.dateCountsKey
      || actual.warningCount !== expected.warningCount
      || actual.preferredHonoredCount !== expected.preferredHonoredCount
      || actual.preferredOrderHonoredCount !== expected.preferredOrderHonoredCount
      || actual.actorGroupCovered !== expected.actorGroupCovered
      || actual.workGroupCovered !== expected.workGroupCovered) {
      throw new Error(
        `[검증] 파생 캐시 불일치: ${JSON.stringify({ actual, expected })}`,
      );
    }
  }
}

/** legs에서 departMs >= notBefore인 첫 위치 — 기존의 "departAt < notBefore면 skip"과 동치 */
function firstDepartureIndex(legs: IndexedLeg[], notBefore: number): number {
  let low = 0;
  let high = legs.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (legs[mid].departMs < notBefore) low = mid + 1;
    else high = mid;
  }
  return low;
}

type CompleteSchedule = Candidate & {
  state: PlannerState;
  returnRides: TrainLegT[];
  returnedAt: number;
};

export function planItinerary(
  constraints: TripConstraints,
  repos: Repositories,
): ItineraryResult {
  const actorIds = new Set([
    ...(constraints.selectedActorIds ?? []),
    ...(constraints.selectedActorId ? [constraints.selectedActorId] : []),
  ]);
  const selectedWorkIds = new Set(constraints.selectedWorkIds);
  const excludedPlaceIds = new Set(constraints.excludedPlaceIds);

  assertReferences(constraints, repos, actorIds);

  const rejectedPlaces: CandidateRejection[] = [];
  const memberships = deriveStrictSelectionMemberships(
    repos.workPlaceRelations,
    actorIds,
    selectedWorkIds,
  );
  const allCandidates: CandidatePlace[] = [];
  const candidates: CandidatePlace[] = [];
  for (const place of [...repos.places].sort((a, b) => a.id.localeCompare(b.id, "en"))) {
    const membership = memberships.get(place.id);
    if (!membership) continue;
    // #43 결정 1: 운영시간 미확인은 후보 제외 사유가 아니다 — 배치 시 경고로 전달한다
    const candidate = { place, selectionGroups: selectionGroupsOf(membership) };
    allCandidates.push(candidate);
    if (!excludedPlaceIds.has(place.id)) candidates.push(candidate);
  }

  const gatewayStationId = constraints.gatewayStationId ?? findGatewayStationId(repos);
  const endpointStationId = constraints.airportStationId
    ?? findAirportStationId(repos)
    ?? gatewayStationId;
  const availableAt = Date.parse(constraints.airportReadyAt);
  const departureAt = Date.parse(constraints.departureAt);
  const deadline = Date.parse(constraints.airportArrivalDeadline);
  const preferredVisitDates = preferredDateIndex(constraints, candidates, excludedPlaceIds);
  const preferredOrder = preferredOrderIndex(constraints, candidates, excludedPlaceIds);
  const ctx = buildPlanContext(
    repos.trainLegs, repos.places, availableAt, deadline, preferredVisitDates,
    preferredOrder,
  );
  assertPreferredDatesInRange(preferredVisitDates, ctx);
  const initial: PlannerState = {
    stationId: endpointStationId,
    readyAt: availableAt,
    visits: [],
    rides: [],
    railMinutes: 0,
    transferCount: 0,
    localTravelMinutes: 0,
    dateCounts: ctx.tripDates.map(() => 0),
    derived: initialDerived(ctx),
  };

  let frontier = [initial];
  const complete: CompleteSchedule[] = [];

  for (let depth = 0; depth < candidates.length; depth += 1) {
    const next: PlannerState[] = [];
    for (const state of frontier) {
      const visitedIds = new Set(state.visits.map(({ place }) => place.id));
      for (const candidate of candidates) {
        if (visitedIds.has(candidate.place.id)) continue;
        const transition = appendVisit(
          state,
          candidate,
          constraints,
          ctx,
          deadline,
        );
        if (transition.ok) next.push(transition.state);

        // #139 6-1: 기본 정책은 가장 이른 가능 날짜에서 멈춘다. 선호 날짜 후보를 따로
        // 만들지 않으면 비교할 상태 자체가 없다. 추가 전이는 선호가 지정된 장소에서만 생긴다.
        const preferredDate = ctx.preferredDateOf(candidate.place.id);
        if (preferredDate === undefined) continue;
        // 기본 전이가 이미 선호 날짜에 놓였으면 같은 상태다 — 중복 생성하지 않는다
        if (transition.ok
          && ctx.dateOf(transition.state.visits[transition.state.visits.length - 1].visitStart)
            === preferredDate) continue;
        const preferredTransition = appendVisit(
          state,
          candidate,
          constraints,
          ctx,
          deadline,
          preferredDate,
        );
        if (preferredTransition.ok) next.push(preferredTransition.state);
      }
    }

    if (next.length === 0) break;
    frontier = pruneStates(next, ctx);

    for (const state of frontier) {
      const schedule = completeSchedule(
        state,
        endpointStationId,
        constraints,
        ctx,
        departureAt,
        deadline,
      );
      if (schedule) {
        complete.push(schedule);
      }
    }
  }

  if (complete.length === 0) {
    for (const candidate of candidates) {
      const reason = completionFailure(
        initial,
        candidate,
        constraints,
        ctx,
        endpointStationId,
      );
      if (reason) rejectedPlaces.push(reason);
    }
    return {
      status: "empty",
      days: [],
      rejectedPlaces: uniqueReasons(rejectedPlaces),
      warnings: [],
      selectionGroups: selectionGroupSummary(
        actorIds,
        selectedWorkIds,
        allCandidates,
        candidates,
        [],
        uniqueReasons(rejectedPlaces),
      ),
    };
  }

  complete.sort(compareCandidates);
  const best = complete[0];
  const visitedIds = new Set(best.state.visits.map(({ place }) => place.id));
  for (const candidate of candidates) {
    if (visitedIds.has(candidate.place.id)) continue;
    const reason = completionFailure(
      best.state,
      candidate,
      constraints,
      ctx,
      endpointStationId,
    );
    if (reason) rejectedPlaces.push(reason);
  }

  const allRides = [...best.state.rides, ...best.returnRides];
  const totalRailMinutes = best.state.railMinutes + routeMinutes(best.returnRides);
  const totalTransferCount = best.state.transferCount + transferCount(best.returnRides);
  // #33 — 역·권역 체류 창은 엔진이 확정 계산하고 UI는 포맷만 한다
  const regionWindows = buildRegionWindows({
    rides: allRides,
    airportReadyAt: constraints.airportReadyAt,
    airportArrivalDeadline: constraints.airportArrivalDeadline,
    startStationId: endpointStationId,
    stations: repos.stations,
  });
  // #43 수용 기준: 운영시간 밖·미확인 배치의 경고 누락 0건 — 방문 기록에서 직접 파생한다
  const warnings: CandidateWarning[] = best.state.visits
    .filter(({ warning }) => warning !== null)
    .map(({ place, warning }) => ({
      code: "ACTIVITY_WINDOW_MISMATCH",
      placeId: place.id,
      detail: warning as ActivityWindowDetail,
    }));
  return {
    status: "planned",
    days: buildDays(ctx, best.state.visits, allRides, regionWindows),
    rejectedPlaces: uniqueReasons(rejectedPlaces),
    warnings,
    selectionGroups: selectionGroupSummary(
      actorIds,
      selectedWorkIds,
      allCandidates,
      candidates,
      best.state.visits,
      uniqueReasons(rejectedPlaces),
    ),
    comparisonKeys: best.keys,
    ...(preferredVisitDates.size > 0
      ? {
        preferredDateOutcomes: preferredDateOutcomesOf(
          preferredVisitDates, best.state.visits, ctx,
        ),
      }
      : {}),
    ...(preferredOrder.length > 0
      ? { preferredOrderOutcomes: preferredOrderOutcomesOf(preferredOrder, best.state.visits) }
      : {}),
    metrics: {
      totalTravelMinutes:
        totalRailMinutes + best.state.localTravelMinutes,
      totalRailMinutes,
      transferCount: totalTransferCount,
      departureSlackMinutes: minutesBetween(best.returnedAt, departureAt),
    },
  };
}

/**
 * 배치 실패 원인 가르기 (#84 P0-1)
 *
 * `dateAvailable`(하루 장소 수 상한)이 `findVisitWindow` 인자로 들어가 있어, 창을 못 찾은
 * 결과만으로는 "상한이 날짜를 막았다"와 "여행 마감이 부족하다"를 구분할 수 없다.
 * 상한을 뺀 조건으로 한 번만 다시 조회해, 그때는 찾아지면 원인이 상한이다.
 *
 * 실패 경로에서만 호출된다 — 정상 배치에는 추가 비용이 없다.
 */
function rejectionCause(
  ctx: PlanContext,
  place: PlaceT,
  stationArrival: number,
  deadline: number,
): "DAILY_CAPACITY_EXCEEDED" | "DEPARTURE_DEADLINE_EXCEEDED" {
  const withoutDailyCap = findVisitWindow(
    ctx,
    place,
    stationArrival,
    true,
    deadline,
    () => true,
    "ignore-hours",
  );
  return withoutDailyCap ? "DAILY_CAPACITY_EXCEEDED" : "DEPARTURE_DEADLINE_EXCEEDED";
}

/**
 * 한 장소를 상태에 이어 붙인다.
 *
 * `onlyDate`를 주면 그 날짜의 창만 시도한다 (#139 6-1). 선호가 지정된 장소에 한해
 * 기본 전이와 선호 날짜 전이를 각각 만들기 위한 것으로, 배치 조건은 완화하지 않는다.
 */
function appendVisit(
  state: PlannerState,
  candidate: CandidatePlace,
  constraints: TripConstraints,
  ctx: PlanContext,
  deadline: number,
  onlyDate?: string,
): Transition {
  const place = candidate.place;
  const route = findEarliestRoute(
    ctx.routes,
    state.stationId,
    place.nearestStationId,
    state.readyAt,
    deadline,
  );
  if (!route) {
    return { ok: false, reason: { code: "TRAIN_UNAVAILABLE", placeId: place.id } };
  }

  const stationArrival = route.length > 0
    ? Date.parse(route[route.length - 1].arriveAt)
    : state.readyAt;
  const dateAvailable = (date: string) => {
    const index = ctx.dateIndex.get(date);
    return index !== undefined && (state.dateCounts[index] ?? 0) < constraints.maxPlacesPerDay;
  };

  // #43 결정 1: 검증 운영시간 안 배치를 먼저 시도하고, 불가능하면 판정식(#5) 결과를
  // 경고로 강등해 배치는 유지한다 — 하드 제약은 열차·출국 마감뿐
  let window = place.openingHours.type === "unverified"
    ? null
    : findVisitWindow(ctx, place, stationArrival, true, deadline, dateAvailable, "verified", onlyDate);
  let warning: ActivityWindowDetail | null = null;
  if (!window) {
    warning = activityWarningDetail(ctx, place, stationArrival, deadline, dateAvailable, onlyDate);
    window = findVisitWindow(
      ctx, place, stationArrival, true, deadline, dateAvailable, "ignore-hours", onlyDate,
    );
    if (!window) {
      // 선호 날짜 전이는 '그 날짜에 못 넣는다'가 전부다 — 사유는 기본 전이가 이미 말한다.
      // 여기서 rejectionCause를 또 돌리면 선호 장소마다 상태 × 후보만큼 헛도는 조회가 붙는다.
      // 어느 쪽이든 이 reason은 탐색 루프에서 버려지고 rejectedPlaces는 completionFailure가 만든다.
      if (onlyDate !== undefined) {
        return { ok: false, reason: { code: "DAILY_CAPACITY_EXCEEDED", placeId: place.id } };
      }
      // 남은 기간 안에 배치 자체가 불가능 — 운영시간 사유가 아니다 (#43).
      // 다만 원인이 두 가지다: 하루 장소 수 상한이 날짜를 막았거나, 여행 마감 자체가 부족하거나.
      // dateAvailable이 findVisitWindow 안으로 들어가 있어 여기서는 구분되지 않으므로,
      // 상한을 뺀 조건으로 한 번만 다시 조회해 원인을 가른다 (#84 P0-1).
      // 실패 경로에서만 도는 추가 조회라 정상 경로 비용은 그대로다.
      return {
        ok: false,
        reason: { code: rejectionCause(ctx, place, stationArrival, deadline), placeId: place.id },
      };
    }
  }

  const date = ctx.dateOf(window.visitStart);
  const dateIndex = ctx.dateIndex.get(date);
  if (dateIndex === undefined
    || (state.dateCounts[dateIndex] ?? 0) >= constraints.maxPlacesPerDay) {
    // 찾은 창의 날짜가 이미 하루 상한을 채웠다 — 원인이 상한임이 확정된 분기 (#84 P0-1)
    return {
      ok: false,
      reason: { code: "DAILY_CAPACITY_EXCEEDED", placeId: place.id },
    };
  }

  const dateCounts = [...state.dateCounts];
  dateCounts[dateIndex] += 1;
  const localRoundTrip = 2 * window.accessAndBufferMinutes;
  return {
    ok: true,
    state: {
      stationId: place.nearestStationId,
      readyAt: window.stationReadyAt,
      visits: [...state.visits, {
        place,
        selectionGroups: candidate.selectionGroups,
        visitStart: window.visitStart,
        visitEnd: window.visitEnd,
        stationReadyAt: window.stationReadyAt,
        warning,
      }],
      rides: [...state.rides, ...route],
      railMinutes: state.railMinutes + routeMinutes(route),
      transferCount: state.transferCount + transferCount(route),
      localTravelMinutes: state.localTravelMinutes + localRoundTrip,
      dateCounts,
      derived: appendDerived(
        ctx,
        state.derived,
        place.id,
        candidate.selectionGroups,
        warning,
        route,
        dateCounts,
        // 선호를 지켰는지는 요청한 날짜와 실제 배치 날짜만으로 판정한다 —
        // onlyDate 전이가 아니어도 기본 배치가 우연히 선호 날짜면 지킨 것이다 (#139 6-1 중복 제거)
        ctx.preferredDateOf(place.id) === date,
        new Set(state.visits.map((visit) => visit.place.id)),
      ),
    },
  };
}

function findVisitWindow(
  ctx: PlanContext,
  place: PlaceT,
  stationArrival: number,
  includeBuffer: boolean,
  deadline: number,
  dateAvailable: (date: string) => boolean,
  mode: "verified" | "ignore-hours",
  // #139 6-1: 지정하면 그 날짜의 창만 본다. 기본 정책(가장 이른 날)과 별개의 전이를 만들기
  // 위한 것으로, 조건 자체는 완화하지 않는다 — 그 날짜가 불가능하면 그대로 null이다.
  onlyDate?: string,
): { visitStart: number; visitEnd: number; stationReadyAt: number; accessAndBufferMinutes: number } | null {
  const buffer = includeBuffer ? accessBufferMinutes(place.accessEstimate.minutes) : 0;
  const accessAndBufferMinutes = place.accessEstimate.minutes + buffer;
  const earliestPlaceArrival = stationArrival + accessAndBufferMinutes * MINUTE_MS;
  const startDate = ctx.dateOf(earliestPlaceArrival);
  // 시작일은 항상 여행 날짜 범위 안(도착 이후)이고, 범위 밖(마감 이후)이면 후보 날짜가 없다
  const startIndex = ctx.dateIndex.get(startDate);
  const scanned = startIndex === undefined ? [] : ctx.tripDates.slice(startIndex);
  const dates = onlyDate === undefined
    ? scanned
    : scanned.filter((date) => date === onlyDate); // 이미 지난 날짜면 빈 목록

  for (const date of dates) {
    if (!dateAvailable(date)) continue;
    if (mode === "verified" && isClosedDay(ctx, place, date)) continue;
    // PR #45 리뷰: 출력 창(regionWindows)과 배치가 어긋나지 않도록 같은 활동 경계를 적용한다
    // — 역 출발 가능 시각 >= 09:00 (장소 도착 하한 = 09:00 + 접근·보수 버퍼),
    //   장소 방문 + 역 복귀 완료 <= min(출국 마감, 해당 날짜 21:00). hours·상시 개방·경고 폴백 공통.
    const activityDeadline = Math.min(deadline, ctx.activityEndOf(date));
    let visitStart = Math.max(
      earliestPlaceArrival,
      ctx.activityStartOf(date) + accessAndBufferMinutes * MINUTE_MS,
    );
    if (mode === "verified" && place.openingHours.type === "hours") {
      const open = ctx.timeOf(date, place.openingHours.open);
      const close = ctx.timeOf(date, place.openingHours.close);
      visitStart = Math.max(visitStart, open);
      if (place.openingHours.lastEntry
        && visitStart > ctx.timeOf(date, place.openingHours.lastEntry)) continue;
      const visitEnd = visitStart + place.stayMinutes * MINUTE_MS;
      const stationReadyAt = visitEnd + accessAndBufferMinutes * MINUTE_MS;
      if (visitEnd <= close && stationReadyAt <= activityDeadline) {
        return { visitStart, visitEnd, stationReadyAt, accessAndBufferMinutes };
      }
      continue;
    }

    const visitEnd = visitStart + place.stayMinutes * MINUTE_MS;
    const stationReadyAt = visitEnd + accessAndBufferMinutes * MINUTE_MS;
    if (ctx.dateOf(visitStart) === date && stationReadyAt <= activityDeadline) {
      return { visitStart, visitEnd, stationReadyAt, accessAndBufferMinutes };
    }
  }
  return null;
}

/** #5 판정식 유지 — 결과만 제외 대신 경고 상세로 쓴다 (#43 결정 1) */
function activityWarningDetail(
  ctx: PlanContext,
  place: PlaceT,
  stationArrival: number,
  deadline: number,
  dateAvailable: (date: string) => boolean,
  onlyDate?: string, // #139 — 선호 날짜 전이의 경고는 그 날짜 기준으로 판정한다
): ActivityWindowDetail {
  if (place.openingHours.type === "unverified") return "UNVERIFIED_HOURS";
  return findVisitWindow(
    ctx, place, stationArrival, false, deadline, dateAvailable, "verified", onlyDate,
  )
    ? "CONSERVATIVE_BUFFER_MISMATCH"
    : "OUTSIDE_VERIFIED_HOURS";
}

function completeSchedule(
  state: PlannerState,
  endpointStationId: string,
  constraints: TripConstraints,
  ctx: PlanContext,
  departureAt: number,
  deadline: number,
): CompleteSchedule | null {
  const returnRides = findEarliestRoute(
    ctx.routes,
    state.stationId,
    endpointStationId,
    state.readyAt,
    deadline,
  );
  if (!returnRides) return null;
  const returnedAt = returnRides.length > 0
    ? Date.parse(returnRides[returnRides.length - 1].arriveAt)
    : state.readyAt;
  if (returnedAt > deadline) return null;

  const selectionGroupCoverageCount = Number(state.derived.actorGroupCovered)
    + Number(state.derived.workGroupCovered);
  const totalRailMinutes = state.railMinutes + routeMinutes(returnRides);
  const totalTransfers = state.transferCount + transferCount(returnRides);
  const departureSlackMinutes = minutesBetween(returnedAt, departureAt);
  return {
    state,
    returnRides,
    returnedAt,
    keys: {
      selectionGroupCoverageCount,
      selectedUnionPlaceCount: state.visits.length,
      activityWarningCount: activityWarningCountOf(state), // #43 결정 3 — 방문 수와 이동시간 사이
      // #139: 일정에 못 들어간 선호도 불일치 1로 센다 — 총 선호 수에서 지킨 수를 뺀다
      preferredDateMismatchCount: ctx.preferredCount - state.derived.preferredHonoredCount,
      preferredOrderMismatchCount:
        ctx.preferredOrderCount - state.derived.preferredOrderHonoredCount,
      totalTravelMinutes: totalRailMinutes + state.localTravelMinutes,
      transferCount: totalTransfers,
      slackSatisfied: hasDailySlack(
        ctx,
        state,
        returnRides,
        constraints,
        Date.parse(constraints.airportReadyAt),
        deadline,
      ),
    },
    departureSlackMinutes,
    stableId: stableKeyOf(state.derived.stableKey, returnRides.map(({ trainNo }) => trainNo).join("/")),
  };
}

function hasDailySlack(
  ctx: PlanContext,
  state: PlannerState,
  returnRides: TrainLegT[],
  constraints: TripConstraints,
  tripStart: number,
  tripEnd: number,
): boolean {
  const intervals: Array<{ start: number; end: number }> = [
    ...[...state.rides, ...returnRides].map((ride) => ({
      start: Date.parse(ride.departAt),
      end: Date.parse(ride.arriveAt),
    })),
    ...state.visits.map((visit) => {
      const returnAccessMs = visit.stationReadyAt - visit.visitEnd;
      return {
        start: visit.visitStart - returnAccessMs,
        end: visit.stationReadyAt,
      };
    }),
  ];
  const activeDates = new Set<string>();
  for (const interval of intervals) {
    let cursor = ctx.dayStartOf(ctx.dateOf(interval.start));
    while (cursor < interval.end) {
      activeDates.add(ctx.dateOf(cursor));
      cursor += 24 * 60 * MINUTE_MS;
    }
  }

  return [...activeDates].every((date) => {
    const dayStart = ctx.dayStartOf(date);
    const dayEnd = dayStart + 24 * 60 * MINUTE_MS;
    const windowStart = Math.max(dayStart, tripStart);
    const windowEnd = Math.min(dayEnd, tripEnd);
    if (windowEnd <= windowStart) return false;

    const merged: Array<{ start: number; end: number }> = [];
    for (const interval of intervals
      .map(({ start, end }) => ({
        start: Math.max(start, windowStart),
        end: Math.min(end, windowEnd),
      }))
      .filter(({ start, end }) => end > start)
      .sort((a, b) => a.start - b.start || a.end - b.end)) {
      const previous = merged.at(-1);
      if (!previous || interval.start > previous.end) {
        merged.push({ ...interval });
      } else {
        previous.end = Math.max(previous.end, interval.end);
      }
    }
    const busyMinutes = merged.reduce(
      (total, interval) => total + minutesBetween(interval.start, interval.end),
      0,
    );
    const availableMinutes = minutesBetween(windowStart, windowEnd);
    return availableMinutes - busyMinutes >= constraints.dailySlackMinutes;
  });
}

function findEarliestRoute(
  routes: RouteContext,
  fromStationId: string,
  toStationId: string,
  notBefore: number,
  deadline: number,
): TrainLegT[] | null {
  if (fromStationId === toStationId) return [];
  const cacheKey = `${fromStationId}|${toStationId}|${notBefore}|${deadline}`;
  const cached = routes.cache.get(cacheKey);
  if (cached !== undefined) return cached;

  const arrivals = new Map<string, { at: number; path: TrainLegT[] }>();
  arrivals.set(fromStationId, { at: notBefore, path: [] });
  for (let index = firstDepartureIndex(routes.legs, notBefore); index < routes.legs.length; index += 1) {
    const { leg, departMs, arriveMs } = routes.legs[index];
    if (arriveMs > deadline || arriveMs < departMs) continue;
    const origin = arrivals.get(leg.fromStationId);
    if (!origin) continue;
    const previous = origin.path.at(-1);
    const minimumConnection = previous && previous.trainNo !== leg.trainNo
      ? MIN_TRANSFER_MINUTES * MINUTE_MS
      : 0;
    if (origin.at + minimumConnection > departMs) continue;
    const current = arrivals.get(leg.toStationId);
    const path = [...origin.path, leg];
    if (!current || arriveMs < current.at
      || (arriveMs === current.at && compareRoutePaths(path, current.path) < 0)) {
      arrivals.set(leg.toStationId, { at: arriveMs, path });
    }
  }
  const result = arrivals.get(toStationId)?.path ?? null;
  routes.cache.set(cacheKey, result);
  return result;
}

/**
 * 선호 입력을 실제로 쓸 수 있는 형태로 좁힌다 (#139 7절).
 *
 * - 제외한 장소의 선호는 버린다 — **제외가 선호보다 우선**이다
 * - 현재 엄격 후보가 아닌 장소 ID는 거부한다(RangeError)
 *
 * 제외로 버려진 선호는 mismatch에도 결과 목록에도 넣지 않는다. 사용자가 스스로 뺀 장소를
 * "요청을 못 지켰다"고 되돌려 주면 안 된다.
 */
function preferredDateIndex(
  constraints: TripConstraints,
  candidates: readonly CandidatePlace[],
  excludedPlaceIds: ReadonlySet<string>,
): ReadonlyMap<string, string> {
  const entries = Object.entries(constraints.preferredVisitDates ?? {});
  if (entries.length === 0) return new Map();
  const candidateIds = new Set(candidates.map(({ place }) => place.id));
  const index = new Map<string, string>();
  for (const [placeId, date] of entries.sort(([a], [b]) => a.localeCompare(b, "en"))) {
    if (excludedPlaceIds.has(placeId)) continue;
    if (!candidateIds.has(placeId)) {
      throw new RangeError(`preferred visit date for a non-candidate place: ${placeId}`);
    }
    index.set(placeId, date);
  }
  return index;
}

/**
 * 공개 Action 경계용 사전 검사 (PR #30 리뷰 ③과 같은 이유).
 *
 * 엔진은 내부 호출의 빠른 실패(RangeError)를 유지하고, 공개 Action은 이 함수로 필드 오류를
 * 만든다. 판정 기준은 엔진과 같은 코드다 — 후보 집합은 `deriveStrictSelectionMemberships`,
 * 날짜 집합은 `tripDatesOf`로 한 군데서만 나온다.
 */
/**
 * 순서 선호의 공개 Action 경계 검사 (#145 · PR #153 리뷰 2번).
 *
 * `preferredOrderIndex`는 비후보 ID에 `RangeError`를 던진다. 그건 내부 호출의 빠른 실패로
 * 두고, 공개 Action은 여기서 필드 오류로 정규화한다 — 판정 기준은 방문일과 같은 코드
 * (`deriveStrictSelectionMemberships`)를 쓴다.
 */
export function preferredOrderErrors(
  constraints: TripConstraints,
  repos: Repositories,
): Record<string, string> {
  const pairs = constraints.preferredOrder ?? [];
  if (pairs.length === 0) return {};
  const actorIds = new Set([
    ...(constraints.selectedActorIds ?? []),
    ...(constraints.selectedActorId ? [constraints.selectedActorId] : []),
  ]);
  const memberships = deriveStrictSelectionMemberships(
    repos.workPlaceRelations,
    actorIds,
    new Set(constraints.selectedWorkIds),
  );
  const knownPlaceIds = new Set(repos.places.map(({ id }) => id));
  const excluded = new Set(constraints.excludedPlaceIds);

  for (const [first, second] of pairs) {
    for (const placeId of [first, second]) {
      if (excluded.has(placeId)) continue; // 제외가 선호보다 우선 — 오류가 아니라 무시다
      if (!knownPlaceIds.has(placeId)) {
        return { preferredOrder: `unknown place id: ${placeId}` };
      }
      if (!memberships.has(placeId)) {
        return { preferredOrder: `not a candidate place id: ${placeId}` };
      }
    }
  }
  return {};
}

export function preferredVisitDateErrors(
  constraints: TripConstraints,
  repos: Repositories,
): Record<string, string> {
  const entries = Object.entries(constraints.preferredVisitDates ?? {})
    .sort(([a], [b]) => a.localeCompare(b, "en"));
  if (entries.length === 0) return {};
  const actorIds = new Set([
    ...(constraints.selectedActorIds ?? []),
    ...(constraints.selectedActorId ? [constraints.selectedActorId] : []),
  ]);
  const memberships = deriveStrictSelectionMemberships(
    repos.workPlaceRelations,
    actorIds,
    new Set(constraints.selectedWorkIds),
  );
  const knownPlaceIds = new Set(repos.places.map(({ id }) => id));
  const excluded = new Set(constraints.excludedPlaceIds);
  const tripDates = new Set(tripDatesOf(
    Date.parse(constraints.airportReadyAt),
    Date.parse(constraints.airportArrivalDeadline),
  ));
  for (const [placeId, date] of entries) {
    if (excluded.has(placeId)) continue; // 제외가 선호보다 우선 — 오류가 아니라 무시다
    if (!knownPlaceIds.has(placeId) || !memberships.has(placeId)) {
      return { preferredVisitDates: `not a candidate place id: ${placeId}` };
    }
    if (!tripDates.has(date)) {
      return { preferredVisitDates: `date out of trip range: ${placeId} ${date}` };
    }
  }
  return {};
}

/** 여행 기간 밖 날짜는 거부한다 (#139 7절) — tripDates가 정해진 뒤에만 판정할 수 있다 */
function assertPreferredDatesInRange(
  preferredVisitDates: ReadonlyMap<string, string>,
  ctx: PlanContext,
): void {
  for (const [placeId, date] of preferredVisitDates) {
    if (!ctx.dateIndex.has(date)) {
      throw new RangeError(`preferred visit date out of trip range: ${placeId} ${date}`);
    }
  }
}

/**
 * 선호 하나하나의 반영 결과 (#139 4절). 실패 분기를 만들지 않고 이 목록으로만 알린다.
 * 요청한 placeId 사전순 — preferredDateIndex가 이미 정렬해 담는다.
 */
function preferredDateOutcomesOf(
  preferredVisitDates: ReadonlyMap<string, string>,
  visits: readonly ScheduledVisit[],
  ctx: PlanContext,
): PreferredDateOutcome[] {
  const scheduledDates = new Map(
    visits.map(({ place, visitStart }) => [place.id, ctx.dateOf(visitStart)] as const),
  );
  return [...preferredVisitDates].map(([placeId, requestedDate]) => {
    const scheduledDate = scheduledDates.get(placeId);
    if (scheduledDate === undefined) return { placeId, requestedDate, outcome: "unplaced" as const };
    return scheduledDate === requestedDate
      ? { placeId, requestedDate, outcome: "honored" as const }
      : { placeId, requestedDate, outcome: "adjusted" as const, scheduledDate };
  });
}

/**
 * 순서 선호를 실제로 쓸 수 있는 형태로 좁힌다 (#145 · #139 7절과 같은 규칙).
 *
 * - 두 장소 중 하나라도 제외됐으면 그 쌍을 버린다 — **제외가 선호보다 우선**이다
 * - 현재 엄격 후보가 아닌 장소 ID는 거부한다(RangeError)
 * - `[먼저, 나중]` 사전순으로 담아 같은 입력이 같은 순서가 되게 한다
 *
 * 제외로 버려진 쌍은 mismatch에도 결과 목록에도 넣지 않는다. 사용자가 스스로 뺀 장소를
 * "요청을 못 지켰다"고 되돌려 주면 안 된다.
 */
function preferredOrderIndex(
  constraints: TripConstraints,
  candidates: readonly CandidatePlace[],
  excludedPlaceIds: ReadonlySet<string>,
): readonly (readonly [string, string])[] {
  const pairs = constraints.preferredOrder ?? [];
  if (pairs.length === 0) return [];
  const candidateIds = new Set(candidates.map(({ place }) => place.id));
  const kept: (readonly [string, string])[] = [];
  for (const [first, second] of pairs) {
    for (const placeId of [first, second]) {
      if (excludedPlaceIds.has(placeId)) continue;
      if (!candidateIds.has(placeId)) {
        throw new RangeError(`preferred order for a non-candidate place: ${placeId}`);
      }
    }
    if (excludedPlaceIds.has(first) || excludedPlaceIds.has(second)) continue;
    kept.push([first, second] as const);
  }
  return kept.sort((a, b) => a[0].localeCompare(b[0], "en") || a[1].localeCompare(b[1], "en"));
}

/**
 * 순서 선호 하나하나의 반영 결과 (#145). 방문일과 같은 세 갈래이고, 실패 분기를 만들지 않는다.
 *
 * 판정은 **전체 방문 순서**의 자리 비교다. 둘 다 배치됐고 `먼저`가 앞이면 `honored`,
 * 배치는 됐는데 뒤집혔으면 `adjusted`, 하나라도 못 들어갔으면 `unplaced`.
 */
function preferredOrderOutcomesOf(
  preferredOrder: readonly (readonly [string, string])[],
  visits: readonly ScheduledVisit[],
): PreferredOrderOutcome[] {
  const positionOf = new Map(visits.map(({ place }, index) => [place.id, index] as const));
  return preferredOrder.map(([firstPlaceId, secondPlaceId]) => {
    const first = positionOf.get(firstPlaceId);
    const second = positionOf.get(secondPlaceId);
    if (first === undefined || second === undefined) {
      return { firstPlaceId, secondPlaceId, outcome: "unplaced" as const };
    }
    return first < second
      ? { firstPlaceId, secondPlaceId, outcome: "honored" as const }
      : { firstPlaceId, secondPlaceId, outcome: "adjusted" as const };
  });
}

function assertReferences(
  constraints: TripConstraints,
  repos: Repositories,
  actorIds: Set<string>,
): void {
  const knownActors = new Set(repos.actors.map(({ id }) => id));
  const knownWorks = new Set(repos.works.map(({ id }) => id));
  const knownPlaces = new Set(repos.places.map(({ id }) => id));
  for (const actorId of actorIds) {
    if (!knownActors.has(actorId)) throw new RangeError(`unknown actor: ${actorId}`);
  }
  for (const workId of constraints.selectedWorkIds) {
    if (!knownWorks.has(workId)) throw new RangeError(`unknown work: ${workId}`);
  }
  for (const placeId of constraints.excludedPlaceIds) {
    if (!knownPlaces.has(placeId)) throw new RangeError(`unknown place: ${placeId}`);
  }
  if (constraints.gatewayStationId
    && !repos.stations.some(({ id }) => id === constraints.gatewayStationId)) {
    throw new RangeError(`unknown gateway station: ${constraints.gatewayStationId}`);
  }
  if (constraints.airportStationId
    && !repos.stations.some(({ id }) => id === constraints.airportStationId)) {
    throw new RangeError(`unknown airport station: ${constraints.airportStationId}`);
  }
}

function compareRoutePaths(a: TrainLegT[], b: TrainLegT[]): number {
  return transferCount(a) - transferCount(b)
    // 구간 수가 적은 쪽 먼저 (#72 용산 경유). 스냅샷에 중간역 구간이 생기면 같은 열차의
    // 한 번 탑승이 두 leg로도 표현된다(전주→용산→서울 00508). 이때 routeMinutes는 leg
    // 소요시간의 합이라 중간역 정차 대기가 빠져 쪼갠 쪽이 더 짧아 보이고, 화면에는
    // 내렸다 다시 타는 것처럼 나온다. 도착 시각이 같으면 한 번에 가는 쪽이 맞다.
    || a.length - b.length
    || routeMinutes(a) - routeMinutes(b)
    || a.map(({ trainNo }) => trainNo).join("/")
      .localeCompare(b.map(({ trainNo }) => trainNo).join("/"), "en");
}

function findGatewayStationId(repos: Repositories): string {
  const gateway = repos.stations
    .filter(({ isGateway }) => isGateway)
    .sort((a, b) => (a.gatewayPriority ?? Number.MAX_SAFE_INTEGER)
      - (b.gatewayPriority ?? Number.MAX_SAFE_INTEGER)
      || a.id.localeCompare(b.id, "en"))[0]?.id;
  if (!gateway) throw new RangeError("a gateway station could not be inferred");
  return gateway;
}

function findAirportStationId(repos: Repositories): string | undefined {
  return repos.stations
    .filter(({ isAirport }) => isAirport)
    .sort((a, b) => a.id.localeCompare(b.id, "en"))[0]?.id;
}

function pruneStates(states: PlannerState[], ctx: PlanContext): PlannerState[] {
  if (process.env.PLANNER_VERIFY_DERIVED === "1") {
    assertDerivedIntegrity(states, ctx); // 모든 전이가 pruneStates 입력을 지난다 (수용 기준 4)
  }
  // #139 6-2: 서명에는 날짜도 선호 일치 여부도 넣지 않는다. 장소별 날짜를 담으면 병합이
  // 거의 사라져 상태 수가 폭증한다. 대신 같은 서명의 대표를 고를 때 선호를 함께 본다.
  const bestBySignature = new Map<string, PlannerState>();
  for (const state of states) {
    const signature =
      `${state.stationId}|${state.derived.sortedVisitKey}|${state.readyAt}|${state.derived.dateCountsKey}`;
    const previous = bestBySignature.get(signature);
    if (!previous || comparePruned(state, previous) < 0) {
      bestBySignature.set(signature, state);
    }
  }
  const merged = [...bestBySignature.values()];
  const byExistingOrder = [...merged].sort(compareBeam).slice(0, MAX_BEAM_SIZE);
  if (ctx.preferredCount === 0 && ctx.preferredOrderCount === 0) return byExistingOrder;

  // #139 6-2: 선호를 지킨 상태는 최종 비교에 닿기 전에 잘리면 안 된다. 그렇다고 기존 자리를
  // 밀어내서도 안 된다 — 밀려난 상태가 더 깊은 탐색으로 이어지던 경우 **방문 장소 수가 준다.**
  // 장소 수는 비교 키 2번으로 선호(4번)보다 위라, 선호를 지키려다 장소를 잃으면 계약 위반이다.
  // 실측: 선호 하나를 넣자 9곳 → 8곳으로 줄었고, beam만 늘리면 9곳이 그대로 돌아왔다.
  //
  // 그래서 뺏지 않고 더한다 — 기존 순서의 상위 N에 선호 순서의 상위 N을 합집합으로 얹는다.
  // 선호가 없으면 위에서 이미 돌아가 한 톨도 달라지지 않고, 있어도 상한은 2N이다.
  const byPreferredOrder = [...merged].sort(compareBeamPreferred).slice(0, MAX_BEAM_SIZE);
  const kept = new Set(byExistingOrder);
  return [...byExistingOrder, ...byPreferredOrder.filter((state) => !kept.has(state))];
}

function coverageOf(state: PlannerState): number {
  return Number(state.derived.actorGroupCovered) + Number(state.derived.workGroupCovered);
}

/** beam 정렬 — 경고 수는 최종 비교 키(#43)와 같은 방향으로 beam에서도 우선한다 */
function compareBeam(a: PlannerState, b: PlannerState): number {
  return coverageOf(b) - coverageOf(a)
    || activityWarningCountOf(a) - activityWarningCountOf(b)
    || a.readyAt - b.readyAt
    || a.derived.stableKey.localeCompare(b.derived.stableKey, "en");
}

/** 같은 정렬에 선호 불일치를 최종 비교와 같은 자리(경고 뒤)에 끼운 것 (#139) */
function compareBeamPreferred(a: PlannerState, b: PlannerState): number {
  return coverageOf(b) - coverageOf(a)
    || activityWarningCountOf(a) - activityWarningCountOf(b)
    || b.derived.preferredHonoredCount - a.derived.preferredHonoredCount
    || b.derived.preferredOrderHonoredCount - a.derived.preferredOrderHonoredCount
    || a.readyAt - b.readyAt
    || a.derived.stableKey.localeCompare(b.derived.stableKey, "en");
}

/**
 * 같은 서명 안에서 남길 대표 상태 (#139 6-2 앞 단계).
 *
 * 정렬만 고치면 여기서 이미 탈락한다 — 선호를 지킨 상태와 아닌 상태는 방문 집합·날짜별
 * 배치 수·역·준비 시각이 모두 같을 수 있어 같은 서명으로 묶이기 때문이다.
 */
function comparePruned(a: PlannerState, b: PlannerState): number {
  return activityWarningCountOf(a) - activityWarningCountOf(b)
    || b.derived.preferredHonoredCount - a.derived.preferredHonoredCount
    || b.derived.preferredOrderHonoredCount - a.derived.preferredOrderHonoredCount
    || a.readyAt - b.readyAt
    || a.railMinutes - b.railMinutes;
}

function buildDays(
  ctx: PlanContext,
  visits: ScheduledVisit[],
  rides: TrainLegT[],
  regionWindows: RegionWindow[],
): DayPlan[] {
  const days = new Map<string, DayPlan>();
  const getDay = (date: string): DayPlan => {
    const existing = days.get(date);
    if (existing) return existing;
    const created: DayPlan = { date, items: [], rides: [], regionWindows: [] };
    days.set(date, created);
    return created;
  };
  for (const visit of visits) {
    const item: ItineraryItem = {
      placeId: visit.place.id,
      arriveAt: new Date(visit.visitStart).toISOString(),
      departAt: new Date(visit.visitEnd).toISOString(),
      accessMinutes: visit.place.accessEstimate.minutes,
    };
    getDay(ctx.dateOf(visit.visitStart)).items.push(item);
  }
  for (const ride of rides) {
    const item: TrainRide = { ...ride };
    getDay(ctx.dateOf(Date.parse(ride.departAt))).rides.push(item);
  }
  // #33 — 창은 KST 자정 분할되어 있으므로 시작 시각의 날짜에 단독 귀속된다
  for (const window of regionWindows) {
    getDay(ctx.dateOf(Date.parse(window.startAt))).regionWindows.push(window);
  }
  return [...days.values()]
    .sort((a, b) => a.date.localeCompare(b.date, "en"))
    .map((day) => ({
      ...day,
      items: day.items.sort((a, b) => Date.parse(a.arriveAt) - Date.parse(b.arriveAt)),
      rides: day.rides.sort((a, b) => Date.parse(a.departAt) - Date.parse(b.departAt)),
      regionWindows: day.regionWindows.sort(
        (a, b) => Date.parse(a.startAt) - Date.parse(b.startAt),
      ),
    }));
}

function enumerateDates(ctx: PlanContext, start: string, end: string): string[] {
  const dates: string[] = [];
  let cursor = ctx.timeOf(start, "00:00");
  const last = ctx.timeOf(end, "00:00");
  while (cursor <= last) {
    dates.push(ctx.dateOf(cursor));
    cursor += 24 * 60 * MINUTE_MS;
  }
  return dates;
}

function isClosedDay(ctx: PlanContext, place: PlaceT, date: string): boolean {
  if (place.openingHours.type !== "hours" || !place.openingHours.closedDays) return false;
  const day = new Date(ctx.timeOf(date, "12:00")).getUTCDay();
  const weekday = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][day] as
    "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat";
  return place.openingHours.closedDays.includes(weekday);
}

/**
 * 여행 가능 날짜(KST) — 공항 준비일부터 마감일까지.
 *
 * ctx 없이 계산한다. Action 경계의 사전 검사(`preferredVisitDateErrors`)가 ctx를 만들지 않고도
 * 엔진과 같은 날짜 집합을 봐야 하기 때문이다. 두 곳이 갈라지면 검사와 판정이 어긋난다.
 */
function tripDatesOf(availableAt: number, deadline: number): string[] {
  const dates: string[] = [];
  let cursor = koreaDateTime(koreaDate(availableAt), "00:00");
  const last = koreaDateTime(koreaDate(deadline), "00:00");
  while (cursor <= last) {
    dates.push(koreaDate(cursor));
    cursor += DAY_MS;
  }
  return dates;
}

/**
 * Action·resolver가 엔진과 정확히 같은 여행 일차 집합을 쓰는 공개 읽기 전용 헬퍼.
 * 날짜 계산을 호출부에서 복제하면 `preferredVisitDateErrors`와 자연어 명령의 dayIndex가
 * 서로 다른 날짜를 가리킬 수 있으므로, 엔진의 KST 경계 계산을 그대로 공유한다 (#141).
 */
export function tripDatesForWindow(availableAt: string, deadline: string): string[] {
  return tripDatesOf(Date.parse(availableAt), Date.parse(deadline));
}

function koreaDate(epoch: number): string {
  return new Date(epoch + KOREA_OFFSET_MS).toISOString().slice(0, 10);
}

function koreaDateTime(date: string, time: string): number {
  return Date.parse(`${date}T${time}:00+09:00`);
}

function routeMinutes(route: TrainLegT[]): number {
  return route.reduce((total, leg) =>
    total + minutesBetween(Date.parse(leg.departAt), Date.parse(leg.arriveAt)), 0);
}

function transferCount(route: TrainLegT[]): number {
  let count = 0;
  for (let index = 1; index < route.length; index += 1) {
    if (route[index - 1].trainNo !== route[index].trainNo) count += 1;
  }
  return count;
}

function completionFailure(
  state: PlannerState,
  candidate: CandidatePlace,
  constraints: TripConstraints,
  ctx: PlanContext,
  endpointStationId: string,
): CandidateRejection | null {
  const departureAt = Date.parse(constraints.departureAt);
  const deadline = Date.parse(constraints.airportArrivalDeadline);
  const transition = appendVisit(state, candidate, constraints, ctx, deadline);
  if (!transition.ok) {
    if (transition.reason.code === "TRAIN_UNAVAILABLE") {
      const withoutDepartureBuffer = appendVisit(
        state,
        candidate,
        constraints,
        ctx,
        departureAt,
      );
      if (withoutDepartureBuffer.ok) {
        return { code: "DEPARTURE_DEADLINE_EXCEEDED", placeId: candidate.place.id };
      }
    }
    return transition.reason;
  }

  const returnBeforeDeadline = findEarliestRoute(
    ctx.routes,
    transition.state.stationId,
    endpointStationId,
    transition.state.readyAt,
    deadline,
  );
  if (returnBeforeDeadline) {
    return null;
  }
  const returnBeforeDeparture = findEarliestRoute(
    ctx.routes,
    transition.state.stationId,
    endpointStationId,
    transition.state.readyAt,
    departureAt,
  );
  return returnBeforeDeparture
    ? { code: "DEPARTURE_DEADLINE_EXCEEDED", placeId: candidate.place.id }
    : { code: "TRAIN_UNAVAILABLE", placeId: candidate.place.id };
}

function minutesBetween(start: number, end: number): number {
  return Math.max(0, Math.round((end - start) / MINUTE_MS));
}

function activityWarningCountOf(state: PlannerState): number {
  return state.derived.warningCount;
}

function selectionGroupSummary(
  actorIds: ReadonlySet<string>,
  workIds: ReadonlySet<string>,
  allCandidates: readonly CandidatePlace[],
  eligibleCandidates: readonly CandidatePlace[],
  visits: readonly ScheduledVisit[],
  rejectedPlaces: readonly CandidateRejection[],
): SelectionGroupSummary {
  const requested: SelectionGroup[] = [];
  if (actorIds.size > 0) requested.push("actor");
  if (workIds.size > 0) requested.push("work");

  const covered = requested.filter((group) =>
    visits.some(({ selectionGroups }) => selectionGroups.includes(group)));
  const rejectedByPlace = new Map<string, CandidateRejection["code"][]>();
  for (const rejection of rejectedPlaces) {
    const codes = rejectedByPlace.get(rejection.placeId);
    if (codes) codes.push(rejection.code);
    else rejectedByPlace.set(rejection.placeId, [rejection.code]);
  }

  const uncovered = requested
    .filter((group) => !covered.includes(group))
    .map((group) => {
      const strict = allCandidates.filter(({ selectionGroups }) => selectionGroups.includes(group));
      const eligible = eligibleCandidates.filter(({ selectionGroups }) => selectionGroups.includes(group));
      if (strict.length === 0) {
        return { group, reasons: ["NO_STRICT_CANDIDATES" as const] };
      }
      if (eligible.length === 0) {
        return { group, reasons: ["EXCLUDED_BY_USER" as const] };
      }
      const reasons = [...new Set(eligible.flatMap(({ place }) => rejectedByPlace.get(place.id) ?? []))];
      return { group, reasons: reasons.length > 0 ? reasons : ["NOT_SCHEDULED" as const] };
    });

  return { requested, covered, uncovered };
}

function uniqueReasons(reasons: CandidateRejection[]): CandidateRejection[] {
  const seen = new Set<string>();
  return reasons.filter((reason) => {
    const key = JSON.stringify(reason);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
