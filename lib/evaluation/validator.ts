import type { Repositories } from "../repositories/json";
import type {
  DayPlan,
  ItineraryResult,
  PreferredDateOutcome,
  PreferredOrderOutcome,
  TripConstraints,
} from "../engine/types";
import { accessBufferMinutes } from "../types/schema";
import type { EvaluationViolation } from "./types";

const MIN_TRANSFER_MINUTES = 15;
const MINUTE_MS = 60_000;

const violation = (
  code: EvaluationViolation["code"],
  message: string,
  path?: string,
): EvaluationViolation => ({ code, message, ...(path ? { path } : {}) });

function preferredDateOutcomesOf(
  days: readonly DayPlan[],
  constraints: TripConstraints,
): PreferredDateOutcome[] {
  const excluded = new Set(constraints.excludedPlaceIds);
  const scheduledDate = new Map(days.flatMap((day) =>
    day.items.map((item) => [item.placeId, day.date] as const)));
  return Object.entries(constraints.preferredVisitDates ?? {})
    .filter(([placeId]) => !excluded.has(placeId))
    .sort(([a], [b]) => a.localeCompare(b, "en"))
    .map(([placeId, requestedDate]) => {
      const actualDate = scheduledDate.get(placeId);
      if (actualDate === undefined) return { placeId, requestedDate, outcome: "unplaced" as const };
      return actualDate === requestedDate
        ? { placeId, requestedDate, outcome: "honored" as const }
        : { placeId, requestedDate, outcome: "adjusted" as const, scheduledDate: actualDate };
    });
}

function preferredOrderOutcomesOf(
  days: readonly DayPlan[],
  constraints: TripConstraints,
): PreferredOrderOutcome[] {
  const excluded = new Set(constraints.excludedPlaceIds);
  const positions = new Map(days.flatMap((day) => day.items)
    .map((item, index) => [item.placeId, index] as const));
  return (constraints.preferredOrder ?? [])
    .filter(([first, second]) => !excluded.has(first) && !excluded.has(second))
    .map(([first, second]) => [first, second] as const)
    .sort((a, b) => a[0].localeCompare(b[0], "en") || a[1].localeCompare(b[1], "en"))
    .map(([firstPlaceId, secondPlaceId]) => {
      const first = positions.get(firstPlaceId);
      const second = positions.get(secondPlaceId);
      if (first === undefined || second === undefined) {
        return { firstPlaceId, secondPlaceId, outcome: "unplaced" as const };
      }
      return first < second
        ? { firstPlaceId, secondPlaceId, outcome: "honored" as const }
        : { firstPlaceId, secondPlaceId, outcome: "adjusted" as const };
    });
}

/**
 * Planner 밖에서 결과만 다시 읽는 하드 제약 validator다.
 * 운영시간은 현재 엔진 계약상 하드 제외가 아니라 ACTIVITY_WINDOW_MISMATCH 경고이므로
 * 여기서 실패로 세지 않는다. docs/EVALUATION.md에 이 계약 차이를 명시한다.
 */
