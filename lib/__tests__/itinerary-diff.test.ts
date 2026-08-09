import { describe, expect, it } from "vitest";
import { diffItineraries } from "../itinerary-diff";
import { planItinerary, type PlanRequest } from "../actions/itinerary";
import type { DayPlan, ItineraryResult, TrainRide } from "../engine/types";

/**
 * 재계산 전후 비교 (#103)
 *
 * "열차를 놓쳐도 일정이 스스로 다시 선다"를 화면이 말하려면 무엇이 바뀌었는지를
 * 먼저 계산해야 한다. 이 테스트는 그 계산만 고정한다 — 문구는 여기 없다.
 */

const ride = (trainNo: string, from: string, to: string, departAt: string): TrainRide => ({
  trainNo,
  fromStationId: from,
  toStationId: to,
  departAt,
  arriveAt: departAt,
});

const day = (date: string, rides: TrainRide[], placeIds: string[]): DayPlan => ({
  date,
  rides,
  regionWindows: [],
  items: placeIds.map((placeId) => ({
    placeId,
    arriveAt: `${date}T01:00:00.000Z`,
    departAt: `${date}T02:00:00.000Z`,
    accessMinutes: 20,
  })),
});

const planned = (days: DayPlan[], rejected: ItineraryResult["rejectedPlaces"] = []): ItineraryResult => ({
  status: "planned",
  days,
  rejectedPlaces: rejected,
  warnings: [],
  selectionGroups: { requested: [], covered: [], uncovered: [] },
  comparisonKeys: {
    selectionGroupCoverageCount: 0,
    selectedUnionPlaceCount: 0,
    activityWarningCount: 0,
    totalTravelMinutes: 0,
    transferCount: 0,
    slackSatisfied: true,
  },
  metrics: {
    totalTravelMinutes: 0,
    totalRailMinutes: 0,
    transferCount: 0,
    departureSlackMinutes: 0,
  },
});

const empty = (rejected: ItineraryResult["rejectedPlaces"] = []): ItineraryResult => ({
  status: "empty",
  days: [],
  rejectedPlaces: rejected,
  warnings: [],
  selectionGroups: { requested: [], covered: [], uncovered: [] },
});

