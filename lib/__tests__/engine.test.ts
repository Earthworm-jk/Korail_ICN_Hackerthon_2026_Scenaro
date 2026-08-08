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
      { id: "station-seoul", name: localized("서울역"), lineType: "KTX", regionId: "seoul_metro" },
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

function constraints(overrides: Partial<TripConstraints> = {}): TripConstraints {
  return {
    arrivalAt: "2026-08-12T06:00:00+09:00",
    departureAt: "2026-08-12T22:00:00+09:00",
    airportExitOffsetMin: 60,
    selectedActorIds: ["actor-a", "actor-b"],
    selectedWorkIds: ["work-1"],
    requiredPlaceIds: [],
    excludedPlaceIds: [],
    pinnedDates: {},
    maxPlacesPerDay: 3,
    dailySlackMinutes: 60,
    departureBufferMinutes: 120,
    ...overrides,
  };
}

describe("generateItinerary", () => {
  it("복수 배우와 복수 작품 관계를 사용해 결정적인 왕복 일정을 만든다", () => {
    const result = generateItinerary(constraints(), repositories());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.days.flatMap((day) => day.items.map((item) => item.placeId))).toEqual([
      "place-selected",
      "place-actor-a",
      "place-actor-b",
    ]);
    expect(result.days.flatMap((day) => day.rides.map((ride) => ride.trainNo))).toEqual([
      "101", "201", "301",
    ]);
    expect(result.comparisonKeys.relevanceKey).toEqual({
      selectedWorkPlaceCount: 1,
      actorOtherWorkPlaceCount: 2,
    });
    expect(result.metrics).toEqual({
      totalTravelMinutes: 450,
      totalRailMinutes: 270,
      transferCount: 0,
      departureSlackMinutes: 240,
    });
    expect(result.rejectedPlaces).toContainEqual({
      code: "ACTIVITY_WINDOW_MISMATCH",
      placeId: "place-unverified",
      detail: "UNVERIFIED_HOURS",
    });
  });

  it("사용자가 제외한 장소는 일정과 자동 제외 사유에서 모두 뺀다", () => {
    const result = generateItinerary(
      constraints({ excludedPlaceIds: ["place-actor-b"] }),
      repositories(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.days.flatMap((day) => day.items.map((item) => item.placeId)).sort())
      .toEqual(["place-actor-a", "place-selected"]);
    expect(result.rejectedPlaces.some((reason) =>
      "placeId" in reason && reason.placeId === "place-actor-b")).toBe(false);
  });

  it("필수 장소와 제외 장소가 충돌하면 사용자 제약 실패를 반환한다", () => {
    const result = generateItinerary(
      constraints({
        requiredPlaceIds: ["place-selected"],
        excludedPlaceIds: ["place-selected"],
      }),
      repositories(),
    );

    expect(result).toEqual({
      ok: false,
      reason: {
        code: "USER_CONSTRAINT_INFEASIBLE",
        constraintType: "REQUIRED_PLACE",
        targetId: "place-selected",
      },
    });
  });

  it("고정 방문일을 지킬 수 없으면 기존 일정 대신 실패를 반환한다", () => {
    const result = generateItinerary(
      constraints({ pinnedDates: { "place-selected": "2026-08-13" } }),
      repositories(),
    );

    expect(result).toEqual({
      ok: false,
      reason: {
        code: "USER_CONSTRAINT_INFEASIBLE",
        constraintType: "PINNED_DATE",
        targetId: "place-selected",
      },
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

    expect(result.ok).toBe(true);
    if (!result.ok) return;
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
      departureBufferMinutes: 120,
    }), repositories());

    expect(result).toEqual({
      ok: false,
      reason: {
        code: "DEPARTURE_DEADLINE_EXCEEDED",
        placeId: "place-selected",
      },
    });
  });

  it("같은 열차 번호의 연속 구간은 환승으로 세지 않는다", () => {
    const repos = repositories();
    repos.trainLegs[1] = { ...repos.trainLegs[1], trainNo: "101" };
    const result = generateItinerary(constraints({
      selectedActorIds: [],
      selectedWorkIds: ["work-3"],
    }), repos);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.metrics.transferCount).toBe(0);
  });

  it("운영시간은 맞지만 보수적 접근 버퍼 때문에 불가능하면 상세 사유를 구분한다", () => {
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

    expect(result).toEqual({
      ok: false,
      reason: {
        code: "ACTIVITY_WINDOW_MISMATCH",
        placeId: "place-selected",
        detail: "CONSERVATIVE_BUFFER_MISMATCH",
      },
    });
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
      ok: false,
      reason: { code: "TRAIN_UNAVAILABLE", placeId: "place-selected" },
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
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.comparisonKeys.visitablePlaceCount).toBe(15);
  });

  it("배우와 작품이 모두 비어 있는 입력은 계산 전에 거절한다", () => {
    expect(() => generateItinerary(
      constraints({ selectedActorIds: [], selectedWorkIds: [] }),
      repositories(),
    )).toThrow();
  });
});
