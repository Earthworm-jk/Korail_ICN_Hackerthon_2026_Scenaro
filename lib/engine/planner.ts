import type { Repositories } from "../repositories/json";
import { accessBufferMinutes, type PlaceT, type TrainLegT } from "../types/schema";
import { compareCandidates, type Candidate } from "./compare";
import type {
  ActivityWindowDetail,
  DayPlan,
  ItineraryItem,
  ItineraryResult,
  RejectionReason,
  TrainRide,
  TripConstraints,
} from "./types";

const KOREA_OFFSET_MS = 9 * 60 * 60 * 1_000;
const MINUTE_MS = 60_000;
const MAX_BEAM_SIZE = 1_000;

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
  | { ok: false; reason: RejectionReason };

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
  const requiredPlaceIds = new Set(constraints.requiredPlaceIds);

  assertReferences(constraints, repos, actorIds);

  for (const placeId of requiredPlaceIds) {
    if (excludedPlaceIds.has(placeId)) {
      return infeasible("REQUIRED_PLACE", placeId);
    }
  }

  const rejectedPlaces: RejectionReason[] = [];
  const candidates: CandidatePlace[] = [];
  for (const place of [...repos.places].sort((a, b) => a.id.localeCompare(b.id, "en"))) {
    if (excludedPlaceIds.has(place.id)) continue;

    const relation = classifyPlace(place, selectedWorkIds, actorWorkIds);
    if (!relation) continue;

    if (place.openingHours.type === "unverified") {
      const reason: RejectionReason = {
        code: "ACTIVITY_WINDOW_MISMATCH",
        placeId: place.id,
        detail: "UNVERIFIED_HOURS",
      };
      if (requiredPlaceIds.has(place.id)) return infeasible("REQUIRED_PLACE", place.id);
      if (constraints.pinnedDates[place.id]) return infeasible("PINNED_DATE", place.id);
      rejectedPlaces.push(reason);
      continue;
    }
    candidates.push({ place, relation });
  }

  for (const placeId of requiredPlaceIds) {
    if (!candidates.some(({ place }) => place.id === placeId)) {
      return infeasible("REQUIRED_PLACE", placeId);
    }
  }
  for (const placeId of Object.keys(constraints.pinnedDates)) {
    if (!candidates.some(({ place }) => place.id === placeId)) {
      return infeasible("PINNED_DATE", placeId);
    }
  }
  candidates.sort((a, b) => {
    const byRelation = (a.relation === "selected_work" ? 0 : 1)
      - (b.relation === "selected_work" ? 0 : 1);
    return byRelation || a.place.id.localeCompare(b.place.id, "en");
  });

  const gatewayStationId = constraints.gatewayStationId ?? findGatewayStationId(repos);
  const availableAt = Date.parse(constraints.arrivalAt)
    + constraints.airportExitOffsetMin * MINUTE_MS;
  const departureAt = Date.parse(constraints.departureAt);
  const deadline = departureAt - constraints.departureBufferMinutes * MINUTE_MS;
  const initial: PlannerState = {
    stationId: gatewayStationId,
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
          repos.trainLegs,
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
        gatewayStationId,
        constraints,
        repos.trainLegs,
        departureAt,
        deadline,
      );
      if (schedule && satisfiesUserConstraints(schedule.state, constraints)) {
        complete.push(schedule);
      }
    }
  }

  if (complete.length === 0) {
    for (const placeId of requiredPlaceIds) {
      if (!hasVisited(frontier, placeId)) return infeasible("REQUIRED_PLACE", placeId);
    }
    for (const placeId of Object.keys(constraints.pinnedDates)) {
      if (!hasVisited(frontier, placeId)) return infeasible("PINNED_DATE", placeId);
    }
    const first = candidates[0]?.place.id;
    return {
      ok: false,
      reason: first
        ? completionFailure(initial, candidates[0], constraints, repos.trainLegs, gatewayStationId)
          ?? { code: "TRAIN_UNAVAILABLE", placeId: first }
        : { code: "TRAIN_UNAVAILABLE", placeId: "unknown" },
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
      repos.trainLegs,
      gatewayStationId,
    );
    if (reason) rejectedPlaces.push(reason);
  }

  const allRides = [...best.state.rides, ...best.returnRides];
  const totalRailMinutes = best.state.railMinutes + routeMinutes(best.returnRides);
  const totalTransferCount = best.state.transferCount + transferCount(best.returnRides);
  return {
    ok: true,
    days: buildDays(best.state.visits, allRides),
    rejectedPlaces: uniqueReasons(rejectedPlaces),
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
  trainLegs: TrainLegT[],
  deadline: number,
): Transition {
  const place = candidate.place;
  const route = findEarliestRoute(
    trainLegs,
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
  const buffered = findVisitWindow(
    place,
    stationArrival,
    constraints.pinnedDates[place.id],
    true,
    deadline,
    dateAvailable,
  );
  if (!buffered) {
    const withoutBuffer = findVisitWindow(
      place,
      stationArrival,
      constraints.pinnedDates[place.id],
      false,
      deadline,
      dateAvailable,
    );
    const detail: ActivityWindowDetail = withoutBuffer
      ? "CONSERVATIVE_BUFFER_MISMATCH"
      : "OUTSIDE_VERIFIED_HOURS";
    return {
      ok: false,
      reason: { code: "ACTIVITY_WINDOW_MISMATCH", placeId: place.id, detail },
    };
  }

  const date = koreaDate(buffered.visitStart);
  if ((state.dateCounts.get(date) ?? 0) >= constraints.maxPlacesPerDay) {
    return {
      ok: false,
      reason: {
        code: "ACTIVITY_WINDOW_MISMATCH",
        placeId: place.id,
        detail: "OUTSIDE_VERIFIED_HOURS",
      },
    };
  }

  const dateCounts = new Map(state.dateCounts);
  dateCounts.set(date, (dateCounts.get(date) ?? 0) + 1);
  const localRoundTrip = 2 * buffered.accessAndBufferMinutes;
  return {
    ok: true,
    state: {
      stationId: place.nearestStationId,
      readyAt: buffered.stationReadyAt,
      visits: [...state.visits, {
        place,
        relation: candidate.relation,
        visitStart: buffered.visitStart,
        visitEnd: buffered.visitEnd,
        stationReadyAt: buffered.stationReadyAt,
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
  pinnedDate: string | undefined,
  includeBuffer: boolean,
  deadline: number,
  dateAvailable: (date: string) => boolean,
): { visitStart: number; visitEnd: number; stationReadyAt: number; accessAndBufferMinutes: number } | null {
  const buffer = includeBuffer ? accessBufferMinutes(place.accessEstimate.minutes) : 0;
  const accessAndBufferMinutes = place.accessEstimate.minutes + buffer;
  const earliestPlaceArrival = stationArrival + accessAndBufferMinutes * MINUTE_MS;
  const startDate = koreaDate(earliestPlaceArrival);
  const dates = pinnedDate
    ? [pinnedDate]
    : enumerateDates(startDate, koreaDate(deadline));

  for (const date of dates) {
    if (date < startDate || !dateAvailable(date) || isClosedDay(place, date)) continue;
    let visitStart = earliestPlaceArrival;
    if (place.openingHours.type === "hours") {
      const open = koreaDateTime(date, place.openingHours.open);
      const close = koreaDateTime(date, place.openingHours.close);
      visitStart = Math.max(visitStart, open);
      if (place.openingHours.lastEntry
        && visitStart > koreaDateTime(date, place.openingHours.lastEntry)) continue;
      const visitEnd = visitStart + place.stayMinutes * MINUTE_MS;
      const stationReadyAt = visitEnd + accessAndBufferMinutes * MINUTE_MS;
      if (visitEnd <= close && stationReadyAt <= deadline) {
        return { visitStart, visitEnd, stationReadyAt, accessAndBufferMinutes };
      }
      continue;
    }

    visitStart = Math.max(visitStart, koreaDateTime(date, "00:00"));
    const visitEnd = visitStart + place.stayMinutes * MINUTE_MS;
    const stationReadyAt = visitEnd + accessAndBufferMinutes * MINUTE_MS;
    if (koreaDate(visitStart) === date && stationReadyAt <= deadline) {
      return { visitStart, visitEnd, stationReadyAt, accessAndBufferMinutes };
    }
  }
  return null;
}

function completeSchedule(
  state: PlannerState,
  gatewayStationId: string,
  constraints: TripConstraints,
  trainLegs: TrainLegT[],
  departureAt: number,
  deadline: number,
): CompleteSchedule | null {
  const returnRides = findEarliestRoute(
    trainLegs,
    state.stationId,
    gatewayStationId,
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
      totalRailMinutes,
      transferCount: totalTransfers,
      slackSatisfied:
        departureSlackMinutes >= constraints.departureBufferMinutes + constraints.dailySlackMinutes,
    },
    transferCount: totalTransfers,
    totalRailMinutes,
    departureSlackMinutes,
    stableId: [
      ...state.visits.map(({ place }) => place.id),
      ...state.rides.map(({ trainNo }) => trainNo),
      ...returnRides.map(({ trainNo }) => trainNo),
    ].join("/"),
  };
}

function findEarliestRoute(
  trainLegs: TrainLegT[],
  fromStationId: string,
  toStationId: string,
  notBefore: number,
  deadline: number,
): TrainLegT[] | null {
  if (fromStationId === toStationId) return [];
  const arrivals = new Map<string, { at: number; path: TrainLegT[] }>();
  arrivals.set(fromStationId, { at: notBefore, path: [] });
  const sortedLegs = [...trainLegs].sort((a, b) => {
    const byDeparture = Date.parse(a.departAt) - Date.parse(b.departAt);
    return byDeparture || a.trainNo.localeCompare(b.trainNo, "en");
  });

  for (const leg of sortedLegs) {
    const departAt = Date.parse(leg.departAt);
    const arriveAt = Date.parse(leg.arriveAt);
    if (departAt < notBefore || arriveAt > deadline || arriveAt < departAt) continue;
    const origin = arrivals.get(leg.fromStationId);
    if (!origin || origin.at > departAt) continue;
    const current = arrivals.get(leg.toStationId);
    if (!current || arriveAt < current.at) {
      arrivals.set(leg.toStationId, { at: arriveAt, path: [...origin.path, leg] });
    }
  }
  return arrivals.get(toStationId)?.path ?? null;
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
  for (const placeId of [
    ...constraints.requiredPlaceIds,
    ...constraints.excludedPlaceIds,
    ...Object.keys(constraints.pinnedDates),
  ]) {
    if (!knownPlaces.has(placeId)) throw new RangeError(`unknown place: ${placeId}`);
  }
  if (constraints.gatewayStationId
    && !repos.stations.some(({ id }) => id === constraints.gatewayStationId)) {
    throw new RangeError(`unknown gateway station: ${constraints.gatewayStationId}`);
  }
}

function findGatewayStationId(repos: Repositories): string {
  const metro = repos.stations
    .filter(({ regionId }) => regionId === "seoul_metro")
    .sort((a, b) => {
      const aSeoul = a.id.includes("seoul") ? 0 : 1;
      const bSeoul = b.id.includes("seoul") ? 0 : 1;
      return aSeoul - bSeoul || a.id.localeCompare(b.id, "en");
    });
  const fallback = [...repos.trainLegs]
    .sort((a, b) => Date.parse(a.departAt) - Date.parse(b.departAt))[0]?.fromStationId;
  const gateway = metro[0]?.id ?? fallback;
  if (!gateway) throw new RangeError("a gateway station could not be inferred");
  return gateway;
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
    if (!previous || state.readyAt < previous.readyAt
      || (state.readyAt === previous.readyAt && state.railMinutes < previous.railMinutes)) {
      bestBySignature.set(signature, state);
    }
  }
  return [...bestBySignature.values()]
    .sort((a, b) => {
      const aSelected = a.visits.filter(({ relation }) => relation === "selected_work").length;
      const bSelected = b.visits.filter(({ relation }) => relation === "selected_work").length;
      return bSelected - aSelected
        || a.readyAt - b.readyAt
        || stableStateId(a).localeCompare(stableStateId(b), "en");
    })
    .slice(0, MAX_BEAM_SIZE);
}

function satisfiesUserConstraints(state: PlannerState, constraints: TripConstraints): boolean {
  const visited = new Set(state.visits.map(({ place }) => place.id));
  return constraints.requiredPlaceIds.every((id) => visited.has(id))
    && Object.entries(constraints.pinnedDates).every(([id, date]) =>
      state.visits.some(({ place, visitStart }) => place.id === id && koreaDate(visitStart) === date));
}

function buildDays(visits: ScheduledVisit[], rides: TrainLegT[]): DayPlan[] {
  const days = new Map<string, DayPlan>();
  const getDay = (date: string): DayPlan => {
    const existing = days.get(date);
    if (existing) return existing;
    const created: DayPlan = { date, items: [], rides: [] };
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
  return [...days.values()]
    .sort((a, b) => a.date.localeCompare(b.date, "en"))
    .map((day) => ({
      ...day,
      items: day.items.sort((a, b) => Date.parse(a.arriveAt) - Date.parse(b.arriveAt)),
      rides: day.rides.sort((a, b) => Date.parse(a.departAt) - Date.parse(b.departAt)),
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
  const aliases = [
    ["sun", "sunday", "일", "일요일"],
    ["mon", "monday", "월", "월요일"],
    ["tue", "tuesday", "화", "화요일"],
    ["wed", "wednesday", "수", "수요일"],
    ["thu", "thursday", "목", "목요일"],
    ["fri", "friday", "금", "금요일"],
    ["sat", "saturday", "토", "토요일"],
  ][day];
  return place.openingHours.closedDays.some((value) =>
    aliases.includes(value.trim().toLowerCase()));
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
  trainLegs: TrainLegT[],
  gatewayStationId: string,
): RejectionReason | null {
  const departureAt = Date.parse(constraints.departureAt);
  const deadline = departureAt - constraints.departureBufferMinutes * MINUTE_MS;
  const transition = appendVisit(state, candidate, constraints, trainLegs, deadline);
  if (!transition.ok) {
    if (transition.reason.code === "TRAIN_UNAVAILABLE") {
      const withoutDepartureBuffer = appendVisit(
        state,
        candidate,
        constraints,
        trainLegs,
        departureAt,
      );
      if (withoutDepartureBuffer.ok) {
        return { code: "DEPARTURE_DEADLINE_EXCEEDED", placeId: candidate.place.id };
      }
    }
    return transition.reason;
  }

  const returnBeforeDeadline = findEarliestRoute(
    trainLegs,
    transition.state.stationId,
    gatewayStationId,
    transition.state.readyAt,
    deadline,
  );
  if (returnBeforeDeadline) {
    return null;
  }
  const returnBeforeDeparture = findEarliestRoute(
    trainLegs,
    transition.state.stationId,
    gatewayStationId,
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

function stableStateId(state: PlannerState): string {
  return [
    ...state.visits.map(({ place }) => place.id),
    ...state.rides.map(({ trainNo }) => trainNo),
  ].join("/");
}

function hasVisited(states: PlannerState[], placeId: string): boolean {
  return states.some((state) => state.visits.some(({ place }) => place.id === placeId));
}

function uniqueReasons(reasons: RejectionReason[]): RejectionReason[] {
  const seen = new Set<string>();
  return reasons.filter((reason) => {
    const key = JSON.stringify(reason);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function infeasible(
  constraintType: "REQUIRED_PLACE" | "PINNED_DATE",
  targetId: string,
): ItineraryResult {
  return {
    ok: false,
    reason: { code: "USER_CONSTRAINT_INFEASIBLE", constraintType, targetId },
  };
}
