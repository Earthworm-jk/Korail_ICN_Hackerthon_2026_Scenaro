import { describe, expect, it } from "vitest";
import {
  generateGatewayAlternatives,
  generateItinerary,
  generateItineraryWithGatewayAlternatives,
} from "../engine";
import { gatewayPlanningBaselineOf } from "../engine/gateway-baseline";
import { overnightSilenceFloorOf } from "../engine/planner";
import type { TripConstraints } from "../engine/types";
import { validateItinerary } from "../evaluation/validator";
import { loadRepositories, type Repositories } from "../repositories/json";

const localized = (ko: string, en = ko) => ({ ko, en });

function repositories(): Repositories {
  const repos: Repositories = {
    actors: [
      { id: "actor-a", name: localized("배우 A"), workIds: ["work-1", "work-2"] },
      { id: "actor-b", name: localized("배우 B"), workIds: ["work-3"] },
    ],
    works: [
      { id: "work-1", title: localized("작품 1") },
      { id: "work-2", title: localized("작품 2") },
      { id: "work-3", title: localized("작품 3") },
    ],
    stations: [
      {
        id: "station-seoul",
        name: localized("서울역"),
        lineType: "KTX",
        regionId: "seoul_metro",
        isGateway: true,
        gatewayPriority: 1,
      },
      { id: "station-gangneung", name: localized("강릉역"), lineType: "KTX", regionId: "gangwon" },
      { id: "station-jinbu", name: localized("진부역"), lineType: "KTX", regionId: "gangwon" },
    ],
    places: [
      place("place-selected", "work-1", "station-gangneung", { type: "always_open", source: "fixture", verifiedAt: "2026-08-08" }),
      place("place-actor-a", "work-2", "station-gangneung", {
        type: "hours", open: "12:00", close: "15:00", source: "fixture", verifiedAt: "2026-08-08",
      }),
      place("place-actor-b", "work-3", "station-jinbu", { type: "always_open", source: "fixture", verifiedAt: "2026-08-08" }),
      place("place-unverified", "work-1", "station-gangneung", { type: "unverified" }),
    ],
    trainLegs: [
      leg("101", "station-seoul", "station-gangneung", "2026-08-12T08:00:00+09:00", "2026-08-12T10:00:00+09:00"),
      leg("201", "station-gangneung", "station-jinbu", "2026-08-12T13:00:00+09:00", "2026-08-12T13:30:00+09:00"),
      leg("301", "station-jinbu", "station-seoul", "2026-08-12T16:00:00+09:00", "2026-08-12T18:00:00+09:00"),
      leg("302", "station-gangneung", "station-seoul", "2026-08-12T17:00:00+09:00", "2026-08-12T19:00:00+09:00"),
    ],
    gatewayLegs: [],
    flights: [],
    workPlaceRelations: [],
  };
  repos.workPlaceRelations = strictRelationsFor(repos.places);
  return repos;
}

function strictRelationsFor(places: Repositories["places"]): Repositories["workPlaceRelations"] {
  const actorsByWork: Record<string, string[]> = {
    "work-1": ["actor-a"],
    "work-2": ["actor-a"],
    "work-3": ["actor-b"],
  };
  return places.flatMap((place) => place.workIds.map((workId) => ({
    workId,
    placeId: place.id,
    featuredActorIds: actorsByWork[workId] ?? [],
    actorPresenceReviewed: true as const,
    sourceUrls: ["https://example.com/relation"],
    verifiedAt: "2026-08-09",
    reviewed: true,
  })));
}

function replacePlaces(repos: Repositories, places: Repositories["places"]): void {
  repos.places = places;
  repos.workPlaceRelations = strictRelationsFor(places);
}

function place(
  id: string,
  workId: string,
  nearestStationId: string,
  openingHours: Repositories["places"][number]["openingHours"],
): Repositories["places"][number] {
  return {
    id,
    name: localized(id),
    workIds: [workId],
    nearestStationId,
    accessEstimate: { minutes: 10, source: "fixture", verifiedAt: "2026-08-08" },
    openingHours,
    stayMinutes: 30,
    verificationLevel: "원본확인",
    officialSourceCount: 1,
    reasonText: localized("검증된 촬영지"),
  };
}

function leg(
  trainNo: string,
  fromStationId: string,
  toStationId: string,
  departAt: string,
  arriveAt: string,
): Repositories["trainLegs"][number] {
  return { trainNo, fromStationId, toStationId, departAt, arriveAt };
}

function gatewayLeg(
  id: string,
  routeId: string,
  direction: "outbound" | "inbound",
  fromStationId: string,
  toStationId: string,
  departAt: string,
  arriveAt: string,
): Repositories["gatewayLegs"][number] {
  return {
    id,
    routeId,
    direction,
    mode: "airport_bus",
    fromStationId,
    toStationId,
    fromName: localized(fromStationId),
    toName: localized(toStationId),
    departAt,
    arriveAt,
    serviceName: localized("검증 공항버스"),
    operator: localized("검증 운수사"),
    sourceUrls: ["https://example.com/official-bus"],
    verifiedAt: "2026-08-09",
    scheduleKind: "observed_snapshot",
    recheckRequired: true,
  };
}

function kstIso(ms: number): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const kst = new Date(ms + 9 * 3_600_000);
  return `${kst.getUTCFullYear()}-${p(kst.getUTCMonth() + 1)}-${p(kst.getUTCDate())}T${p(kst.getUTCHours())}:${p(kst.getUTCMinutes())}:${p(kst.getUTCSeconds())}+09:00`;
}
const addMinutes = (iso: string, minutes: number) => kstIso(Date.parse(iso) + minutes * 60_000);

