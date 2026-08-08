import { describe, expect, it } from "vitest";
import { generateItinerary } from "../engine";
import type { TripConstraints } from "../engine/types";
import type { Repositories } from "../repositories/json";

const localized = (ko: string, en = ko) => ({ ko, en });

function repositories(): Repositories {
  return {
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
    flights: [],
  };
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

describe("generateItinerary", () => {
  it("결정적 왕복 일정 — 미확인 장소는 제외 대신 경고와 함께 배치된다 (#43)", () => {
    const result = generateItinerary(constraints(), repositories());

    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    // place-unverified가 work-1(선택 작품)이라 relevance 2가 되어 기존 3곳 조합을 이긴다
    expect(result.days.flatMap((day) => day.items.map((item) => item.placeId))).toEqual([
      "place-actor-a",
      "place-selected",
      "place-unverified",
    ]);
    expect(result.days.flatMap((day) => day.rides.map((ride) => ride.trainNo))).toEqual([
      "101", "302",
    ]);
    expect(result.comparisonKeys.relevanceKey).toEqual({
      selectedWorkPlaceCount: 2,
      actorOtherWorkPlaceCount: 1,
    });
    expect(result.comparisonKeys.activityWarningCount).toBe(1);
    expect(result.metrics).toEqual({
      totalTravelMinutes: 420,
      totalRailMinutes: 240,
      transferCount: 0,
      departureSlackMinutes: 180,
    });
    expect(result.warnings).toEqual([
      { code: "ACTIVITY_WINDOW_MISMATCH", placeId: "place-unverified", detail: "UNVERIFIED_HOURS" },
    ]);
    expect(result.rejectedPlaces).toEqual([
      { code: "TRAIN_UNAVAILABLE", placeId: "place-actor-b" },
    ]);
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
    expect(result.comparisonKeys.activityWarningCount).toBe(1);
  });

  it("동일 관련성·방문 수에서는 경고 없는 일정이 항상 우선한다 (#43 수용 기준)", () => {
    const repos = repositories();
    repos.places = [
      place("place-clean", "work-1", "station-gangneung", { type: "always_open", source: "fixture", verifiedAt: "2026-08-08" }),
      place("place-warned", "work-1", "station-gangneung", { type: "unverified" }),
    ];
    // 당일 일정 + 하루 1곳 → 한 곳만 배치 가능. 관련성·방문 수가 같으므로 경고 수가 승부를 가른다
    const result = generateItinerary(constraints({
      selectedActorIds: [],
      selectedWorkIds: ["work-1"],
      maxPlacesPerDay: 1,
    }), repos);

    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.days.flatMap((day) => day.items.map((item) => item.placeId)))
      .toEqual(["place-clean"]);
    expect(result.comparisonKeys.activityWarningCount).toBe(0);
    expect(result.warnings).toEqual([]);
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
    expect(result.comparisonKeys.activityWarningCount).toBe(result.warnings.length);
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
    });
  });

  it("시드 상한 15곳에서도 2초 안에 결정적 결과를 만든다", () => {
    const repos = repositories();
    repos.places = Array.from({ length: 15 }, (_, index) => ({
      ...repos.places[0],
      id: `place-${String(index + 1).padStart(2, "0")}`,
      stayMinutes: 10,
    }));
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
    expect(result.comparisonKeys.visitablePlaceCount).toBe(15);
  });

  it("배우와 작품이 모두 비어 있는 입력은 계산 전에 거절한다", () => {
    expect(() => generateItinerary(
      constraints({ selectedActorIds: [], selectedWorkIds: [] }),
      repositories(),
    )).toThrow();
  });
});
