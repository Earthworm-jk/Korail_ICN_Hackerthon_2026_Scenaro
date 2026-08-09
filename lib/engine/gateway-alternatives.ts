/**
 * #58 목적지 중립 GatewayLeg 전체 일정 대안.
 *
 * 검증된 outbound/inbound 한 쌍이 실제 공항 경계를 만족할 때만, 버스 도착 앵커에서
 * 귀환 버스 출발 전까지 기존 결정적 플래너를 실행한다. 목적지 추가는 데이터만 늘린다.
 */
import type { Repositories } from "../repositories/json";
import type { GatewayLegT } from "../types/schema";
import { buildRegionWindows } from "./region-windows";
import { planItinerary } from "./planner";
import type { GatewayPlanningBaseline } from "./gateway-baseline";
import type { DayPlan, GatewayAlternative, RegionWindow, TripConstraints } from "./types";

const MINUTE_MS = 60_000;
const KOREA_OFFSET_MS = 9 * 60 * 60 * 1_000;

function koreaDate(iso: string): string {
  return new Date(Date.parse(iso) + KOREA_OFFSET_MS).toISOString().slice(0, 10);
}

function minutesBetween(start: string, end: string): number {
  return Math.round((Date.parse(end) - Date.parse(start)) / MINUTE_MS);
}

function candidateRegions(constraints: TripConstraints, repos: Repositories): Set<string> {
  const actorIds = new Set([
    ...(constraints.selectedActorIds ?? []),
    ...(constraints.selectedActorId ? [constraints.selectedActorId] : []),
  ]);
  const workIds = new Set([
    ...constraints.selectedWorkIds,
    ...repos.actors.filter(({ id }) => actorIds.has(id)).flatMap(({ workIds: ids }) => ids),
  ]);
  const excluded = new Set(constraints.excludedPlaceIds);
  const stationRegions = new Map(repos.stations.map(({ id, regionId }) => [id, regionId]));
  const regions = new Set<string>();
  for (const place of repos.places) {
    if (excluded.has(place.id) || !place.workIds.some((id) => workIds.has(id))) continue;
    const region = stationRegions.get(place.nearestStationId);
    if (region) regions.add(region);
  }
  return regions;
}

function gatewayPairs(legs: GatewayLegT[]): Array<{ outbound: GatewayLegT; inbound: GatewayLegT }> {
  return legs.filter((leg) => leg.direction === "outbound").flatMap((outbound) =>
    legs
      .filter((inbound) => inbound.direction === "inbound"
        && inbound.routeId === outbound.routeId
        && inbound.fromStationId === outbound.toStationId
        && inbound.toStationId === outbound.fromStationId)
      .map((inbound) => ({ outbound, inbound })),
  );
}

function attachGatewayTimeline(
  days: DayPlan[],
  outbound: GatewayLegT,
  inbound: GatewayLegT,
  constraints: TripConstraints,
  repos: Repositories,
): DayPlan[] {
  const windows = buildRegionWindows({
    rides: [outbound, ...days.flatMap((day) => day.rides), inbound],
    airportReadyAt: constraints.airportReadyAt,
    airportArrivalDeadline: constraints.airportArrivalDeadline,
    startStationId: outbound.fromStationId,
    stations: repos.stations,
  });
  const byDate = new Map(days.map((day) => [
    day.date,
    { ...day, regionWindows: [] as RegionWindow[], gatewayLegs: [] as GatewayLegT[] },
  ]));
  for (const date of [
    ...windows.map((window) => koreaDate(window.startAt)),
    koreaDate(outbound.departAt),
    koreaDate(inbound.departAt),
  ]) {
    if (!byDate.has(date)) {
      byDate.set(date, { date, items: [], rides: [], regionWindows: [], gatewayLegs: [] });
    }
  }
  for (const window of windows) {
    byDate.get(koreaDate(window.startAt))!.regionWindows.push(window);
  }
  for (const leg of [outbound, inbound]) {
    byDate.get(koreaDate(leg.departAt))!.gatewayLegs.push(leg);
  }
  return [...byDate.values()]
    .map((day) => ({
      ...day,
      regionWindows: day.regionWindows.sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt)),
      gatewayLegs: day.gatewayLegs.sort((a, b) => Date.parse(a.departAt) - Date.parse(b.departAt)),
    }))
    .sort((a, b) => a.date.localeCompare(b.date, "en"));
}

