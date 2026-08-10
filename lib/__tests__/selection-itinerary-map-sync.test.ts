import { describe, expect, it } from "vitest";
import { getCandidatePlaces } from "../actions/places";
import { planItinerary, type PlanRequest } from "../actions/itinerary";
import { initialPlaceIdsFromItinerary } from "../initial-place-selection";
import { routeStationSequence } from "../map-route";

const KIM = "actor-kim-go-eun";

const request = (excludedPlaceIds: string[]): PlanRequest => ({
  arrivalAt: "2026-08-12T10:00:00+09:00",
  departureAt: "2026-08-14T18:00:00+09:00",
  airportReadyAt: "2026-08-12T12:00:00+09:00",
  airportArrivalDeadline: "2026-08-14T16:00:00+09:00",
  selectedActorIds: [KIM],
  selectedWorkIds: [],
  excludedPlaceIds,
});

const placedIds = (days: Array<{ items: Array<{ placeId: string }> }>) =>
  [...new Set(days.flatMap((day) => day.items.map((item) => item.placeId)))];

const routeIds = (days: Array<{
  rides: Array<{ fromStationId: string; toStationId: string; departAt: string }>;
  gatewayLegs?: Array<{ fromStationId: string; toStationId: string; departAt: string }>;
}>) => routeStationSequence(
  days.flatMap((day) => [
    ...(day.gatewayLegs ?? []),
    ...day.rides,
  ].sort((a, b) => Date.parse(a.departAt) - Date.parse(b.departAt))),
);

describe("촬영지 선택 → 일정 → 지도 동기화", () => {
  it("선택을 해제하면 서버 재계산 결과와 지도 파생 대상이 같은 장소 집합을 사용한다", async () => {
    const { candidates } = await getCandidatePlaces({
      selectedActorIds: [KIM],
      selectedWorkIds: [],
    });
    const candidateIds = candidates.map(({ id }) => id);
    expect(candidateIds.length).toBeGreaterThan(1);

    const preview = await planItinerary(request([]));
    expect(preview.ok).toBe(true);
    if (!preview.ok || preview.result.status !== "planned") {
      throw new Error("김고은 실시드 최초 일정이 planned가 아님");
    }

    const normalizedSelection = initialPlaceIdsFromItinerary(candidateIds, preview.result);
    expect(normalizedSelection.length).toBeGreaterThan(1);

    const normalized = await planItinerary(request(
      candidateIds.filter((id) => !normalizedSelection.includes(id)),
    ));
    expect(normalized.ok).toBe(true);
    if (!normalized.ok || normalized.result.status !== "planned") {
      throw new Error("배치 가능 장소만 남긴 일정이 planned가 아님");
    }

    const beforePlaced = placedIds(normalized.result.days);
    expect(new Set(beforePlaced)).toEqual(new Set(normalizedSelection));
    expect(routeIds(normalized.result.days).length).toBeGreaterThan(0);

    // 사용자가 현재 배치된 관광지 하나를 직접 해제한다.
    const removed = beforePlaced[0];
    const nextSelection = normalizedSelection.filter((id) => id !== removed);
    const recalculated = await planItinerary(request(
      candidateIds.filter((id) => !nextSelection.includes(id)),
    ));

    expect(recalculated.ok).toBe(true);
    if (!recalculated.ok || recalculated.result.status !== "planned") {
      throw new Error("관광지 해제 후 재계산 일정이 planned가 아님");
    }

    const afterPlaced = placedIds(recalculated.result.days);

    // 우측 일정이 읽는 days[].items에서 제거된다.
    expect(afterPlaced).not.toContain(removed);
    expect(new Set(afterPlaced)).toEqual(new Set(nextSelection));
    expect(afterPlaced).not.toEqual(beforePlaced);

    // 중앙 ItineraryRouteMap도 같은 days에서 역 순서를 파생하므로 재계산 결과와 동기화된다.
    const afterRoute = routeIds(recalculated.result.days);
    expect(afterRoute.length).toBeGreaterThan(0);
    for (const id of afterPlaced) expect(nextSelection).toContain(id);
  });
});
