import { describe, expect, it } from "vitest";
import { routeStationSequence } from "../map-route";
import { planItinerary } from "../actions/itinerary";

describe("지도 동선 순서", () => {
  it("rides를 역 순서로 펴고 연속 중복만 접는다", () => {
    expect(
      routeStationSequence([
        { fromStationId: "a", toStationId: "b" },
        { fromStationId: "b", toStationId: "c" },
      ]),
    ).toEqual(["a", "b", "c"]);
  });

  it("왕복은 접지 않는다 — 되돌아오는 구간도 동선에 남는다", () => {
    expect(
      routeStationSequence([
        { fromStationId: "airport", toStationId: "seoul" },
        { fromStationId: "seoul", toStationId: "gangneung" },
        { fromStationId: "gangneung", toStationId: "seoul" },
        { fromStationId: "seoul", toStationId: "airport" },
      ]),
    ).toEqual(["airport", "seoul", "gangneung", "seoul", "airport"]);
  });

  it("환승으로 같은 역이 이어져도 한 번만 남긴다", () => {
    expect(
      routeStationSequence([
        { fromStationId: "a", toStationId: "b" },
        { fromStationId: "b", toStationId: "b" },
        { fromStationId: "b", toStationId: "c" },
      ]),
    ).toEqual(["a", "b", "c"]);
  });

  it("일정이 없으면 빈 동선이다", () => {
    expect(routeStationSequence([])).toEqual([]);
  });

  it("실제 일정의 동선이 rides 순서와 정확히 일치한다", async () => {
    const res = await planItinerary({
      arrivalAt: "2026-08-12T10:00:00+09:00",
      departureAt: "2026-08-14T18:00:00+09:00",
      airportReadyAt: "2026-08-12T12:00:00+09:00",
      airportArrivalDeadline: "2026-08-14T16:00:00+09:00",
      selectedActorIds: ["actor-kim-go-eun"],
      selectedWorkIds: [],
      excludedPlaceIds: [],
    });
    expect(res.ok).toBe(true);
    if (!res.ok || res.result.status !== "planned") return;

    const rides = res.result.days.flatMap((day) => day.rides);
    const sequence = routeStationSequence(rides);

    // 동선은 일정을 다시 해석하지 않는다 — 첫 역과 마지막 역이 rides의 양 끝과 같아야 한다
    expect(sequence[0]).toBe(rides[0].fromStationId);
    expect(sequence[sequence.length - 1]).toBe(rides[rides.length - 1].toStationId);
    // 모든 ride 구간이 동선 위에서 이웃으로 남는다
    for (const ride of rides) {
      if (ride.fromStationId === ride.toStationId) continue;
      const adjacent = sequence.some(
        (id, i) => id === ride.fromStationId && sequence[i + 1] === ride.toStationId,
      );
      expect(adjacent, `${ride.fromStationId} → ${ride.toStationId}`).toBe(true);
    }
  });
});