function localUseMinutes(days: DayPlan[]): number {
  return days.flatMap((day) => day.regionWindows)
    .reduce((total, window) => total + window.availableMinutes, 0);
}

function visitedIds(days: DayPlan[]): Set<string> {
  return new Set(days.flatMap((day) => day.items.map(({ placeId }) => placeId)));
}

export function buildGatewayAlternatives(
  constraints: TripConstraints,
  repos: Repositories,
  baseline: GatewayPlanningBaseline,
): GatewayAlternative[] {
  if (repos.gatewayLegs.length === 0) return [];
  const regions = candidateRegions(constraints, repos);
  const stationById = new Map(repos.stations.map((station) => [station.id, station]));
  const readyAt = Date.parse(constraints.airportReadyAt);
  const deadline = Date.parse(constraints.airportArrivalDeadline);
  const primaryVisited = new Set(baseline.visitedPlaceIds);
  const alternatives: GatewayAlternative[] = [];

  for (const { outbound, inbound } of gatewayPairs(repos.gatewayLegs)) {
    const anchor = stationById.get(outbound.toStationId);
    if (!anchor || !regions.has(anchor.regionId)) continue;
    if (Date.parse(outbound.departAt) < readyAt
      || Date.parse(outbound.arriveAt) >= Date.parse(inbound.departAt)
      || Date.parse(inbound.arriveAt) > deadline) continue;

    const result = planItinerary({
      ...constraints,
      airportReadyAt: outbound.arriveAt,
      airportArrivalDeadline: inbound.departAt,
      airportStationId: outbound.toStationId,
      gatewayStationId: outbound.toStationId,
    }, repos);
    if (result.status !== "planned") continue;

    const days = attachGatewayTimeline(result.days, outbound, inbound, constraints, repos);
    const gatewayMinutes = minutesBetween(outbound.departAt, outbound.arriveAt)
      + minutesBetween(inbound.departAt, inbound.arriveAt);
    const alternativeVisited = visitedIds(days);
    alternatives.push({
      id: `${outbound.routeId}:${outbound.id}:${inbound.id}`,
      kind: "gateway_bus",
      routeId: outbound.routeId,
      serviceName: outbound.serviceName,
      operator: outbound.operator,
      days,
      rejectedPlaces: result.rejectedPlaces,
      warnings: result.warnings,
      metrics: {
        ...result.metrics,
        totalTravelMinutes: result.metrics.totalTravelMinutes + gatewayMinutes,
        departureSlackMinutes: minutesBetween(inbound.arriveAt, constraints.departureAt),
        totalGatewayMinutes: gatewayMinutes,
      },
      effects: {
        localUseDeltaMinutes: localUseMinutes(days) - baseline.localUseMinutes,
        excludedPlaceIds: [...primaryVisited].filter((id) => !alternativeVisited.has(id)).sort(),
      },
      schedule: {
        kind: "observed_snapshot",
        // 한 쌍의 근거 중 더 오래된 확인일을 표시해야 최신처럼 과장하지 않는다.
        verifiedAt: [outbound.verifiedAt, inbound.verifiedAt].sort()[0],
        recheckRequired: true,
      },
    });
  }

  return alternatives.sort((a, b) =>
    b.days.flatMap((day) => day.items).length - a.days.flatMap((day) => day.items).length
    || a.warnings.length - b.warnings.length
    || a.metrics.totalTravelMinutes - b.metrics.totalTravelMinutes
    || a.id.localeCompare(b.id, "en"));
}