describe("일정 재계산 전후 비교 (#103)", () => {
  it("놓친 열차와 재선택된 열차를 나눈다", () => {
    const before = planned([day("2026-08-12", [ride("00815", "station-seoul", "station-gangneung", "2026-08-12T04:55:00.000Z")], [])]);
    const after = planned([day("2026-08-12", [ride("00819", "station-seoul", "station-gangneung", "2026-08-12T08:29:00.000Z")], [])]);

    const diff = diffItineraries(before, after);
    expect(diff.rides.dropped.map((r) => r.trainNo)).toEqual(["00815"]);
    expect(diff.rides.added.map((r) => r.trainNo)).toEqual(["00819"]);
    expect(diff.rides.kept).toEqual([]);
    expect(diff.changed).toBe(true);
  });

  it("같은 열차가 그대로면 kept로 두고 변경으로 세지 않는다", () => {
    const same = [day("2026-08-12", [ride("00815", "station-seoul", "station-gangneung", "2026-08-12T04:55:00.000Z")], ["place-a"])];
    const diff = diffItineraries(planned(same), planned(same));
    expect(diff.rides.kept).toHaveLength(1);
    expect(diff.rides.dropped).toEqual([]);
    expect(diff.places.kept).toEqual([{ placeId: "place-a", date: "2026-08-12" }]);
    expect(diff.changed).toBe(false);
  });

  describe("못 타게 된 편 판정 범위 (PR #105 리뷰)", () => {
    // 첫날 부산행과 둘째날 강릉행이 모두 빠졌고, 둘 다 경계보다 이르다.
    // 사용자가 늦춘 것은 둘째날 서울→강릉 하나뿐이다.
    const before = planned([
      day("2026-08-12", [ride("00033", "station-seoul", "station-busan", "2026-08-12T04:18:00.000Z")], []),
      day("2026-08-13", [ride("00815", "station-seoul", "station-gangneung", "2026-08-13T04:55:00.000Z")], []),
    ]);
    const after = planned([
      day("2026-08-13", [ride("00819", "station-seoul", "station-gangneung", "2026-08-13T08:29:00.000Z")], []),
    ]);
    const notBefore = "2026-08-13T07:55:00.000Z";

    it("구간을 지정하면 그 구간의 편만 못 타게 된 것으로 본다", () => {
      const diff = diffItineraries(before, after, {
        unusable: {
          kind: "segment",
          fromStationId: "station-seoul",
          toStationId: "station-gangneung",
          notBefore,
        },
      });
      expect(diff.rides.dropped.map((r) => r.trainNo).sort()).toEqual(["00033", "00815"]);
      // 첫날 부산행은 경계보다 이르지만 사용자가 늦춘 구간이 아니다 — 재최적화로 바뀐 것이다
      expect(diff.rides.missed.map((r) => r.trainNo)).toEqual(["00815"]);
    });

    it("여행 시작 경계가 밀린 경우에는 이전 출발 전부가 대상이다", () => {
      const diff = diffItineraries(before, after, {
        unusable: { kind: "trip_start", notBefore },
      });
      expect(diff.rides.missed.map((r) => r.trainNo).sort()).toEqual(["00033", "00815"]);
    });

    it("경로가 쪼개져 일치하는 구간이 없으면 판정하지 않는다", () => {
      // 서울→강릉이 아니라 서울→청량리·청량리→강릉으로 쪼개진 경우
      const split = planned([
        day("2026-08-13", [
          ride("00815", "station-seoul", "station-cheongnyangni", "2026-08-13T04:55:00.000Z"),
          ride("00815", "station-cheongnyangni", "station-gangneung", "2026-08-13T05:20:00.000Z"),
        ], []),
      ]);
      const diff = diffItineraries(split, planned([]), {
        unusable: {
          kind: "segment",
          fromStationId: "station-seoul",
          toStationId: "station-gangneung",
          notBefore,
        },
      });
      expect(diff.rides.dropped).toHaveLength(2);
      expect(diff.rides.missed).toEqual([]);
    });
  });

  it("다음 날로 밀린 방문을 제외가 아니라 이동으로 구분한다", () => {
    const before = planned([day("2026-08-12", [], ["place-a", "place-b"])]);
    const after = planned([day("2026-08-12", [], ["place-a"]), day("2026-08-13", [], ["place-b"])]);

    const diff = diffItineraries(before, after);
    expect(diff.places.moved).toEqual([
      { placeId: "place-b", fromDate: "2026-08-12", toDate: "2026-08-13" },
    ]);
    expect(diff.places.dropped).toEqual([]);
    expect(diff.places.kept).toEqual([{ placeId: "place-a", date: "2026-08-12" }]);
  });

  it("빠진 장소에 새 결과의 사유를 붙인다 — 옛 사유를 재활용하지 않는다", () => {
    const before = planned([day("2026-08-12", [], ["place-a", "place-b"])],
      [{ code: "DAILY_CAPACITY_EXCEEDED", placeId: "place-b" }]);
    const after = planned([day("2026-08-12", [], ["place-a"])],
      [{ code: "DEPARTURE_DEADLINE_EXCEEDED", placeId: "place-b" }]);

    const diff = diffItineraries(before, after);
    expect(diff.places.dropped).toEqual([
      { placeId: "place-b", reason: "DEPARTURE_DEADLINE_EXCEEDED" },
    ]);
  });

  it("사유를 못 찾으면 지어내지 않고 비워 둔다", () => {
    const before = planned([day("2026-08-12", [], ["place-a"])]);
    const after = planned([day("2026-08-12", [], [])]);
    expect(diffItineraries(before, after).places.dropped).toEqual([
      { placeId: "place-a", reason: undefined },
    ]);
  });

  it("재계산 결과가 empty면 전부 빠진 것으로 보고 사유를 붙인다", () => {
    const before = planned([day("2026-08-12", [ride("00815", "station-seoul", "station-gangneung", "2026-08-12T04:55:00.000Z")], ["place-a"])]);
    const after = empty([{ code: "TRAIN_UNAVAILABLE", placeId: "place-a" }]);

    const diff = diffItineraries(before, after);
    expect(diff.places.dropped).toEqual([{ placeId: "place-a", reason: "TRAIN_UNAVAILABLE" }]);
    expect(diff.rides.dropped).toHaveLength(1);
    expect(diff.rides.added).toEqual([]);
    expect(diff.changed).toBe(true);
  });

  it("이전 일정이 없으면 전부 added다", () => {
    const after = planned([day("2026-08-12", [ride("00815", "station-seoul", "station-gangneung", "2026-08-12T04:55:00.000Z")], ["place-a"])]);
    const diff = diffItineraries(empty(), after);
    expect(diff.rides.added).toHaveLength(1);
    expect(diff.places.added).toEqual([{ placeId: "place-a", date: "2026-08-12" }]);
    expect(diff.changed).toBe(true);
  });
});

