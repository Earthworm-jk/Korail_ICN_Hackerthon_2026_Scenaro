import { describe, expect, it } from "vitest";
import { routePathKeys, routeStationSequence } from "../map-route";
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

  it("공항버스 GatewayLeg도 열차와 같은 역 시퀀스 계약으로 표현한다 (#58 통합)", () => {
    expect(routeStationSequence([
      { fromStationId: "airport", toStationId: "gangneung" },
      { fromStationId: "gangneung", toStationId: "seoul" },
      { fromStationId: "seoul", toStationId: "airport" },
    ])).toEqual(["airport", "gangneung", "seoul", "airport"]);
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

/**
 * 경로 path key (#118 P0-2 — 경로 재생성 애니메이션).
 *
 * 애니메이션 자체는 SVG SMIL이라 node 환경에서 검증할 수 없다. 대신 애니메이션이 **어디에
 * 걸리는지**를 정하는 규칙, 즉 "무엇이 다시 마운트되는가"를 고정한다.
 */
describe("경로 path key", () => {
  const rail = (d: string) => ({ kind: "rail", d });
  const curve = (d: string) => ({ kind: "curve", d });

  it("같은 입력이면 같은 key다", () => {
    const paths = [rail("M0,0L1,1"), curve("M1,1L2,2")];
    expect(routePathKeys(paths)).toEqual(routePathKeys(paths));
  });

  it("종류가 다르면 모양이 같아도 다른 key다", () => {
    const [a, b] = routePathKeys([rail("M0,0L1,1"), curve("M0,0L1,1")]);
    expect(a).not.toBe(b);
  });

  it("앞에 구간이 추가돼도 뒤 구간의 key는 그대로다 — 인덱스 key였다면 전부 바뀐다", () => {
    const before = routePathKeys([rail("A"), rail("B")]);
    const after = routePathKeys([rail("NEW"), rail("A"), rail("B")]);

    expect(after.slice(1)).toEqual(before);
    // 새로 들어온 구간만 before에 없다
    expect(after.filter((key) => !before.includes(key))).toHaveLength(1);
  });

  it("가운데 구간만 바뀌면 그 구간 key만 바뀐다", () => {
    const before = routePathKeys([rail("A"), rail("B"), rail("C")]);
    const after = routePathKeys([rail("A"), rail("B2"), rail("C")]);

    expect(after[0]).toBe(before[0]);
    expect(after[2]).toBe(before[2]);
    expect(after[1]).not.toBe(before[1]);
  });

  it("같은 모양이 두 번 나와도 key가 겹치지 않는다 — 왕복 구간", () => {
    const keys = routePathKeys([rail("A"), rail("B"), rail("A")]);
    expect(new Set(keys).size).toBe(3);
    // 첫 등장은 순번 없이 그대로 — 되돌아오는 구간만 순번을 받는다
    expect(keys[0]).not.toContain("#");
    expect(keys[2]).toContain("#");
  });

  it("빈 목록은 빈 목록이다", () => {
    expect(routePathKeys([])).toEqual([]);
  });
});