// #14 차단 2(절대 시각 전환) 후에도 기존 시나리오 의미(도착 +60분 출발, 출국 -120분 마감)를
// 보존하기 위해 항공편 시각에서 경계를 파생한다 — departureAt만 바꾸는 테스트도 마감이 따라온다
function constraints(
  { exitOffsetMin = 60, departureBufferMin = 120, ...overrides }:
    Partial<TripConstraints> & { exitOffsetMin?: number; departureBufferMin?: number } = {},
): TripConstraints {
  const arrivalAt = overrides.arrivalAt ?? "2026-08-12T06:00:00+09:00";
  const departureAt = overrides.departureAt ?? "2026-08-12T22:00:00+09:00";
  return {
    arrivalAt,
    departureAt,
    airportReadyAt: addMinutes(arrivalAt, exitOffsetMin),
    airportArrivalDeadline: addMinutes(departureAt, -departureBufferMin),
    selectedActorIds: ["actor-a", "actor-b"],
    selectedWorkIds: ["work-1"],
    excludedPlaceIds: [],
    maxPlacesPerDay: 3,
    dailySlackMinutes: 60,
    ...overrides,
  };
}

function alternativeRepositories(fastHours: Repositories["places"][number]["openingHours"]): Repositories {
  const repos = repositories();
  repos.stations.push(
    { id: "station-mid", name: localized("환승역"), lineType: "KTX", regionId: "seoul_metro" },
    { id: "station-fast", name: localized("빠른역"), lineType: "KTX", regionId: "honam" },
    { id: "station-direct", name: localized("직행역"), lineType: "KTX", regionId: "yeongnam" },
  );
  replacePlaces(repos, [
    place("place-fast", "work-1", "station-fast", fastHours),
    place("place-direct", "work-1", "station-direct", {
      type: "always_open", source: "fixture", verifiedAt: "2026-08-08",
    }),
  ]);
  repos.trainLegs = [
    leg("FAST-A", "station-seoul", "station-mid", "2026-08-12T08:00:00+09:00", "2026-08-12T08:20:00+09:00"),
    leg("FAST-B", "station-mid", "station-fast", "2026-08-12T08:40:00+09:00", "2026-08-12T09:00:00+09:00"),
    leg("FAST-C", "station-fast", "station-mid", "2026-08-12T10:40:00+09:00", "2026-08-12T11:00:00+09:00"),
    leg("FAST-D", "station-mid", "station-seoul", "2026-08-12T11:20:00+09:00", "2026-08-12T11:40:00+09:00"),
    leg("DIRECT-A", "station-seoul", "station-direct", "2026-08-12T08:00:00+09:00", "2026-08-12T09:10:00+09:00"),
    leg("DIRECT-B", "station-direct", "station-seoul", "2026-08-12T10:40:00+09:00", "2026-08-12T11:50:00+09:00"),
  ];
  return repos;
}

const alternativeConstraints = (): TripConstraints => constraints({
  departureAt: "2026-08-12T15:00:00+09:00",
  airportArrivalDeadline: "2026-08-12T13:00:00+09:00",
  selectedActorIds: ["actor-a"],
  selectedWorkIds: ["work-1"],
  maxPlacesPerDay: 1,
  dailySlackMinutes: 0,
});

