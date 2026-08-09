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
};

const DAY_MS = 24 * 60 * MINUTE_MS;

function buildPlanContext(
  trainLegs: TrainLegT[],
  places: readonly PlaceT[],
  availableAt: number,
  deadline: number,
): PlanContext {
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
  const tripDates = enumerateDates(ctx, koreaDate(availableAt), koreaDate(deadline));
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
  const ctx = buildPlanContext(repos.trainLegs, repos.places, availableAt, deadline);
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
        if (!transition.ok) continue;
        next.push(transition.state);
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

function appendVisit(
  state: PlannerState,
  candidate: CandidatePlace,
  constraints: TripConstraints,
  ctx: PlanContext,
  deadline: number,
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
    : findVisitWindow(ctx, place, stationArrival, true, deadline, dateAvailable, "verified");
  let warning: ActivityWindowDetail | null = null;
  if (!window) {
    warning = activityWarningDetail(ctx, place, stationArrival, deadline, dateAvailable);
    window = findVisitWindow(ctx, place, stationArrival, true, deadline, dateAvailable, "ignore-hours");
    if (!window) {
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
): { visitStart: number; visitEnd: number; stationReadyAt: number; accessAndBufferMinutes: number } | null {
  const buffer = includeBuffer ? accessBufferMinutes(place.accessEstimate.minutes) : 0;
  const accessAndBufferMinutes = place.accessEstimate.minutes + buffer;
  const earliestPlaceArrival = stationArrival + accessAndBufferMinutes * MINUTE_MS;
  const startDate = ctx.dateOf(earliestPlaceArrival);
  // 시작일은 항상 여행 날짜 범위 안(도착 이후)이고, 범위 밖(마감 이후)이면 후보 날짜가 없다
  const startIndex = ctx.dateIndex.get(startDate);
  const dates = startIndex === undefined ? [] : ctx.tripDates.slice(startIndex);

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
): ActivityWindowDetail {
  if (place.openingHours.type === "unverified") return "UNVERIFIED_HOURS";
  return findVisitWindow(ctx, place, stationArrival, false, deadline, dateAvailable, "verified")
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
  const bestBySignature = new Map<string, PlannerState>();
  for (const state of states) {
    const signature =
      `${state.stationId}|${state.derived.sortedVisitKey}|${state.readyAt}|${state.derived.dateCountsKey}`;
    const previous = bestBySignature.get(signature);
    if (!previous
      || activityWarningCountOf(state) < activityWarningCountOf(previous)
      || (activityWarningCountOf(state) === activityWarningCountOf(previous)
        && (state.readyAt < previous.readyAt
          || (state.readyAt === previous.readyAt && state.railMinutes < previous.railMinutes)))) {
      bestBySignature.set(signature, state);
    }
  }
  return [...bestBySignature.values()]
    .sort((a, b) => {
      const aCoverage = Number(a.derived.actorGroupCovered) + Number(a.derived.workGroupCovered);
      const bCoverage = Number(b.derived.actorGroupCovered) + Number(b.derived.workGroupCovered);
      // 경고 수는 최종 비교 키(#43)와 같은 방향으로 beam에서도 우선한다
      return bCoverage - aCoverage
        || activityWarningCountOf(a) - activityWarningCountOf(b)
        || a.readyAt - b.readyAt
        || a.derived.stableKey.localeCompare(b.derived.stableKey, "en");
    })
    .slice(0, MAX_BEAM_SIZE);
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
