import type { ItineraryResult } from "../engine/types";

export type EvaluationCategory =
  | "feasible"
  | "infeasible"
  | "flight_change"
  | "passenger_advisory_change"
  | "determinism"
  | "offline_fallback";

export type EvaluationViolationCode =
  | "EXPECTED_OUTCOME_MISMATCH"
  | "INVALID_INTERVAL"
  | "ITINERARY_OVERLAP"
  | "OUTSIDE_TRIP_WINDOW"
  | "EXCLUDED_PLACE_REINTRODUCED"
  | "DAILY_CAPACITY_EXCEEDED"
  | "DUPLICATE_PLACE"
  | "UNKNOWN_PLACE"
  | "STAY_TIME_SHORTFALL"
  | "UNKNOWN_TRAIN_RIDE"
  | "TRAIN_SNAPSHOT_MISMATCH"
  | "MIN_TRANSFER_VIOLATION"
  | "WARNING_TARGET_MISSING"
  | "SELECTION_GROUP_UNCOVERED"
  | "METRIC_MISMATCH"
  | "PAIRED_CHANGE_MISMATCH"
  | "NON_DETERMINISTIC_OUTPUT"
  | "FALLBACK_NOT_COMPLETED";

export type EvaluationViolation = {
  code: EvaluationViolationCode;
  message: string;
  path?: string;
};

export type ScenarioObservation = {
  actualStatus: string;
  itinerary?: ItineraryResult;
  violations?: EvaluationViolation[];
  details?: Record<string, unknown>;
  recomputationSamplesMs?: number[];
};

export type GoldenScenario = {
  id: string;
  title: string;
  category: EvaluationCategory;
  expectedStatus: string;
  invariants: string[];
  allowedOutcomes: string[];
  execute: () => Promise<ScenarioObservation>;
};

export type ScenarioResult = {
  id: string;
  title: string;
  category: EvaluationCategory;
  expectedStatus: string;
  actualStatus: string;
  passed: boolean;
  durationMs: number;
  invariants: string[];
  allowedOutcomes: string[];
  violations: EvaluationViolation[];
  details?: Record<string, unknown>;
};

export type MetricResult = {
  numerator: number;
  denominator: number;
  rate: number | null;
  failureCondition: string;
};

export type EvaluationReport = {
  schemaVersion: 1;
  issue: 181;
  generatedAt: string;
  scenarioCount: number;
  passedCount: number;
  failedCount: number;
  metrics: {
    hardConstraintCompliance: MetricResult;
    feasibleSuccess: MetricResult;
    infeasibleAccuracy: MetricResult;
    changeResponseSuccess: MetricResult;
    passengerAdvisoryAccuracy: MetricResult;
    determinismAndFallbackCompletion: MetricResult;
    recomputationTimeMs: { sampleCount: number; p50: number | null; p95: number | null };
  };
  deferredMetrics: Array<{ name: string; reason: string }>;
  scenarios: ScenarioResult[];
};
