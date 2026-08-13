import { describe, expect, it } from "vitest";
import { generateItinerary } from "../engine";
import type { ItineraryResult, TripConstraints } from "../engine/types";
import { validateItinerary } from "../evaluation/validator";
import { loadRepositories } from "../repositories/json";

const repos = loadRepositories();
const constraints: TripConstraints = {
  arrivalAt: "2026-08-12T10:00:00+09:00",
  departureAt: "2026-08-14T18:00:00+09:00",
  airportReadyAt: "2026-08-12T12:00:00+09:00",
  airportArrivalDeadline: "2026-08-14T16:00:00+09:00",
  selectedActorIds: ["actor-kim-go-eun"],
  selectedWorkIds: [],
  excludedPlaceIds: [],
  maxPlacesPerDay: 3,
  dailySlackMinutes: 120,
};

function plannedFixture(): Extract<ItineraryResult, { status: "planned" }> {
  const result = generateItinerary(constraints, repos);
  if (result.status !== "planned") throw new Error("validator fixture must be planned");
  return result;
}

describe("#181 independent hard-constraint validator", () => {
  it("accepts the unmodified planner result", () => {
    expect(validateItinerary(plannedFixture(), constraints, repos)).toEqual([]);
  });

  it("detects an excluded place reintroduced into an output", () => {
    const result = plannedFixture();
    const placeId = result.days[0].items[0].placeId;
    const violations = validateItinerary(
      result,
      { ...constraints, excludedPlaceIds: [placeId] },
      repos,
    );
    expect(violations.map(({ code }) => code)).toContain("EXCLUDED_PLACE_REINTRODUCED");
  });

  it("detects corrupt intervals and derived metrics", () => {
    const result = structuredClone(plannedFixture());
    const firstItem = result.days[0].items[0];
    firstItem.departAt = firstItem.arriveAt;
    result.metrics.totalRailMinutes += 1;
    result.comparisonKeys.verifiedHoursMismatchCount += 1;

    const codes = validateItinerary(result, constraints, repos).map(({ code }) => code);
    expect(codes).toContain("INVALID_INTERVAL");
    expect(codes).toContain("STAY_TIME_SHORTFALL");
    expect(codes.filter((code) => code === "METRIC_MISMATCH")).toHaveLength(2);
  });
});