describe("generateItinerary", () => {
  it("같은 선택 충족·방문 수에서 환승이 실제로 적은 검증 전체 일정만 대안으로 낸다 (#198)", () => {
    const repos = alternativeRepositories({
      type: "always_open", source: "fixture", verifiedAt: "2026-08-08",
    });
    const input = alternativeConstraints();
    const result = generateItinerary(input, repos);

    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.days.flatMap((day) => day.items.map(({ placeId }) => placeId)))
      .toEqual(["place-fast"]);
    expect(result.verifiedAlternatives).toHaveLength(1);
    const alternative = result.verifiedAlternatives?.[0];
    expect(alternative?.improvements).toEqual(["fewer_transfers"]);
    expect(alternative?.changes).toEqual({
      removedPlaceIds: ["place-fast"],
      addedPlaceIds: ["place-direct"],
    });
    expect(alternative?.deltas).toEqual({
      totalTravelMinutes: 60,
      transferCount: -2,
      verifiedHoursMismatchCount: 0,
      preferredDateMismatchCount: 0,
      preferredOrderMismatchCount: 0,
      warningCount: 0,
    });
    expect(alternative?.days.flatMap((day) => day.items.map(({ placeId }) => placeId)))
      .toEqual(["place-direct"]);
    expect(alternative?.selectionGroups.covered).toEqual(result.selectionGroups.covered);
    expect(alternative?.comparisonKeys.selectedUnionPlaceCount)
      .toBe(result.comparisonKeys.selectedUnionPlaceCount);

    const alternativeResult = alternative && {
      ...result,
      days: alternative.days,
      rejectedPlaces: alternative.rejectedPlaces,
      warnings: alternative.warnings,
      selectionGroups: alternative.selectionGroups,
      comparisonKeys: alternative.comparisonKeys,
      metrics: alternative.metrics,
      verifiedAlternatives: undefined,
    };
    expect(alternativeResult ? validateItinerary(alternativeResult, input, repos) : ["missing"])
      .toEqual([]);
    expect(generateItinerary(input, repos)).toEqual(result);
  });

  it("검증 충돌 때문에 추천에서 밀렸어도 실제 이동이 짧을 때만 더 빠름으로 표시한다 (#198)", () => {
    const repos = alternativeRepositories({
      type: "hours", open: "12:30", close: "13:00", source: "fixture", verifiedAt: "2026-08-08",
    });
    const result = generateItinerary(alternativeConstraints(), repos);

    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.days.flatMap((day) => day.items.map(({ placeId }) => placeId)))
      .toEqual(["place-direct"]);
    expect(result.verifiedAlternatives).toHaveLength(1);
    expect(result.verifiedAlternatives?.[0]).toMatchObject({
      improvements: ["faster"],
      changes: {
        removedPlaceIds: ["place-direct"],
        addedPlaceIds: ["place-fast"],
      },
      deltas: {
        totalTravelMinutes: -60,
        transferCount: 2,
        verifiedHoursMismatchCount: 1,
        preferredDateMismatchCount: 0,
        preferredOrderMismatchCount: 0,
        warningCount: 1,
      },
      warnings: [{
        code: "ACTIVITY_WINDOW_MISMATCH",
        placeId: "place-fast",
        detail: "OUTSIDE_VERIFIED_HOURS",
      }],
    });
  });
  it("공항버스는 TrainLeg로 가장하지 않고 전체 일정 대안으로 생성된다 (#58)", () => {
    const repos = repositories();
    repos.stations.push({
      id: "station-airport",
      name: localized("공항"),
      lineType: "AREX",
      regionId: "seoul_metro",
      isAirport: true,
    });
    repos.trainLegs = [
      leg("KTX-OUT", "station-seoul", "station-gangneung", "2026-08-12T13:00:00+09:00", "2026-08-12T15:00:00+09:00"),
      leg("KTX-IN", "station-gangneung", "station-seoul", "2026-08-14T11:00:00+09:00", "2026-08-14T13:00:00+09:00"),
    ];
    repos.gatewayLegs = [
      gatewayLeg("bus-out", "route-gangwon", "outbound", "station-airport", "station-gangneung", "2026-08-12T12:00:00+09:00", "2026-08-12T15:55:00+09:00"),
      gatewayLeg("bus-in", "route-gangwon", "inbound", "station-gangneung", "station-airport", "2026-08-14T12:00:00+09:00", "2026-08-14T15:50:00+09:00"),
    ];

    const result = generateItineraryWithGatewayAlternatives(constraints({
      arrivalAt: "2026-08-12T10:00:00+09:00",
      airportReadyAt: "2026-08-12T12:00:00+09:00",
      departureAt: "2026-08-14T18:00:00+09:00",
      airportArrivalDeadline: "2026-08-14T16:00:00+09:00",
      airportStationId: "station-seoul", // 추천 철도형 fixture의 출발점
      selectedActorIds: ["actor-a"],
    }), repos);

    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.gatewayAlternatives).toHaveLength(1);
    const alternative = result.gatewayAlternatives?.[0];
    expect(alternative?.kind).toBe("gateway_bus");
    expect(alternative?.days.flatMap((day) => day.gatewayLegs ?? []).map(({ id }) => id))
      .toEqual(["bus-out", "bus-in"]);
    expect(alternative?.days.flatMap((day) => day.rides).some(({ trainNo }) => trainNo.includes("bus")))
      .toBe(false);
    expect(alternative?.days.flatMap((day) => day.regionWindows)
      .some(({ startBoundary }) => startBoundary === "GATEWAY_ARRIVAL")).toBe(true);
    expect(alternative?.schedule).toEqual({
      kind: "observed_snapshot",
      verifiedAt: "2026-08-09",
      recheckRequired: true,
    });
  });

  it("귀국 마감 뒤 도착하는 공항버스 대안은 생성하지 않는다 (#58)", () => {
    const repos = repositories();
    repos.stations.push({
      id: "station-airport", name: localized("공항"), lineType: "AREX",
      regionId: "seoul_metro", isAirport: true,
    });
    repos.gatewayLegs = [
      gatewayLeg("bus-out", "route-gangwon", "outbound", "station-airport", "station-gangneung", "2026-08-12T07:00:00+09:00", "2026-08-12T10:00:00+09:00"),
      gatewayLeg("bus-in", "route-gangwon", "inbound", "station-gangneung", "station-airport", "2026-08-12T17:00:00+09:00", "2026-08-12T21:00:00+09:00"),
    ];
    const result = generateItineraryWithGatewayAlternatives(
      constraints({ airportStationId: "station-seoul" }), repos,
    );
    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.gatewayAlternatives).toBeUndefined();
  });

  it("합성 두 번째 목적지도 데이터 추가만으로 직행 대안이 생성된다 (#58 목적지 중립)", () => {
    const repos = repositories();
    repos.stations.push(
      { id: "station-airport", name: localized("공항"), lineType: "AREX", regionId: "seoul_metro", isAirport: true },
      { id: "station-synthetic", name: localized("합성 목적지"), lineType: "KTX", regionId: "yeongnam" },
    );
    replacePlaces(repos, [place("place-synthetic", "work-1", "station-synthetic", {
      type: "always_open", source: "fixture", verifiedAt: "2026-08-09",
    })]);
    repos.trainLegs = [
      leg("SYN-OUT", "station-seoul", "station-synthetic", "2026-08-12T08:00:00+09:00", "2026-08-12T10:00:00+09:00"),
      leg("SYN-IN", "station-synthetic", "station-seoul", "2026-08-12T17:00:00+09:00", "2026-08-12T19:00:00+09:00"),
    ];
    repos.gatewayLegs = [
      gatewayLeg("synthetic-out", "route-synthetic", "outbound", "station-airport", "station-synthetic", "2026-08-12T07:00:00+09:00", "2026-08-12T09:30:00+09:00"),
      gatewayLeg("synthetic-in", "route-synthetic", "inbound", "station-synthetic", "station-airport", "2026-08-12T17:30:00+09:00", "2026-08-12T19:30:00+09:00"),
    ];

    const result = generateItineraryWithGatewayAlternatives(constraints({
      airportStationId: "station-seoul",
      selectedActorIds: [],
      departureAt: "2026-08-12T22:00:00+09:00",
      airportArrivalDeadline: "2026-08-12T20:00:00+09:00",
    }), repos);
    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.gatewayAlternatives?.[0]?.routeId).toBe("route-synthetic");
  });

  it("결정적 왕복 일정 — 미확인 장소는 감점 없이 경고와 함께 배치된다 (#43, #198)", () => {
    const result = generateItinerary(constraints(), repositories());
    const repeated = generateItinerary(constraints(), repositories());

    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(repeated).toEqual(result);
    const placed = result.days.flatMap((day) => day.items.map((item) => item.placeId));
    expect(placed).toContain("place-unverified");
    expect(result.comparisonKeys).toMatchObject({
      selectionGroupCoverageCount: 2,
      selectedUnionPlaceCount: 3,
    });
    expect(result.selectionGroups).toEqual({
      requested: ["actor", "work"],
      covered: ["actor", "work"],
      uncovered: [],
    });
    expect(result.comparisonKeys.verifiedHoursMismatchCount).toBe(0);
    expect(result.warnings).toContainEqual({
      code: "ACTIVITY_WINDOW_MISMATCH",
      placeId: "place-unverified",
      detail: "UNVERIFIED_HOURS",
    });
  });

  /**
   * 반대 분기 — 시간표에 연결편이 아예 없는 장소는 조합과 무관하게 불가능하므로
   * `TRAIN_UNAVAILABLE`이 그대로 남아야 한다. 이 둘이 한 코드로 뭉치면 사용자는
   * 고칠 수 있는 문제(선택 줄이기)와 못 고치는 문제를 구분할 수 없다.
   */
  it("연결편이 없는 장소는 밀린 것이 아니라 TRAIN_UNAVAILABLE로 남는다 (#84 §2)", () => {
    const repos = repositories();
    repos.stations.push({
      id: "station-isolated", name: localized("고립역"), lineType: "KTX", regionId: "gangwon",
    });
    repos.places.push(
      place("place-isolated", "work-1", "station-isolated",
        { type: "always_open", source: "fixture", verifiedAt: "2026-08-08" }),
    );
    repos.workPlaceRelations = strictRelationsFor(repos.places);

    const result = generateItinerary(constraints(), repos);
    expect(result.status).toBe("planned");
    expect(result.rejectedPlaces).toContainEqual({
      code: "TRAIN_UNAVAILABLE", placeId: "place-isolated",
    });

    // 근거 — 이 장소만 남겨도 일정이 서지 않는다
    const alone = generateItinerary(
      { ...constraints(), excludedPlaceIds: ["place-selected", "place-actor-a", "place-actor-b", "place-unverified"] },
      repos,
    );
    expect(alone.status).toBe("empty");
  });

  it("사용자가 제외한 장소는 일정과 자동 제외 사유에서 모두 뺀다", () => {
    const result = generateItinerary(
      constraints({ excludedPlaceIds: ["place-actor-b"] }),
      repositories(),
    );

    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.days.flatMap((day) => day.items.map((item) => item.placeId)).sort())
      .toEqual(["place-actor-a", "place-selected", "place-unverified"]);
    expect(result.rejectedPlaces.some((reason) =>
      reason.placeId === "place-actor-b")).toBe(false);
  });

  it("복합 선택은 작품 장소 수를 독점하지 않고 배우·작품 두 그룹을 먼저 충족한다 (#3)", () => {
    const repos = repositories();
    replacePlaces(repos, [
      place("work-a", "work-1", "station-seoul", { type: "always_open", source: "fixture", verifiedAt: "2026-08-09" }),
      place("work-b", "work-1", "station-seoul", { type: "always_open", source: "fixture", verifiedAt: "2026-08-09" }),
      place("work-c", "work-1", "station-seoul", { type: "always_open", source: "fixture", verifiedAt: "2026-08-09" }),
      place("actor-only", "work-2", "station-seoul", { type: "always_open", source: "fixture", verifiedAt: "2026-08-09" }),
    ]);
    repos.workPlaceRelations = [
      ...["work-a", "work-b", "work-c"].map((placeId) => ({
        workId: "work-1", placeId, featuredActorIds: [], actorPresenceReviewed: true as const,
        sourceUrls: ["https://example.com/work"], verifiedAt: "2026-08-09", reviewed: true,
      })),
      {
        workId: "work-2", placeId: "actor-only", featuredActorIds: ["actor-a"],
        actorPresenceReviewed: true, sourceUrls: ["https://example.com/actor"],
        verifiedAt: "2026-08-09", reviewed: true,
      },
    ];

    const result = generateItinerary(constraints({
      selectedActorIds: ["actor-a"],
      selectedWorkIds: ["work-1"],
      maxPlacesPerDay: 2,
    }), repos);

    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    const visited = result.days.flatMap(({ items }) => items.map(({ placeId }) => placeId));
    expect(visited).toContain("actor-only");
    expect(visited.filter((id) => id.startsWith("work-"))).toHaveLength(1);
    expect(result.comparisonKeys.selectionGroupCoverageCount).toBe(2);
    expect(result.selectionGroups).toEqual({
      requested: ["actor", "work"], covered: ["actor", "work"], uncovered: [],
    });
  });

  it("엄격 배우 후보가 없으면 작품 일정은 유지하고 미반영 배우 그룹 사유를 반환한다 (#3·#51)", () => {
    const repos = repositories();
    repos.workPlaceRelations = repos.workPlaceRelations.map((relation) => ({
      ...relation,
      featuredActorIds: relation.featuredActorIds?.filter((id) => id !== "actor-b"),
    }));
    const result = generateItinerary(constraints({
      selectedActorIds: ["actor-b"],
      selectedWorkIds: ["work-1"],
    }), repos);

    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.selectionGroups).toEqual({
      requested: ["actor", "work"],
      covered: ["work"],
      uncovered: [{ group: "actor", reasons: ["NO_STRICT_CANDIDATES"] }],
    });
  });



  it("하루 장소 수를 넘기지 않고 다음 날로 방문을 넘긴다", () => {
    const repos = repositories();
    repos.places = repos.places.filter(({ id }) =>
      id === "place-selected" || id === "place-actor-a");
    repos.trainLegs.push(leg(
      "303",
      "station-gangneung",
      "station-seoul",
      "2026-08-13T17:00:00+09:00",
      "2026-08-13T19:00:00+09:00",
    ));

    const result = generateItinerary(constraints({
      departureAt: "2026-08-13T22:00:00+09:00",
      maxPlacesPerDay: 1,
    }), repos);

    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.days.map(({ date, items }) => ({ date, placeCount: items.length })))
      .toEqual([
        { date: "2026-08-12", placeCount: 1 },
        { date: "2026-08-13", placeCount: 1 },
      ]);
    expect(result.days.flatMap(({ items }) => items.map(({ placeId }) => placeId)).sort())
      .toEqual(["place-actor-a", "place-selected"]);
  });

  it("열차는 탈 수 있어도 출국 안전 버퍼를 침범하면 마감 초과를 반환한다", () => {
    const result = generateItinerary(constraints({
      departureAt: "2026-08-12T19:30:00+09:00",
      departureBufferMin: 120,
    }), repositories());

    expect(result.status).toBe("empty");
    if (result.status !== "empty") return;
    expect(result.rejectedPlaces).toContainEqual({
      code: "DEPARTURE_DEADLINE_EXCEEDED",
      placeId: "place-selected",
    });
  });

  it("실스냅샷의 동일 열차번호 서울→진부→강릉 연속 구간도 환승 0으로 계산한다 (#56)", () => {
    // PR #60 비차단 리뷰 반영: 합성 fixture가 아니라 실제 data/train-snapshot.json의
    // 동일 열차번호 연속 leg로 환승 규칙을 고정해 데이터 회귀를 방어한다.
    const real = loadRepositories();
    const chains = real.trainLegs.flatMap((first) =>
      first.fromStationId === "station-seoul" && first.toStationId === "station-jinbu"
        ? real.trainLegs
          .filter((second) => second.trainNo === first.trainNo
            && second.fromStationId === "station-jinbu"
            && second.toStationId === "station-gangneung"
            && Date.parse(second.departAt) >= Date.parse(first.arriveAt)
            && Date.parse(second.departAt) - Date.parse(first.arriveAt) <= 60 * 60_000)
          .map((second) => [first, second] as const)
        : []);
    expect(chains.length).toBeGreaterThan(0); // 진부 경유 동일 열차가 실데이터에 존재한다
    const [first, second] = chains[0];
    const returnLeg = real.trainLegs.find((candidate) =>
      candidate.fromStationId === "station-gangneung"
      && candidate.toStationId === "station-seoul"
      && Date.parse(candidate.departAt) >= Date.parse(second.arriveAt) + 4 * 60 * 60_000);
    expect(returnLeg).toBeDefined();

    const repos = repositories();
    repos.trainLegs = [first, second, returnLeg as Repositories["trainLegs"][number]];
    const result = generateItinerary(constraints({
      arrivalAt: "2026-08-12T04:00:00+09:00", // 실스냅샷 첫 진부 경유편(05:40 출발)보다 이른 준비 시각
      selectedActorIds: [],
      selectedWorkIds: ["work-1"],
      excludedPlaceIds: ["place-unverified"],
    }), repos);

    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.days.flatMap((day) => day.rides.map((ride) => ride.trainNo)))
      .toEqual([first.trainNo, second.trainNo, returnLeg?.trainNo]);
    expect(result.metrics.transferCount).toBe(0);
  });

  it("실스냅샷 김고은 데모에서 철도 추천과 강릉 직행버스 전체 대안이 함께 생성된다 (#58 E2E)", () => {
    const real = loadRepositories();
    const input = constraints({
      arrivalAt: "2026-08-12T10:00:00+09:00",
      airportReadyAt: "2026-08-12T12:00:00+09:00",
      departureAt: "2026-08-14T18:00:00+09:00",
      airportArrivalDeadline: "2026-08-14T16:00:00+09:00",
      selectedActorIds: ["actor-kim-go-eun"],
      selectedWorkIds: [],
      excludedPlaceIds: [],
      maxPlacesPerDay: 3,
      dailySlackMinutes: 120,
    });
    const result = generateItineraryWithGatewayAlternatives(input, real);

    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.gatewayAlternatives?.some(({ routeId }) =>
      routeId === "airport-bus-icn-t1-gangneung")).toBe(true);
    const direct = result.gatewayAlternatives?.find(({ routeId }) =>
      routeId === "airport-bus-icn-t1-gangneung");
    expect(direct?.days.flatMap((day) => day.gatewayLegs ?? []).map(({ id }) => id))
      .toEqual([
        "airport-bus-icn-t1-gangneung-20260812-1200",
        "airport-bus-gangneung-icn-t1-20260814-1200",
      ]);
    expect(direct?.metrics.departureSlackMinutes).toBe(130);
    const baseline = gatewayPlanningBaselineOf(result);
    expect(baseline).not.toBeNull();
    if (baseline) {
      expect(generateGatewayAlternatives(input, real, baseline))
        .toEqual(result.gatewayAlternatives);
    }
  });

  it("같은 열차 번호의 연속 구간은 환승으로 세지 않는다", () => {
    const repos = repositories();
    repos.trainLegs[1] = { ...repos.trainLegs[1], trainNo: "101" };
    const result = generateItinerary(constraints({
      selectedActorIds: [],
      selectedWorkIds: ["work-3"],
    }), repos);

    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.metrics.transferCount).toBe(0);
  });

  it("다른 열차로 갈아탈 때 최소 15분 환승 간격을 지킨다", () => {
    const repos = repositories();
    repos.trainLegs.push(leg(
      "202",
      "station-gangneung",
      "station-jinbu",
      "2026-08-12T10:05:00+09:00",
      "2026-08-12T10:35:00+09:00",
    ));
    const result = generateItinerary(constraints({
      selectedActorIds: [],
      selectedWorkIds: ["work-3"],
    }), repos);

    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.days.flatMap((day) => day.rides.map((ride) => ride.trainNo)))
      .not.toContain("202");
  });

  it("공항철도 구간을 입국 가능 시각과 출국 역산에 포함한다", () => {
    const repos = repositories();
    repos.stations.push({
      id: "station-icn-t1",
      name: localized("인천공항1터미널역"),
      lineType: "AREX",
      regionId: "seoul_metro",
      isAirport: true,
    });
    repos.trainLegs.push(
      leg(
        "AREX-OUT",
        "station-icn-t1",
        "station-seoul",
        "2026-08-12T07:05:00+09:00",
        "2026-08-12T07:40:00+09:00",
      ),
      leg(
        "AREX-BACK",
        "station-seoul",
        "station-icn-t1",
        "2026-08-12T19:20:00+09:00",
        "2026-08-12T20:00:00+09:00",
      ),
    );

    const result = generateItinerary(constraints({
      airportStationId: "station-icn-t1",
      selectedActorIds: [],
      selectedWorkIds: ["work-1"],
    }), repos);

    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    const trainNumbers = result.days.flatMap((day) => day.rides.map((ride) => ride.trainNo));
    expect(trainNumbers.at(0)).toBe("AREX-OUT");
    expect(trainNumbers.at(-1)).toBe("AREX-BACK");
  });

  it("일반 여유는 출국 전 잔여시간이 아니라 방문일별 가용시간으로 판정한다", () => {
    const result = generateItinerary(constraints({
      selectedActorIds: [],
      selectedWorkIds: ["work-1"],
      dailySlackMinutes: 1_000,
    }), repositories());

    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.comparisonKeys.slackSatisfied).toBe(false);
  });

  it("보수 버퍼로 검증 시간 안 배치가 불가한 장소도 제외하지 않고 상세 경고와 함께 배치한다 (#43)", () => {
    const repos = repositories();
    repos.places = repos.places.filter(({ id }) => id === "place-selected");
    repos.places[0].openingHours = {
      type: "hours",
      open: "10:10",
      close: "10:50",
      source: "fixture",
      verifiedAt: "2026-08-08",
    };

    const result = generateItinerary(constraints({
      selectedActorIds: [],
      selectedWorkIds: ["work-1"],
    }), repos);

    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.days.flatMap((day) => day.items.map((item) => item.placeId)))
      .toEqual(["place-selected"]);
    // #5 판정식 유지 — 버퍼 없이는 가능했으므로 상세는 CONSERVATIVE_BUFFER_MISMATCH
    expect(result.warnings).toEqual([
      { code: "ACTIVITY_WINDOW_MISMATCH", placeId: "place-selected", detail: "CONSERVATIVE_BUFFER_MISMATCH" },
    ]);
    expect(result.rejectedPlaces).toEqual([]);
    expect(result.comparisonKeys.verifiedHoursMismatchCount).toBe(0);
  });

  it("미확인 운영시간은 비교에서 제외하고 경고만 표시한다 (#198)", () => {
    const repos = repositories();
    replacePlaces(repos, [
      place("place-a-unverified", "work-1", "station-gangneung", { type: "unverified" }),
      place("place-z-clean", "work-1", "station-gangneung", { type: "always_open", source: "fixture", verifiedAt: "2026-08-08" }),
    ]);
    // 당일 일정 + 하루 1곳. 미확인을 감점하면 clean이 이기지만, 제외하면 안정 ID가 승부를 가른다.
    const result = generateItinerary(constraints({
      selectedActorIds: [],
      selectedWorkIds: ["work-1"],
      maxPlacesPerDay: 1,
    }), repos);

    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.days.flatMap((day) => day.items.map((item) => item.placeId)))
      .toEqual(["place-a-unverified"]);
    expect(result.comparisonKeys.verifiedHoursMismatchCount).toBe(0);
    expect(result.warnings).toEqual([
      { code: "ACTIVITY_WINDOW_MISMATCH", placeId: "place-a-unverified", detail: "UNVERIFIED_HOURS" },
    ]);
  });

  it("검증된 운영시간 밖 배치는 같은 방문 수의 미확인 배치보다 뒤로 보낸다 (#198)", () => {
    const repos = repositories();
    replacePlaces(repos, [
      place("place-a-outside", "work-1", "station-gangneung", {
        type: "hours", open: "01:00", close: "02:00", source: "fixture", verifiedAt: "2026-08-08",
      }),
      place("place-z-unverified", "work-1", "station-gangneung", { type: "unverified" }),
    ]);
    const result = generateItinerary(constraints({
      selectedActorIds: [], selectedWorkIds: ["work-1"], maxPlacesPerDay: 1,
    }), repos);

    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.days.flatMap((day) => day.items.map((item) => item.placeId)))
      .toEqual(["place-z-unverified"]);
    expect(result.comparisonKeys.verifiedHoursMismatchCount).toBe(0);
    expect(result.warnings[0]?.detail).toBe("UNVERIFIED_HOURS");
  });

  it("배치된 미확인·시간 밖 방문의 경고 누락은 0건이다 (#43 수용 기준)", () => {
    const result = generateItinerary(constraints(), repositories());

    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    const warned = new Set(result.warnings.map(({ placeId }) => placeId));
    for (const item of result.days.flatMap(({ items }) => items)) {
      const source = repositories().places.find(({ id }) => id === item.placeId);
      if (source?.openingHours.type === "unverified") {
        expect(warned.has(item.placeId), item.placeId).toBe(true);
      }
    }
    expect(result.comparisonKeys.verifiedHoursMismatchCount).toBe(
      result.warnings.filter(({ detail }) => detail === "OUTSIDE_VERIFIED_HOURS").length,
    );
  });

  it("귀환 열차가 없으면 열차 없음 사유를 반환한다", () => {
    const repos = repositories();
    repos.places = repos.places.filter(({ id }) => id === "place-selected");
    repos.trainLegs = repos.trainLegs.filter(({ fromStationId }) =>
      fromStationId === "station-seoul");

    const result = generateItinerary(constraints({
      selectedActorIds: [],
      selectedWorkIds: ["work-1"],
    }), repos);

    expect(result).toEqual({
      status: "empty",
      days: [],
      rejectedPlaces: [{ code: "TRAIN_UNAVAILABLE", placeId: "place-selected" }],
      warnings: [],
      selectionGroups: {
        requested: ["work"],
        covered: [],
        uncovered: [{ group: "work", reasons: ["TRAIN_UNAVAILABLE"] }],
      },
    });
  });

  it("시드 상한 15곳에서도 2초 안에 결정적 결과를 만든다", () => {
    const repos = repositories();
    replacePlaces(repos, Array.from({ length: 15 }, (_, index) => ({
      ...repos.places[0],
      id: `place-${String(index + 1).padStart(2, "0")}`,
      stayMinutes: 10,
    })));
    repos.trainLegs.push(leg(
      "399",
      "station-gangneung",
      "station-seoul",
      "2026-08-14T18:00:00+09:00",
      "2026-08-14T20:00:00+09:00",
    ));
    const startedAt = performance.now();
    const result = generateItinerary(constraints({
      departureAt: "2026-08-14T23:00:00+09:00",
      selectedActorIds: [],
      selectedWorkIds: ["work-1"],
      maxPlacesPerDay: 5,
    }), repos);

    expect(performance.now() - startedAt).toBeLessThan(2_000);
    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.comparisonKeys.selectedUnionPlaceCount).toBe(15);
  });

  // PR #45 리뷰: 출력 창(09:00-21:00)과 실제 배치의 정합 — 활동 경계 회귀
  it("전날 저녁 도착한 상시 개방 장소는 자정이 아니라 다음 날 활동 시작 이후에 배치된다", () => {
    const repos = repositories();
    repos.places = repos.places.filter(({ id }) => id === "place-selected");
    repos.trainLegs = [
      leg("901", "station-seoul", "station-gangneung", "2026-08-12T19:30:00+09:00", "2026-08-12T21:30:00+09:00"),
      leg("902", "station-gangneung", "station-seoul", "2026-08-13T17:00:00+09:00", "2026-08-13T19:00:00+09:00"),
    ];
    const result = generateItinerary(constraints({
      arrivalAt: "2026-08-12T18:00:00+09:00",
      departureAt: "2026-08-13T22:00:00+09:00",
      selectedActorIds: [],
      selectedWorkIds: ["work-1"],
    }), repos);

    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    // 21:30 역 도착 → 당일(21:00 경계 초과)·자정 배치 금지 → 다음 날 09:00 + 접근 30분 = 09:30 KST
    expect(result.days.flatMap(({ items }) => items.map(({ arriveAt }) => arriveAt)))
      .toEqual(["2026-08-13T00:30:00.000Z"]);
  });

  it("접근·체류·역 복귀가 21:00을 넘는 후보는 배치되지 않는다", () => {
    const repos = repositories();
    repos.places = repos.places.filter(({ id }) => id === "place-selected");
    repos.trainLegs = [
      leg("901", "station-seoul", "station-gangneung", "2026-08-12T19:30:00+09:00", "2026-08-12T20:15:00+09:00"),
      leg("902", "station-gangneung", "station-seoul", "2026-08-12T21:10:00+09:00", "2026-08-12T22:50:00+09:00"),
    ];
    // 20:15 도착 → 방문 시 역 복귀 21:45 > 21:00, 다음 날은 출국 마감(23:00) 밖
    const result = generateItinerary(constraints({
      arrivalAt: "2026-08-12T18:00:00+09:00",
      departureAt: "2026-08-13T01:00:00+09:00",
      selectedActorIds: [],
      selectedWorkIds: ["work-1"],
    }), repos);

    expect(result.status).toBe("empty");
    if (result.status !== "empty") return;
    expect(result.rejectedPlaces).toContainEqual({
      code: "DEPARTURE_DEADLINE_EXCEEDED",
      placeId: "place-selected",
    });
  });

  it("배치된 모든 방문의 지역 활동 구간(접근 포함)이 해당 날짜 09:00-21:00 안에 있다", () => {
    const result = generateItinerary(constraints(), repositories());

    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    const kstMinutes = (iso: string) => {
      const kst = new Date(Date.parse(iso) + 9 * 3_600_000);
      return kst.getUTCHours() * 60 + kst.getUTCMinutes();
    };
    for (const item of result.days.flatMap(({ items }) => items)) {
      const accessMs = 30 * 60_000; // fixture: 접근 10분 + 보수 버퍼 20분
      expect(kstMinutes(new Date(Date.parse(item.arriveAt) - accessMs).toISOString()))
        .toBeGreaterThanOrEqual(9 * 60);
      expect(kstMinutes(new Date(Date.parse(item.departAt) + accessMs).toISOString()))
        .toBeLessThanOrEqual(21 * 60);
    }
  });

  it("배우와 작품이 모두 비어 있는 입력은 계산 전에 거절한다", () => {
    expect(() => generateItinerary(
      constraints({ selectedActorIds: [], selectedWorkIds: [] }),
      repositories(),
    )).toThrow();
  });
});