export function validateItinerary(
  result: ItineraryResult,
  constraints: TripConstraints,
  repos: Repositories,
): EvaluationViolation[] {
  if (result.status === "empty") return [];

  const violations: EvaluationViolation[] = [];
  const placeById = new Map(repos.places.map((place) => [place.id, place]));
  const excluded = new Set(constraints.excludedPlaceIds);
  const visited = new Set<string>();
  const scheduled = new Set<string>();
  const knownRideKeys = new Set(repos.trainLegs.map((ride) => [
    ride.trainNo,
    ride.fromStationId,
    ride.toStationId,
    new Date(ride.departAt).toISOString(),
    new Date(ride.arriveAt).toISOString(),
  ].join("|")));

  for (const [dayIndex, day] of result.days.entries()) {
    if (day.items.length > constraints.maxPlacesPerDay) {
      violations.push(violation(
        "DAILY_CAPACITY_EXCEEDED",
        `${day.date} has ${day.items.length} places; max is ${constraints.maxPlacesPerDay}`,
        `days.${dayIndex}.items`,
      ));
    }

    const intervals: Array<{ start: number; end: number; path: string }> = [];
    for (const [itemIndex, item] of day.items.entries()) {
      const path = `days.${dayIndex}.items.${itemIndex}`;
      const start = Date.parse(item.arriveAt);
      const end = Date.parse(item.departAt);
      scheduled.add(item.placeId);
      intervals.push({ start, end, path });
      if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
        violations.push(violation("INVALID_INTERVAL", `invalid visit interval for ${item.placeId}`, path));
      }
      if (start < Date.parse(constraints.airportReadyAt) || end > Date.parse(constraints.airportArrivalDeadline)) {
        violations.push(violation("OUTSIDE_TRIP_WINDOW", `${item.placeId} is outside the usable trip window`, path));
      }
      if (excluded.has(item.placeId)) {
        violations.push(violation("EXCLUDED_PLACE_REINTRODUCED", `${item.placeId} was excluded`, path));
      }
      if (visited.has(item.placeId)) {
        violations.push(violation("DUPLICATE_PLACE", `${item.placeId} is scheduled more than once`, path));
      }
      visited.add(item.placeId);
      const place = placeById.get(item.placeId);
      if (!place) {
        violations.push(violation("UNKNOWN_PLACE", `${item.placeId} is absent from the repository`, path));
      } else if ((end - start) / MINUTE_MS < place.stayMinutes) {
        violations.push(violation(
          "STAY_TIME_SHORTFALL",
          `${item.placeId} stays ${(end - start) / MINUTE_MS}m; requires ${place.stayMinutes}m`,
          path,
        ));
      }
    }

    const rides = [...day.rides].sort((a, b) => Date.parse(a.departAt) - Date.parse(b.departAt));
    for (const [rideIndex, ride] of rides.entries()) {
      const path = `days.${dayIndex}.rides.${rideIndex}`;
      const start = Date.parse(ride.departAt);
      const end = Date.parse(ride.arriveAt);
      intervals.push({ start, end, path });
      if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
        violations.push(violation("INVALID_INTERVAL", `invalid train interval for ${ride.trainNo}`, path));
      }
      const key = [ride.trainNo, ride.fromStationId, ride.toStationId,
        new Date(ride.departAt).toISOString(), new Date(ride.arriveAt).toISOString()].join("|");
      if (!knownRideKeys.has(key)) {
        violations.push(violation("TRAIN_SNAPSHOT_MISMATCH", `${ride.trainNo} is not an exact snapshot ride`, path));
      }
      const next = rides[rideIndex + 1];
      if (next && ride.trainNo !== next.trainNo) {
        const transfer = (Date.parse(next.departAt) - end) / MINUTE_MS;
        if (transfer >= 0 && transfer < MIN_TRANSFER_MINUTES) {
          violations.push(violation(
            "MIN_TRANSFER_VIOLATION",
            `${ride.trainNo} → ${next.trainNo} transfer is ${transfer}m`,
            path,
          ));
        }
      }
    }

    for (const [legIndex, leg] of (day.gatewayLegs ?? []).entries()) {
      const start = Date.parse(leg.departAt);
      const end = Date.parse(leg.arriveAt);
      intervals.push({ start, end, path: `days.${dayIndex}.gatewayLegs.${legIndex}` });
    }

    intervals.sort((a, b) => a.start - b.start || a.end - b.end);
    for (let index = 1; index < intervals.length; index += 1) {
      const previous = intervals[index - 1];
      const current = intervals[index];
      if (current.start < previous.end) {
        violations.push(violation(
          "ITINERARY_OVERLAP",
          `${current.path} overlaps ${previous.path}`,
          current.path,
        ));
      }
    }
  }

  for (const [index, warning] of result.warnings.entries()) {
    if (!scheduled.has(warning.placeId)) {
      violations.push(violation(
        "WARNING_TARGET_MISSING",
        `warning targets unscheduled place ${warning.placeId}`,
        `warnings.${index}`,
      ));
    }
  }

  const railMinutes = result.days.flatMap((day) => day.rides).reduce(
    (sum, ride) => sum + (Date.parse(ride.arriveAt) - Date.parse(ride.departAt)) / MINUTE_MS,
    0,
  );
  if (railMinutes !== result.metrics.totalRailMinutes) {
    violations.push(violation(
      "METRIC_MISMATCH",
      `reported totalRailMinutes=${result.metrics.totalRailMinutes}; measured=${railMinutes}`,
      "metrics.totalRailMinutes",
    ));
  }
  const localTravelMinutes = result.days.flatMap((day) => day.items).reduce(
    (sum, item) => sum + 2 * (item.accessMinutes + accessBufferMinutes(item.accessMinutes)),
    0,
  );
  const totalTravelMinutes = railMinutes + localTravelMinutes;
  if (totalTravelMinutes !== result.metrics.totalTravelMinutes) {
    violations.push(violation(
      "METRIC_MISMATCH",
      `reported totalTravelMinutes=${result.metrics.totalTravelMinutes}; measured=${totalTravelMinutes}`,
      "metrics.totalTravelMinutes",
    ));
  }
  const verifiedHoursMismatchCount = result.warnings.filter(
    ({ detail }) => detail === "OUTSIDE_VERIFIED_HOURS",
  ).length;
  if (verifiedHoursMismatchCount !== result.comparisonKeys.verifiedHoursMismatchCount) {
    violations.push(violation(
      "METRIC_MISMATCH",
      `verified hours mismatch count=${verifiedHoursMismatchCount}; comparison key=${result.comparisonKeys.verifiedHoursMismatchCount}`,
      "comparisonKeys.verifiedHoursMismatchCount",
    ));
  }
  const preferredDateOutcomes = preferredDateOutcomesOf(result.days, constraints);
  const preferredDateMismatchCount = preferredDateOutcomes.filter(
    ({ outcome }) => outcome !== "honored",
  ).length;
  if (JSON.stringify(result.preferredDateOutcomes ?? []) !== JSON.stringify(preferredDateOutcomes)
    || preferredDateMismatchCount !== result.comparisonKeys.preferredDateMismatchCount) {
    violations.push(violation(
      "METRIC_MISMATCH",
      "preferred-date outcomes or mismatch comparison key do not match the scheduled itinerary",
      "preferredDateOutcomes",
    ));
  }
  const preferredOrderOutcomes = preferredOrderOutcomesOf(result.days, constraints);
  const preferredOrderMismatchCount = preferredOrderOutcomes.filter(
    ({ outcome }) => outcome !== "honored",
  ).length;
  if (JSON.stringify(result.preferredOrderOutcomes ?? []) !== JSON.stringify(preferredOrderOutcomes)
    || preferredOrderMismatchCount !== result.comparisonKeys.preferredOrderMismatchCount) {
    violations.push(violation(
      "METRIC_MISMATCH",
      "preferred-order outcomes or mismatch comparison key do not match the scheduled itinerary",
      "preferredOrderOutcomes",
    ));
  }
  const verifiedAlternatives = result.verifiedAlternatives ?? [];
  if (verifiedAlternatives.length > 2) {
    violations.push(violation(
      "METRIC_MISMATCH",
      `verified alternative count=${verifiedAlternatives.length}; max=2`,
      "verifiedAlternatives",
    ));
  }
  const alternativeSignatures = new Set<string>();
  const recommendedSignature = JSON.stringify(result.days);
  const recommendedVisitCount = result.days.reduce((count, day) => count + day.items.length, 0);
  const recommendedCoveredGroups = [...result.selectionGroups.covered].sort();
  for (const [index, alternative] of verifiedAlternatives.entries()) {
    const path = `verifiedAlternatives.${index}`;
    const signature = JSON.stringify(alternative.days);
    if (signature === recommendedSignature || alternativeSignatures.has(signature)) {
      violations.push(violation("METRIC_MISMATCH", "duplicate whole-itinerary alternative", path));
    }
    alternativeSignatures.add(signature);

    const travelDelta = alternative.metrics.totalTravelMinutes - result.metrics.totalTravelMinutes;
    const transferDelta = alternative.metrics.transferCount - result.metrics.transferCount;
    const measuredDeltas = {
      totalTravelMinutes: travelDelta,
      transferCount: transferDelta,
      verifiedHoursMismatchCount: alternative.comparisonKeys.verifiedHoursMismatchCount
        - result.comparisonKeys.verifiedHoursMismatchCount,
      preferredDateMismatchCount: alternative.comparisonKeys.preferredDateMismatchCount
        - result.comparisonKeys.preferredDateMismatchCount,
      preferredOrderMismatchCount: alternative.comparisonKeys.preferredOrderMismatchCount
        - result.comparisonKeys.preferredOrderMismatchCount,
      warningCount: alternative.warnings.length - result.warnings.length,
    };
    if (JSON.stringify(alternative.deltas) !== JSON.stringify(measuredDeltas)) {
      violations.push(violation(
        "METRIC_MISMATCH",
        `alternative deltas=${JSON.stringify(alternative.deltas)}; measured=${JSON.stringify(measuredDeltas)}`,
        `${path}.deltas`,
      ));
    }
    const recommendedPlaceIds = [...new Set(result.days.flatMap((day) =>
      day.items.map(({ placeId }) => placeId)))].sort((a, b) => a.localeCompare(b, "en"));
    const alternativePlaceIds = [...new Set(alternative.days.flatMap((day) =>
      day.items.map(({ placeId }) => placeId)))].sort((a, b) => a.localeCompare(b, "en"));
    const measuredChanges = {
      removedPlaceIds: recommendedPlaceIds.filter((placeId) => !alternativePlaceIds.includes(placeId)),
      addedPlaceIds: alternativePlaceIds.filter((placeId) => !recommendedPlaceIds.includes(placeId)),
    };
    if (JSON.stringify(alternative.changes) !== JSON.stringify(measuredChanges)) {
      violations.push(violation(
        "METRIC_MISMATCH",
        `alternative changes=${JSON.stringify(alternative.changes)}; measured=${JSON.stringify(measuredChanges)}`,
        `${path}.changes`,
      ));
    }
    const improvements = [
      ...(travelDelta < 0 ? ["faster" as const] : []),
      ...(transferDelta < 0 ? ["fewer_transfers" as const] : []),
    ];
    if (JSON.stringify(alternative.improvements) !== JSON.stringify(improvements)
      || improvements.length === 0) {
      violations.push(violation(
        "METRIC_MISMATCH",
        `alternative improvements=${JSON.stringify(alternative.improvements)}; measured=${JSON.stringify(improvements)}`,
        `${path}.improvements`,
      ));
    }
    const alternativeVisitCount = alternative.days.reduce(
      (count, day) => count + day.items.length,
      0,
    );
    const alternativeCoveredGroups = [...alternative.selectionGroups.covered].sort();
    if (alternativeVisitCount !== recommendedVisitCount
      || JSON.stringify(alternativeCoveredGroups) !== JSON.stringify(recommendedCoveredGroups)
      || alternative.comparisonKeys.selectionGroupCoverageCount
        !== result.comparisonKeys.selectionGroupCoverageCount
      || alternative.comparisonKeys.selectedUnionPlaceCount
        !== result.comparisonKeys.selectedUnionPlaceCount) {
      violations.push(violation(
        "METRIC_MISMATCH",
        "alternative changed selection-group coverage or visited-place count",
        `${path}.comparisonKeys`,
      ));
    }
    const alternativeResult: ItineraryResult = {
      status: "planned",
      days: alternative.days,
      rejectedPlaces: alternative.rejectedPlaces,
      warnings: alternative.warnings,
      selectionGroups: alternative.selectionGroups,
      comparisonKeys: alternative.comparisonKeys,
      metrics: alternative.metrics,
      ...(alternative.preferredDateOutcomes
        ? { preferredDateOutcomes: alternative.preferredDateOutcomes }
        : {}),
      ...(alternative.preferredOrderOutcomes
        ? { preferredOrderOutcomes: alternative.preferredOrderOutcomes }
        : {}),
    };
    for (const nested of validateItinerary(alternativeResult, constraints, repos)) {
      violations.push({
        ...nested,
        path: nested.path
          ? `${path}.${nested.path}`
          : path,
      });
    }
  }
  return violations;
}