describe("항공편 지연 재계산 — 실시드 회귀 (#103 · 발표 시나리오)", () => {
  const base: PlanRequest = {
    arrivalAt: "2026-08-12T10:00:00+09:00",
    departureAt: "2026-08-14T18:00:00+09:00",
    airportReadyAt: "2026-08-12T12:00:00+09:00",
    airportArrivalDeadline: "2026-08-14T16:00:00+09:00",
    selectedActorIds: ["actor-kim-go-eun"],
    selectedWorkIds: [],
    excludedPlaceIds: [],
  };

  it("입국 2시간 지연이면 놓친 열차와 재선택 열차가 계산된다", async () => {
    const before = await planItinerary(base);
    // 도착이 밀리면 공항을 나서는 시각도 함께 밀린다 (#14 차단 2 — 절대 시각 경계)
    const after = await planItinerary({
      ...base,
      arrivalAt: "2026-08-12T12:00:00+09:00",
      airportReadyAt: "2026-08-12T14:00:00+09:00",
    });
    expect(before.ok && after.ok).toBe(true);
    if (!before.ok || !after.ok) return;

    const newReadyAt = "2026-08-12T14:00:00+09:00";
    const diff = diffItineraries(before.result, after.result, {
      unusable: { kind: "trip_start", notBefore: newReadyAt },
    });
    expect(diff.changed).toBe(true);

    // 놓친 편이 실제로 존재하고, 전부 새 출발 가능 시각 이전에 떠난 편이다
    expect(diff.rides.missed.length).toBeGreaterThan(0);
    for (const ride of diff.rides.missed) {
      expect(Date.parse(ride.departAt), ride.trainNo).toBeLessThan(Date.parse(newReadyAt));
    }
    // 놓친 편은 빠진 편의 부분집합이다 — 재최적화로 바뀐 편까지 놓쳤다고 말하지 않는다
    expect(diff.rides.missed.length).toBeLessThanOrEqual(diff.rides.dropped.length);
    // 사용자는 아무것도 하지 않았는데 대체 열차가 잡힌다
    expect(diff.rides.added.length).toBeGreaterThan(0);
  });

  it("경계를 주지 않으면 놓쳤다고 판정하지 않는다", async () => {
    const before = await planItinerary(base);
    const after = await planItinerary({
      ...base,
      arrivalAt: "2026-08-12T12:00:00+09:00",
      airportReadyAt: "2026-08-12T14:00:00+09:00",
    });
    if (!before.ok || !after.ok) return;
    const diff = diffItineraries(before.result, after.result);
    expect(diff.rides.dropped.length).toBeGreaterThan(0);
    expect(diff.rides.missed).toEqual([]);
  });

  it("같은 입력으로 두 번 계산하면 변경 없음이다 — 결정성 회귀", async () => {
    const first = await planItinerary(base);
    const second = await planItinerary(base);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(diffItineraries(first.result, second.result).changed).toBe(false);
  });
});
