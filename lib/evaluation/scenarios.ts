import { getFlightInfo } from "../actions/flights";
import { TripConstraintsSchema, generateItinerary } from "../engine";
import type { TripConstraints } from "../engine/types";
import { evaluateAirportPassengerAdvisory, type AirportPassengerPoint } from "../airport-passenger-advisory";
import { diffItineraries } from "../itinerary-diff";
import { loadRepositories } from "../repositories/json";
import { performance } from "node:perf_hooks";
import type {
  EvaluationViolation,
  GoldenScenario,
  ScenarioObservation,
} from "./types";
import { validateItinerary } from "./validator";

const repos = loadRepositories();
const NOW = new Date("2026-08-12T03:00:00Z"); // KST 2026-08-12 12:00

const BASE: TripConstraints = {
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

const PASSENGER_POINTS: AirportPassengerPoint[] = [
  { date: "2026-08-12", hour: 9, terminal: "T1", direction: "arrival", passengerCount: 500 },
  { date: "2026-08-12", hour: 10, terminal: "T1", direction: "arrival", passengerCount: 700 },
  { date: "2026-08-12", hour: 11, terminal: "T1", direction: "arrival", passengerCount: 1200 },
  { date: "2026-08-12", hour: 12, terminal: "T1", direction: "arrival", passengerCount: 900 },
  { date: "2026-08-13", hour: 9, terminal: "T1", direction: "departure", passengerCount: 400 },
  { date: "2026-08-13", hour: 10, terminal: "T1", direction: "departure", passengerCount: 500 },
  { date: "2026-08-13", hour: 11, terminal: "T1", direction: "departure", passengerCount: 800 },
  { date: "2026-08-13", hour: 12, terminal: "T1", direction: "departure", passengerCount: 600 },
];

const mismatch = (expected: string, actual: string): EvaluationViolation => ({
  code: "EXPECTED_OUTCOME_MISMATCH",
  message: `expected ${expected}; received ${actual}`,
});

function timedGenerate(constraints: TripConstraints) {
  const startedAt = performance.now();
  const itinerary = generateItinerary(constraints, repos);
  return {
    itinerary,
    durationMs: Number((performance.now() - startedAt).toFixed(2)),
  };
}

function planObservation(
  constraints: TripConstraints,
  expectedStatus: "planned" | "empty" = "planned",
): ScenarioObservation {
  const parsed = TripConstraintsSchema.safeParse(constraints);
  if (!parsed.success) {
    return {
      actualStatus: "invalid",
      violations: [mismatch(expectedStatus, "invalid")],
      details: { fieldErrors: parsed.error.flatten().fieldErrors },
    };
  }
  const { itinerary, durationMs } = timedGenerate(parsed.data);
  const requestedGroups = [
    ...((parsed.data.selectedActorIds?.length ?? 0) > 0 || parsed.data.selectedActorId ? ["actor" as const] : []),
    ...(parsed.data.selectedWorkIds.length > 0 ? ["work" as const] : []),
  ];
  const uncoveredGroups = itinerary.status === "planned"
    ? requestedGroups.filter((group) => !itinerary.selectionGroups.covered.includes(group))
    : [];
  return {
    actualStatus: itinerary.status,
    itinerary,
    recomputationSamplesMs: [durationMs],
    violations: [
      ...(itinerary.status === expectedStatus ? [] : [mismatch(expectedStatus, itinerary.status)]),
      ...uncoveredGroups.map((group) => ({
        code: "SELECTION_GROUP_UNCOVERED" as const,
        message: `requested ${group} selection group is not covered`,
        path: "selectionGroups.covered",
      })),
      ...validateItinerary(itinerary, parsed.data, repos),
    ],
    details: itinerary.status === "planned"
      ? {
          visitedPlaceCount: itinerary.days.reduce((sum, day) => sum + day.items.length, 0),
          rejectedPlaceCount: itinerary.rejectedPlaces.length,
          warningCount: itinerary.warnings.length,
        }
      : { rejectedPlaceCount: itinerary.rejectedPlaces.length },
  };
}

function invalidObservation(constraints: TripConstraints): ScenarioObservation {
  const parsed = TripConstraintsSchema.safeParse(constraints);
  return parsed.success
    ? { actualStatus: "accepted", violations: [mismatch("invalid", "accepted")] }
    : {
        actualStatus: "invalid",
        details: {
          fields: [...new Set(parsed.error.issues.map((issue) => issue.path[0]).filter(Boolean))],
        },
      };
}

const feasible = (
  id: string,
  title: string,
  selection: Pick<TripConstraints, "selectedActorIds" | "selectedWorkIds">,
): GoldenScenario => ({
  id,
  title,
  category: "feasible",
  expectedStatus: "planned",
  invariants: ["hard_constraints_zero", "selected_group_covered"],
  allowedOutcomes: ["planned"],
  execute: async () => planObservation({ ...BASE, ...selection }),
});

const invalid = (
  id: string,
  title: string,
  patch: Partial<TripConstraints>,
): GoldenScenario => ({
  id,
  title,
  category: "infeasible",
  expectedStatus: "invalid",
  invariants: ["no_forced_itinerary", "structured_invalid_result"],
  allowedOutcomes: ["invalid"],
  execute: async () => invalidObservation({ ...BASE, ...patch }),
});

const empty = (
  id: string,
  title: string,
  patch: Partial<TripConstraints>,
): GoldenScenario => ({
  id,
  title,
  category: "infeasible",
  expectedStatus: "empty",
  invariants: ["valid_input", "no_forced_itinerary", "explicit_empty_result"],
  allowedOutcomes: ["empty"],
  execute: async () => planObservation({ ...BASE, ...patch }, "empty"),
});

export function goldenScenarios(): GoldenScenario[] {
  return [
    feasible("G01", "입국 · 김고은 배우 일정", { selectedActorIds: ["actor-kim-go-eun"], selectedWorkIds: [] }),
    feasible("G02", "입국 · 도깨비 작품 일정", { selectedActorIds: [], selectedWorkIds: ["work-goblin"] }),
    feasible("G03", "입국 · 박보검과 도깨비 복합 일정", { selectedActorIds: ["actor-park-bo-gum"], selectedWorkIds: ["work-goblin"] }),
    feasible("G04", "입출국 · 공유 배우 일정", { selectedActorIds: ["actor-gong-yoo"], selectedWorkIds: [] }),
    feasible("G05", "입출국 · 이민호 배우 일정", { selectedActorIds: ["actor-lee-min-ho"], selectedWorkIds: [] }),
    feasible("G06", "입출국 · 김태리 배우 일정", { selectedActorIds: ["actor-kim-tae-ri"], selectedWorkIds: [] }),
    feasible("G07", "출국 마감 · 남자친구 작품 일정", { selectedActorIds: [], selectedWorkIds: ["work-encounter"] }),
    feasible("G08", "출국 마감 · 청춘기록 작품 일정", { selectedActorIds: [], selectedWorkIds: ["work-record-of-youth"] }),

    invalid("G09", "항공 도착보다 이른 출국", { departureAt: "2026-08-12T09:00:00+09:00" }),
    invalid("G10", "입국 전 공항 출발 가능 시각", { airportReadyAt: "2026-08-12T09:00:00+09:00" }),
    invalid("G11", "항공 출국 뒤 공항 도착 마감", { airportArrivalDeadline: "2026-08-14T19:00:00+09:00" }),
    invalid("G12", "공항 출발 가능 시각과 도착 마감 역전", {
      airportReadyAt: "2026-08-14T17:00:00+09:00",
    }),
    empty("G13", "유효한 입력 · 마지막 연결이 성립하지 않는 5분 시간 창", {
      departureAt: "2026-08-12T14:00:00+09:00",
      airportArrivalDeadline: "2026-08-12T12:05:00+09:00",
    }),

    {
      id: "G14",
      title: "항공편 2시간 지연 paired recalculation",
      category: "flight_change",
      expectedStatus: "changed_and_feasible",
      invariants: ["both_results_hard_constraints_zero", "structured_diff_changed", "missed_ride_is_scoped"],
      allowedOutcomes: ["changed_and_feasible", "explicitly_infeasible"],
      execute: async () => {
        const delayed = {
          ...BASE,
          arrivalAt: "2026-08-12T12:00:00+09:00",
          airportReadyAt: "2026-08-12T14:00:00+09:00",
        };
        const before = timedGenerate(BASE).itinerary;
        const afterRun = timedGenerate(delayed);
        const after = afterRun.itinerary;
        const beforeViolations = validateItinerary(before, BASE, repos);
        const afterViolations = validateItinerary(after, delayed, repos);
        const diff = diffItineraries(before, after, {
          unusable: { kind: "trip_start", notBefore: delayed.airportReadyAt },
        });
        const violations = [...beforeViolations, ...afterViolations];
        if (after.status !== "planned" || !diff.changed || diff.rides.missed.length === 0) {
          violations.push({
            code: "PAIRED_CHANGE_MISMATCH",
            message: "delay did not produce a feasible changed itinerary with a scoped missed ride",
          });
        }
        return {
          actualStatus: after.status === "planned" && diff.changed ? "changed_and_feasible" : after.status,
          itinerary: after,
          recomputationSamplesMs: [afterRun.durationMs],
          violations,
          details: {
            missedRideCount: diff.rides.missed.length,
            replacementRideCount: diff.rides.added.length,
            movedPlaceCount: diff.places.moved.length,
            droppedPlaceCount: diff.places.dropped.length,
          },
        };
      },
    },
    {
      id: "G15",
      title: "승객예고 동일 시간대 · 여유 120→150분 paired test",
      category: "passenger_advisory_change",
      expectedStatus: "elevated_to_clear",
      invariants: ["relative_signal_only", "slack_threshold_120_minutes"],
      allowedOutcomes: ["elevated_to_clear"],
      execute: async () => {
        const common = { direction: "arrival" as const, selectedAt: "2026-08-12T11:00", terminal: "T1", points: PASSENGER_POINTS, source: "snapshot" as const, now: NOW };
        const before = evaluateAirportPassengerAdvisory({ ...common, selectedSlackMinutes: 120 });
        const after = evaluateAirportPassengerAdvisory({ ...common, selectedSlackMinutes: 150 });
        const actualStatus = `${before.status}_to_${after.status}`;
        return {
          actualStatus,
          violations: actualStatus === "elevated_to_clear" ? [] : [{ code: "PAIRED_CHANGE_MISMATCH", message: `received ${actualStatus}` }],
          details: { before: before.status, after: after.status, threshold: before.elevatedThreshold },
        };
      },
    },
    {
      id: "G16",
      title: "승객예고 동일 여유 · 상위→비상위 시간대 paired test",
      category: "passenger_advisory_change",
      expectedStatus: "elevated_to_clear",
      invariants: ["same_date_direction_terminal_bucket", "non_peak_is_clear"],
      allowedOutcomes: ["elevated_to_clear"],
      execute: async () => {
        const common = { direction: "arrival" as const, selectedSlackMinutes: 120, terminal: "T1", points: PASSENGER_POINTS, source: "snapshot" as const, now: NOW };
        const before = evaluateAirportPassengerAdvisory({ ...common, selectedAt: "2026-08-12T11:00" });
        const after = evaluateAirportPassengerAdvisory({ ...common, selectedAt: "2026-08-12T10:00" });
        const actualStatus = `${before.status}_to_${after.status}`;
        return {
          actualStatus,
          violations: actualStatus === "elevated_to_clear" ? [] : [{ code: "PAIRED_CHANGE_MISMATCH", message: `received ${actualStatus}` }],
          details: { beforeHour: before.hour, afterHour: after.hour, threshold: before.elevatedThreshold },
        };
      },
    },
    {
      id: "G17",
      title: "승객예고 D+1→D+2 범위 변경 paired test",
      category: "passenger_advisory_change",
      expectedStatus: "elevated_to_out_of_range",
      invariants: ["d_day_and_d_plus_1_only", "no_future_congestion_inference"],
      allowedOutcomes: ["elevated_to_out_of_range"],
      execute: async () => {
        const common = { direction: "departure" as const, selectedSlackMinutes: 120, terminal: "T1", points: PASSENGER_POINTS, source: "snapshot" as const, now: NOW };
        const before = evaluateAirportPassengerAdvisory({ ...common, selectedAt: "2026-08-13T11:00" });
        const after = evaluateAirportPassengerAdvisory({ ...common, selectedAt: "2026-08-14T11:00" });
        const actualStatus = `${before.status}_to_${after.status}`;
        return {
          actualStatus,
          violations: actualStatus === "elevated_to_out_of_range" ? [] : [{ code: "PAIRED_CHANGE_MISMATCH", message: `received ${actualStatus}` }],
        };
      },
    },
    {
      id: "G18",
      title: "동일 일정 입력 3회 결정성",
      category: "determinism",
      expectedStatus: "deterministic",
      invariants: ["byte_equivalent_structured_output"],
      allowedOutcomes: ["deterministic"],
      execute: async () => {
        const runs = Array.from({ length: 3 }, () => timedGenerate(BASE));
        const outputs = runs.map(({ itinerary }) => itinerary);
        const serialized = outputs.map((result) => JSON.stringify(result));
        const deterministic = serialized.every((value) => value === serialized[0]);
        return {
          actualStatus: deterministic ? "deterministic" : "non_deterministic",
          itinerary: outputs[0],
          recomputationSamplesMs: runs.map(({ durationMs }) => durationMs),
          violations: [
            ...validateItinerary(outputs[0], BASE, repos),
            ...(deterministic ? [] : [{ code: "NON_DETERMINISTIC_OUTPUT" as const, message: "three structured outputs differ" }]),
          ],
          details: { repetitions: 3 },
        };
      },
    },
    {
      id: "G19",
      title: "외부 호출 없는 항공편 스냅샷 폴백 완주",
      category: "offline_fallback",
      expectedStatus: "snapshot_planned",
      invariants: ["no_live_request_without_search_date", "snapshot_to_planner_completion"],
      allowedOutcomes: ["snapshot_planned"],
      execute: async () => {
        // 조회 날짜를 생략하면 환경 키 유무와 관계없이 라이브 호출을 건너뛰는 오프라인 경로다.
        const flight = await getFlightInfo("AF264", "arrival");
        if (!flight.ok || flight.source !== "snapshot") {
          return { actualStatus: "fallback_failed", violations: [{ code: "FALLBACK_NOT_COMPLETED", message: "AF264 snapshot was not returned" }] };
        }
        const constraints = {
          ...BASE,
          arrivalAt: flight.flight.scheduledAt,
          airportReadyAt: "2026-08-12T11:35:00+09:00",
        };
        const run = timedGenerate(constraints);
        const itinerary = run.itinerary;
        const violations = validateItinerary(itinerary, constraints, repos);
        if (itinerary.status !== "planned") violations.push({ code: "FALLBACK_NOT_COMPLETED", message: "snapshot did not reach a planned itinerary" });
        return { actualStatus: itinerary.status === "planned" ? "snapshot_planned" : itinerary.status, itinerary, violations, recomputationSamplesMs: [run.durationMs], details: { flightNo: flight.flight.flightNo, source: flight.source } };
      },
    },
    {
      id: "G20",
      title: "D+1 승객예고 스냅샷 3회 결정성",
      category: "determinism",
      expectedStatus: "deterministic_elevated",
      invariants: ["same_fixture_same_advisory", "d_plus_1_supported"],
      allowedOutcomes: ["deterministic_elevated"],
      execute: async () => {
        const input = { direction: "departure" as const, selectedAt: "2026-08-13T11:00", selectedSlackMinutes: 120, terminal: "T1", points: PASSENGER_POINTS, source: "snapshot" as const, now: NOW };
        const outputs = Array.from({ length: 3 }, () => evaluateAirportPassengerAdvisory(input));
        const deterministic = outputs.every((output) => JSON.stringify(output) === JSON.stringify(outputs[0]));
        const actualStatus = deterministic && outputs[0].status === "elevated" ? "deterministic_elevated" : "mismatch";
        return { actualStatus, violations: actualStatus === "deterministic_elevated" ? [] : [{ code: "NON_DETERMINISTIC_OUTPUT", message: "D+1 advisory output differs or is not elevated" }], details: { repetitions: 3, advisory: outputs[0].status } };
      },
    },
  ];
}
