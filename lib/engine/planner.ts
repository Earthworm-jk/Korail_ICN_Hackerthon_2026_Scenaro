import type { Repositories } from "../repositories/json";
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
  TrainRide,
  TripConstraints,
} from "./types";

const KOREA_OFFSET_MS = 9 * 60 * 60 * 1_000;
const MINUTE_MS = 60_000;
const MAX_BEAM_SIZE = 1_000;
const MIN_TRANSFER_MINUTES = 15;

type Relation = "selected_work" | "actor_other_work";

type CandidatePlace = {
  place: PlaceT;
  relation: Relation;
};

type ScheduledVisit = {
  place: PlaceT;
  relation: Relation;
  visitStart: number;
  visitEnd: number;
  stationReadyAt: number;
  warning: ActivityWindowDetail | null; // #43: 운영시간 판정 결과 — 배치는 유지, 경고로 전달
};

type PlannerState = {
  stationId: string;
  readyAt: number;
  visits: ScheduledVisit[];
  rides: TrainLegT[];
  railMinutes: number;
  transferCount: number;
  localTravelMinutes: number;
  dateCounts: Map<string, number>;
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
  const actorWorkIds = new Set(
    repos.actors
      .filter((actor) => actorIds.has(actor.id))
      .flatMap((actor) => actor.workIds),
  );
  const selectedWorkIds = new Set(constraints.selectedWorkIds);
  const excludedPlaceIds = new Set(constraints.excludedPlaceIds);

  assertReferences(constraints, repos, actorIds);

  const rejectedPlaces: CandidateRejection[] = [];
  const candidates: CandidatePlace[] = [];
  for (const place of [...repos.places].sort((a, b) => a.id.localeCompare(b.id, "en"))) {
    if (excludedPlaceIds.has(place.id)) continue;

    const relation = classifyPlace(place, selectedWorkIds, actorWorkIds);
    if (!relation) continue;
    // #43 결정 1: 운영시간 미확인은 후보 제외 사유가 아니다 — 배치 시 경고로 전달한다
    candidates.push({ place, relation });
  }

  candidates.sort((a, b) => {
    const byRelation = (a.relation === "selected_work" ? 0 : 1)
      - (b.relation === "selected_work" ? 0 : 1);
    return byRelation || a.place.id.localeCompare(b.place.id, "en");
  });

  const gatewayStationId = constraints.gatewayStationId ?? findGatewayStationId(repos);
  const endpointStationId = constraints.airportStationId
    ?? findAirportStationId(repos)
    ?? gatewayStationId;
  const availableAt = Date.parse(constraints.airportReadyAt);
  const departureAt = Date.parse(constraints.departureAt);
  const deadline = Date.parse(constraints.airportArrivalDeadline);
  const routes = buildRouteContext(repos.trainLegs);
  const initial: PlannerState = {
    stationId: endpointStationId,
    readyAt: availableAt,
    visits: [],
    rides: [],
    railMinutes: 0,
    transferCount: 0,
    localTravelMinutes: 0,
    dateCounts: new Map(),
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
          routes,
          deadline,
        );
        if (!transition.ok) continue;
        next.push(transition.state);
      }
    }

    if (next.length === 0) break;
    frontier = pruneStates(next);

    for (const state of frontier) {
      const schedule = completeSchedule(
        state,
        endpointStationId,
        constraints,
        routes,
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
        routes,
        endpointStationId,
      );
      if (reason) rejectedPlaces.push(reason);
    }
    return {
      status: "empty",
      days: [],
      rejectedPlaces: uniqueReasons(rejectedPlaces),
      warnings: [],
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
      routes,
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
    days: buildDays(best.state.visits, allRides, regionWindows),
    rejectedPlaces: uniqueReasons(rejectedPlaces),
    warnings,
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

function appendVisit(
  state: PlannerState,
  candidate: CandidatePlace,
  constraints: TripConstraints,
  routes: RouteContext,
  deadline: number,
): Transition {
  const place = candidate.place;
  const route = findEarliestRoute(
    routes,
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
  const dateAvailable = (date: string) =>
    (state.dateCounts.get(date) ?? 0) < constraints.maxPlacesPerDay;

  // #43 결정 1: 검증 운영시간 안 배치를 먼저 시도하고, 불가능하면 판정식(#5) 결과를
  // 경고로 강등해 배치는 유지한다 — 하드 제약은 열차·출국 마감뿐
  let window = place.openingHours.type === "unverified"
    ? null
    : findVisitWindow(place, stationArrival, true, deadline, dateAvailable, "verified");
  let warning: ActivityWindowDetail | null = null;
  if (!window) {
    warning = activityWarningDetail(place, stationArrival, deadline, dateAvailable);
    window = findVisitWindow(place, stationArrival, true, deadline, dateAvailable, "ignore-hours");
    if (!window) {
      // 남은 기간 안에 배치 자체가 불가능(마감·하루 상한) — 운영시간 사유가 아니다 (#43)
      return {
        ok: false,
        reason: { code: "DEPARTURE_DEADLINE_EXCEEDED", placeId: place.id },
      };
    }
  }

  const date = koreaDate(window.visitStart);
  if ((state.dateCounts.get(date) ?? 0) >= constraints.maxPlacesPerDay) {
    return {
      ok: false,
      reason: { code: "DEPARTURE_DEADLINE_EXCEEDED", placeId: place.id },
    };
  }

  const dateCounts = new Map(state.dateCounts);
  dateCounts.set(date, (dateCounts.get(date) ?? 0) + 1);
  const localRoundTrip = 2 * window.accessAndBufferMinutes;
  return {
    ok: true,
    state: {
      stationId: place.nearestStationId,
      readyAt: window.stationReadyAt,
      visits: [...state.visits, {
        place,
        relation: candidate.relation,
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
    },
  };
}

function findVisitWindow(
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
  const startDate = koreaDate(earliestPlaceArrival);
  const dates = enumerateDates(startDate, koreaDate(deadline));

  for (const date of dates) {
    if (date < startDate || !dateAvailable(date)) continue;
    if (mode === "verified" && isClosedDay(place, date)) continue;
    // PR #45 리뷰: 출력 창(regionWindows)과 배치가 어긋나지 않도록 같은 활동 경계를 적용한다
    // — 역 출발 가능 시각 >= 09:00 (장소 도착 하한 = 09:00 + 접근·보수 버퍼),
    //   장소 방문 + 역 복귀 완료 <= min(출국 마감, 해당 날짜 21:00). hours·상시 개방·경고 폴백 공통.
    const activityDeadline = Math.min(deadline, koreaDateTime(date, DAY_ACTIVITY_END));
    let visitStart = Math.max(
      earliestPlaceArrival,
      koreaDateTime(date, DAY_ACTIVITY_START) + accessAndBufferMinutes * MINUTE_MS,
    );
    if (mode === "verified" && place.openingHours.type === "hours") {
      const open = koreaDateTime(date, place.openingHours.open);
      const close = koreaDateTime(date, place.openingHours.close);
      visitStart = Math.max(visitStart, open);
      if (place.openingHours.lastEntry
        && visitStart > koreaDateTime(date, place.openingHours.lastEntry)) continue;
      const visitEnd = visitStart + place.stayMinutes * MINUTE_MS;
      const stationReadyAt = visitEnd + accessAndBufferMinutes * MINUTE_MS;
      if (visitEnd <= close && stationReadyAt <= activityDeadline) {
        return { visitStart, visitEnd, stationReadyAt, accessAndBufferMinutes };
      }
      continue;
    }

    const visitEnd = visitStart + place.stayMinutes * MINUTE_MS;
    const stationReadyAt = visitEnd + accessAndBufferMinutes * MINUTE_MS;
    if (koreaDate(visitStart) === date && stationReadyAt <= activityDeadline) {
      return { visitStart, visitEnd, stationReadyAt, accessAndBufferMinutes };
    }
  }
  return null;
}

/** #5 판정식 유지 — 결과만 제외 대신 경고 상세로 쓴다 (#43 결정 1) */
function activityWarningDetail(
  place: PlaceT,
  stationArrival: number,
  deadline: number,
  dateAvailable: (date: string) => boolean,
): ActivityWindowDetail {
  if (place.openingHours.type === "unverified") return "UNVERIFIED_HOURS";
  return findVisitWindow(place, stationArrival, false, deadline, dateAvailable, "verified")
    ? "CONSERVATIVE_BUFFER_MISMATCH"
    : "OUTSIDE_VERIFIED_HOURS";
}

function completeSchedule(
  state: PlannerState,
  endpointStationId: string,
  constraints: TripConstraints,
  routes: RouteContext,
  departureAt: number,
  deadline: number,
): CompleteSchedule | null {
  const returnRides = findEarliestRoute(
    routes,
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

  const selectedWorkPlaceCount = state.visits
    .filter(({ relation }) => relation === "selected_work").length;
  const actorOtherWorkPlaceCount = state.visits.length - selectedWorkPlaceCount;
  const totalRailMinutes = state.railMinutes + routeMinutes(returnRides);
  const totalTransfers = state.transferCount + transferCount(returnRides);
  const departureSlackMinutes = minutesBetween(returnedAt, departureAt);
  return {
    state,
    returnRides,
    returnedAt,
    keys: {
      relevanceKey: { selectedWorkPlaceCount, actorOtherWorkPlaceCount },
      visitablePlaceCount: state.visits.length,
      activityWarningCount: activityWarningCountOf(state), // #43 결정 3 — 방문 수와 이동시간 사이
      totalRailMinutes,
      transferCount: totalTransfers,
      slackSatisfied: hasDailySlack(
        state,
        returnRides,
        constraints,
        Date.parse(constraints.airportReadyAt),
        deadline,
      ),
    },
    departureSlackMinutes,
    stableId: [
      ...state.visits.map(({ place }) => place.id),
      ...state.rides.map(({ trainNo }) => trainNo),
      ...returnRides.map(({ trainNo }) => trainNo),
    ].join("/"),
  };
}

function hasDailySlack(
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
    let cursor = koreaDateTime(koreaDate(interval.start), "00:00");
    while (cursor < interval.end) {
      activeDates.add(koreaDate(cursor));
      cursor += 24 * 60 * MINUTE_MS;
    }
  }

  return [...activeDates].every((date) => {
    const dayStart = koreaDateTime(date, "00:00");
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

function classifyPlace(
  place: PlaceT,
  selectedWorkIds: Set<string>,
  actorWorkIds: Set<string>,
): Relation | null {
  if (place.workIds.some((id) => selectedWorkIds.has(id))) return "selected_work";
  if (place.workIds.some((id) => actorWorkIds.has(id))) return "actor_other_work";
  return null;
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

function pruneStates(states: PlannerState[]): PlannerState[] {
  const bestBySignature = new Map<string, PlannerState>();
  for (const state of states) {
    const signature = [
      state.stationId,
      [...state.visits].map(({ place }) => place.id).sort().join(","),
      state.readyAt,
      [...state.dateCounts].sort(([a], [b]) => a.localeCompare(b, "en")).map(([d, n]) => `${d}:${n}`).join(","),
    ].join("|");
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
      const aSelected = a.visits.filter(({ relation }) => relation === "selected_work").length;
      const bSelected = b.visits.filter(({ relation }) => relation === "selected_work").length;
      // 경고 수는 최종 비교 키(#43)와 같은 방향으로 beam에서도 우선한다
      return bSelected - aSelected
        || activityWarningCountOf(a) - activityWarningCountOf(b)
        || a.readyAt - b.readyAt
        || stableStateId(a).localeCompare(stableStateId(b), "en");
    })
    .slice(0, MAX_BEAM_SIZE);
}

function buildDays(
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
      accessMinutesLabel: `약 ${visit.place.accessEstimate.minutes}분 · 추정치`,
    };
    getDay(koreaDate(visit.visitStart)).items.push(item);
  }
  for (const ride of rides) {
    const item: TrainRide = { ...ride };
    getDay(koreaDate(Date.parse(ride.departAt))).rides.push(item);
  }
  // #33 — 창은 KST 자정 분할되어 있으므로 시작 시각의 날짜에 단독 귀속된다
  for (const window of regionWindows) {
    getDay(koreaDate(Date.parse(window.startAt))).regionWindows.push(window);
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

function enumerateDates(start: string, end: string): string[] {
  const dates: string[] = [];
  let cursor = koreaDateTime(start, "00:00");
  const last = koreaDateTime(end, "00:00");
  while (cursor <= last) {
    dates.push(koreaDate(cursor));
    cursor += 24 * 60 * MINUTE_MS;
  }
  return dates;
}

function isClosedDay(place: PlaceT, date: string): boolean {
  if (place.openingHours.type !== "hours" || !place.openingHours.closedDays) return false;
  const day = new Date(koreaDateTime(date, "12:00")).getUTCDay();
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
  routes: RouteContext,
  endpointStationId: string,
): CandidateRejection | null {
  const departureAt = Date.parse(constraints.departureAt);
  const deadline = Date.parse(constraints.airportArrivalDeadline);
  const transition = appendVisit(state, candidate, constraints, routes, deadline);
  if (!transition.ok) {
    if (transition.reason.code === "TRAIN_UNAVAILABLE") {
      const withoutDepartureBuffer = appendVisit(
        state,
        candidate,
        constraints,
        routes,
        departureAt,
      );
      if (withoutDepartureBuffer.ok) {
        return { code: "DEPARTURE_DEADLINE_EXCEEDED", placeId: candidate.place.id };
      }
    }
    return transition.reason;
  }

  const returnBeforeDeadline = findEarliestRoute(
    routes,
    transition.state.stationId,
    endpointStationId,
    transition.state.readyAt,
    deadline,
  );
  if (returnBeforeDeadline) {
    return null;
  }
  const returnBeforeDeparture = findEarliestRoute(
    routes,
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
  return state.visits.filter(({ warning }) => warning !== null).length;
}

function stableStateId(state: PlannerState): string {
  return [
    ...state.visits.map(({ place }) => place.id),
    ...state.rides.map(({ trainNo }) => trainNo),
  ].join("/");
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

