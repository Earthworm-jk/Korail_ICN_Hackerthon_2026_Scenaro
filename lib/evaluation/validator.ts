import type { Repositories } from "../repositories/json";
import type { ItineraryResult, TripConstraints } from "../engine/types";
import type { EvaluationViolation } from "./types";

const MIN_TRANSFER_MINUTES = 15;
const MINUTE_MS = 60_000;

const violation = (
  code: EvaluationViolation["code"],
  message: string,
  path?: string,
): EvaluationViolation => ({ code, message, ...(path ? { path } : {}) });

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
  if (result.warnings.length !== result.comparisonKeys.activityWarningCount) {
    violations.push(violation(
      "METRIC_MISMATCH",
      `warning count=${result.warnings.length}; comparison key=${result.comparisonKeys.activityWarningCount}`,
      "comparisonKeys.activityWarningCount",
    ));
  }
  return violations;
}