/**
 * 심야 도착 후 익일 첫차 환승 제외 (#178)
 *
 * 판정 두 조건: ① 도착 순간이 그 역의 심야 침묵(직전-다음 출발 공백 > 시간표 최대 공백의
 * 절반) 안이고, ② 대기 전체가 활동 가능 시간(09:00-21:00 KST, 다일 합산)과 겹치지 않는다.
 * 서로 다른 편성에만 적용한다. 아래 회귀들은 지영님 리뷰에서 합의한 안전선이다.
 */
describe("심야 환승 제외 (#178)", () => {
  const nightConstraints = (overrides: Partial<TripConstraints> = {}) => constraints({
    departureAt: "2026-08-13T22:00:00+09:00", // 하루짜리 기본 fixture를 1박 2일로 늘린다
    selectedActorIds: [],
    selectedWorkIds: ["work-1"],
    ...overrides,
  });

  it("심야 도착 후에는 첫차뿐 아니라 후속편으로도 환승 경로를 만들지 않는다", () => {
    const repos = repositories();
    repos.places = [place("place-night", "work-1", "station-jinbu",
      { type: "always_open", source: "fixture", verifiedAt: "2026-08-08" })];
    repos.workPlaceRelations = strictRelationsFor(repos.places);
    repos.trainLegs = [
      // 강릉의 직전 출발 — 이 출발과 익일 첫차 사이가 심야 침묵(430분)이 된다
      leg("700", "station-gangneung", "station-seoul", "2026-08-12T22:00:00+09:00", "2026-08-12T23:30:00+09:00"),
      leg("801", "station-seoul", "station-gangneung", "2026-08-12T22:40:00+09:00", "2026-08-13T01:10:00+09:00"),
      leg("802", "station-gangneung", "station-jinbu", "2026-08-13T05:10:00+09:00", "2026-08-13T05:40:00+09:00"), // 첫차
      leg("803", "station-gangneung", "station-jinbu", "2026-08-13T05:25:00+09:00", "2026-08-13T05:55:00+09:00"), // 후속편
      leg("804", "station-jinbu", "station-seoul", "2026-08-13T13:00:00+09:00", "2026-08-13T15:00:00+09:00"),
    ];

    const result = generateItinerary(nightConstraints(), repos);

    // 01:10 도착 → 05:10/05:25는 같은 침묵에서 출발하므로 둘 다 환승 후보가 아니다.
    // "대기 중 다른 출발 유무"로 판정했다면 05:25가 05:10의 존재 때문에 통과했을 것이다.
    expect(result.status).toBe("empty");
    expect(result.rejectedPlaces).toEqual([
      { code: "OVERNIGHT_TRANSFER_REQUIRED", placeId: "place-night" },
    ]);
  });

  it("자정을 짧게 넘는 환승은 유지된다 — 달력 자정은 판정 기준이 아니다", () => {
    const repos = repositories();
    repos.places = [place("place-night", "work-1", "station-jinbu",
      { type: "always_open", source: "fixture", verifiedAt: "2026-08-08" })];
    repos.workPlaceRelations = strictRelationsFor(repos.places);
    repos.trainLegs = [
      // 강릉의 직전 출발이 23:40이라 23:50 도착을 포함한 침묵은 40분뿐 — 심야가 아니다
      leg("700", "station-gangneung", "station-seoul", "2026-08-12T23:40:00+09:00", "2026-08-13T01:00:00+09:00"),
      leg("901", "station-seoul", "station-gangneung", "2026-08-12T22:30:00+09:00", "2026-08-12T23:50:00+09:00"),
      leg("902", "station-gangneung", "station-jinbu", "2026-08-13T00:20:00+09:00", "2026-08-13T00:50:00+09:00"),
      leg("903", "station-jinbu", "station-seoul", "2026-08-13T13:00:00+09:00", "2026-08-13T15:00:00+09:00"),
    ];

    const result = generateItinerary(nightConstraints(), repos);

    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.days.flatMap((day) => day.rides.map(({ trainNo }) => trainNo)))
      .toEqual(["901", "902", "903"]); // 23:50 → 00:20 환승이 살아 있다
  });

  it("같은 편성의 자정 통과 정차는 유지되고, 같은 시각의 다른 편성은 제외된다", () => {
    const throughRepos = () => {
      const repos = repositories();
      repos.places = repos.places.filter(({ id }) => id === "place-selected");
      repos.workPlaceRelations = strictRelationsFor(repos.places);
      repos.trainLegs = [
        // 진부의 직전 출발 — 00:30 도착을 포함한 침묵(470분)이 심야 판정을 받게 한다
        leg("700", "station-jinbu", "station-seoul", "2026-08-12T17:00:00+09:00", "2026-08-12T19:00:00+09:00"),
        leg("805", "station-seoul", "station-jinbu", "2026-08-12T22:40:00+09:00", "2026-08-13T00:30:00+09:00"),
        leg("805", "station-jinbu", "station-gangneung", "2026-08-13T00:50:00+09:00", "2026-08-13T01:20:00+09:00"),
        leg("806", "station-gangneung", "station-seoul", "2026-08-13T13:00:00+09:00", "2026-08-13T15:00:00+09:00"),
      ];
      return repos;
    };

    const through = generateItinerary(nightConstraints(), throughRepos());
    expect(through.status).toBe("planned");
    if (through.status === "planned") {
      expect(through.days.flatMap((day) => day.rides.map(({ trainNo }) => trainNo)))
        .toEqual(["805", "805", "806"]);
      expect(through.metrics.transferCount).toBe(0); // 805 통과 정차는 환승이 아니다
    }

    // 같은 시각·같은 역이라도 편성이 다르면 심야 환승이다 — trainNo 가드가 판정의 전부임을 고정
    const transferRepos = throughRepos();
    transferRepos.trainLegs[2] = { ...transferRepos.trainLegs[2], trainNo: "807" };
    const transfer = generateItinerary(nightConstraints(), transferRepos);
    expect(transfer.status).toBe("empty");
    expect(transfer.rejectedPlaces).toEqual([
      { code: "OVERNIGHT_TRANSFER_REQUIRED", placeId: "place-selected" },
    ]);
  });

  it("실스냅샷 — 전날 도착해 다음 날 공항철도로 돌아가는 다일 이동은 유지된다", () => {
    const real = loadRepositories();
    const goblin = real.places.filter((candidate) => candidate.workIds.includes("work-goblin"))
      .map(({ id }) => id).sort();
    const result = generateItinerary(constraints({
      arrivalAt: "2026-08-12T10:00:00+09:00",
      airportReadyAt: "2026-08-12T12:00:00+09:00",
      departureAt: "2026-08-14T18:00:00+09:00",
      airportArrivalDeadline: "2026-08-14T16:00:00+09:00",
      selectedActorIds: [],
      selectedWorkIds: ["work-goblin"],
      excludedPlaceIds: goblin.slice(1),
      maxPlacesPerDay: 3,
      dailySlackMinutes: 120,
    }), real);

    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    const rides = result.days.flatMap((day) => day.rides);
    expect(rides.map(({ trainNo }) => trainNo))
      .toEqual(["AREX-E112", "00845", "00814", "AREX-W112"]);
    // 서울 도착(08-13 오후)과 공항철도 출발(08-14 정오) 사이는 다음 날 활동 시간과 겹치는
    // 정상 다일 대기다 — 도착일만 검사하면 이 귀환이 심야 환승으로 오판되어 일정 전체가 사라진다
    expect(rides[2].arriveAt.slice(0, 10)).toBe("2026-08-13");
    expect(rides[3].departAt.slice(0, 10)).toBe("2026-08-14");
  });

  it("실스냅샷 심야 침묵 하한은 최대 공백 319분의 절반으로 파생된다", () => {
    const real = loadRepositories();
    const departs = real.trainLegs.map(({ departAt }) => Date.parse(departAt)).sort((a, b) => a - b);
    // 실측 근거 고정: 심야 무운행 공백 23:47 → 익일 05:06 = 319분, 그 외 최대 침묵 25분.
    // 스냅샷이 바뀌어 이 값이 달라지면 하한 재검토가 필요하다는 신호다.
    expect(overnightSilenceFloorOf(departs)).toBe((319 / 2) * 60_000);
  });
});
