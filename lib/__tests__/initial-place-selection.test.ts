import { describe, expect, it } from "vitest";
import { initialPlaceIdsFromItinerary } from "../initial-place-selection";
import type { ItineraryResult } from "../engine/types";

const planned = (placeIds: string[]): ItineraryResult => ({
  status: "planned",
  days: [{
    date: "2026-08-12",
    rides: [],
    regionWindows: [],
    items: placeIds.map((placeId, index) => ({
      placeId,
      arriveAt: `2026-08-12T0${index + 1}:00:00.000Z`,
      departAt: `2026-08-12T0${index + 2}:00:00.000Z`,
      accessMinutes: 10,
    })),
  }],
  rejectedPlaces: [],
  warnings: [],
  selectionGroups: { requested: [], covered: [], uncovered: [] },
  comparisonKeys: {
    selectionGroupCoverageCount: 0,
    selectedUnionPlaceCount: placeIds.length,
    verifiedHoursMismatchCount: 0,
    preferredDateMismatchCount: 0,
    preferredOrderMismatchCount: 0,
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

describe("최초 촬영지 선택", () => {
  it("첫 일정에 실제 배치된 후보만 선택한다", () => {
    expect(initialPlaceIdsFromItinerary(
      ["place-a", "place-b", "place-c", "place-d"],
      planned(["place-b", "place-d"]),
    )).toEqual(["place-b", "place-d"]);
  });

  it("일정에 후보 밖 legacy 장소가 있어도 선택에 끼우지 않는다", () => {
    expect(initialPlaceIdsFromItinerary(
      ["place-a", "place-b"],
      planned(["legacy-place", "place-b"]),
    )).toEqual(["place-b"]);
  });

  it("empty 결과에서는 실패 사유 확인을 위해 후보 선택을 유지한다", () => {
    const empty: ItineraryResult = {
      status: "empty",
      days: [],
      rejectedPlaces: [],
      warnings: [],
      selectionGroups: { requested: [], covered: [], uncovered: [] },
    };
    expect(initialPlaceIdsFromItinerary(["place-a", "place-b"], empty))
      .toEqual(["place-a", "place-b"]);
  });
});
