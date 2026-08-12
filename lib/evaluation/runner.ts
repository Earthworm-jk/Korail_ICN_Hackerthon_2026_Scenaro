import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { performance } from "node:perf_hooks";
import { goldenScenarios } from "./scenarios";
import type {
  EvaluationCategory,
  EvaluationReport,
  MetricResult,
  ScenarioResult,
} from "./types";

const rate = (numerator: number, denominator: number): number | null =>
  denominator === 0 ? null : Number((numerator / denominator).toFixed(4));

function metric(
  results: ScenarioResult[],
  categories: EvaluationCategory[],
  failureCondition: string,
): MetricResult {
  const selected = results.filter((result) => categories.includes(result.category));
  const numerator = selected.filter((result) => result.passed).length;
  return { numerator, denominator: selected.length, rate: rate(numerator, selected.length), failureCondition };
}

function percentile(values: number[], percentileValue: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Number(sorted[Math.ceil(sorted.length * percentileValue) - 1].toFixed(2));
}

export async function runEvaluation(): Promise<EvaluationReport> {
  const scenarios = goldenScenarios();
  const results: ScenarioResult[] = [];
  const recomputationSamplesMs: number[] = [];
  for (const scenario of scenarios) {
    const startedAt = performance.now();
    try {
      const observation = await scenario.execute();
      recomputationSamplesMs.push(...(observation.recomputationSamplesMs ?? []));
      const violations = observation.violations ?? [];
      if (!scenario.allowedOutcomes.includes(observation.actualStatus)
        && !violations.some(({ code }) => code === "EXPECTED_OUTCOME_MISMATCH")) {
        violations.push({
          code: "EXPECTED_OUTCOME_MISMATCH",
          message: `${observation.actualStatus} is not in allowed outcomes: ${scenario.allowedOutcomes.join(", ")}`,
        });
      }
      results.push({
        id: scenario.id,
        title: scenario.title,
        category: scenario.category,
        expectedStatus: scenario.expectedStatus,
        actualStatus: observation.actualStatus,
        passed: violations.length === 0,
        durationMs: Number((performance.now() - startedAt).toFixed(2)),
        invariants: scenario.invariants,
        allowedOutcomes: scenario.allowedOutcomes,
        violations,
        ...(observation.details ? { details: observation.details } : {}),
      });
    } catch (error) {
      results.push({
        id: scenario.id,
        title: scenario.title,
        category: scenario.category,
        expectedStatus: scenario.expectedStatus,
        actualStatus: "exception",
        passed: false,
        durationMs: Number((performance.now() - startedAt).toFixed(2)),
        invariants: scenario.invariants,
        allowedOutcomes: scenario.allowedOutcomes,
        violations: [{
          code: "EXPECTED_OUTCOME_MISMATCH",
          message: error instanceof Error ? error.message : String(error),
        }],
      });
    }
  }

  const hardConstraintResults = results.filter((result) =>
    ["feasible", "flight_change", "offline_fallback"].includes(result.category)
    || result.id === "G18",
  );
  const hardNumerator = hardConstraintResults.filter((result) => result.passed).length;
  return {
    schemaVersion: 1,
    issue: 181,
    generatedAt: new Date().toISOString(),
    scenarioCount: results.length,
    passedCount: results.filter((result) => result.passed).length,
    failedCount: results.filter((result) => !result.passed).length,
    metrics: {
      hardConstraintCompliance: {
        numerator: hardNumerator,
        denominator: hardConstraintResults.length,
        rate: rate(hardNumerator, hardConstraintResults.length),
        failureCondition: "planned/recalculated output has at least one hard-constraint violation code",
      },
      feasibleSuccess: metric(results, ["feasible"], "feasible scenario is not planned or has a validator violation"),
      infeasibleAccuracy: metric(results, ["infeasible"], "invalid scenario is accepted or produces an itinerary"),
      changeResponseSuccess: metric(results, ["flight_change"], "paired flight change lacks a valid new itinerary or explicit infeasible result"),
      passengerAdvisoryAccuracy: metric(results, ["passenger_advisory_change"], "advisory status differs from the fixture expectation"),
      determinismAndFallbackCompletion: metric(results, ["determinism", "offline_fallback"], "repeated output differs or snapshot fallback does not complete"),
      recomputationTimeMs: {
        sampleCount: recomputationSamplesMs.length,
        p50: percentile(recomputationSamplesMs, 0.5),
        p95: percentile(recomputationSamplesMs, 0.95),
      },
    },
    deferredMetrics: [{
      name: "AI explanation factual consistency",
      reason: "Phase 2: explanation claims need a stable claim schema before they can be matched to structured itinerary diff without heuristic text parsing.",
    }],
    scenarios: results,
  };
}

const percent = (value: number | null) => value === null ? "N/A" : `${(value * 100).toFixed(1)}%`;

export function reportMarkdown(report: EvaluationReport): string {
  const metricRows = [
    ["하드 제약 충족률", report.metrics.hardConstraintCompliance],
    ["feasible 성공률", report.metrics.feasibleSuccess],
    ["infeasible 판정 일치율", report.metrics.infeasibleAccuracy],
    ["항공편 변경 대응 성공률", report.metrics.changeResponseSuccess],
    ["승객예고 판정 일치율", report.metrics.passengerAdvisoryAccuracy],
    ["결정성·폴백 완주율", report.metrics.determinismAndFallbackCompletion],
  ] as const;
  const failed = report.scenarios.filter((scenario) => !scenario.passed);
  return `# #181 골든 평가 리포트

- 생성 시각: ${report.generatedAt}
- 시나리오: ${report.passedCount}/${report.scenarioCount} 통과
- 실패: ${report.failedCount}건

## 실제 측정값

| 지표 | 분자/분모 | 측정값 |
| --- | ---: | ---: |
${metricRows.map(([name, value]) => `| ${name} | ${value.numerator}/${value.denominator} | ${percent(value.rate)} |`).join("\n")}
| 재계산 시간 p50 | ${report.metrics.recomputationTimeMs.sampleCount} samples | ${report.metrics.recomputationTimeMs.p50 ?? "N/A"} ms |
| 재계산 시간 p95 | ${report.metrics.recomputationTimeMs.sampleCount} samples | ${report.metrics.recomputationTimeMs.p95 ?? "N/A"} ms |

## 시나리오

| ID | 범주 | 기대 | 실제 | 결과 | 위반 코드 |
| --- | --- | --- | --- | --- | --- |
${report.scenarios.map((scenario) => `| ${scenario.id} | ${scenario.category} | ${scenario.expectedStatus} | ${scenario.actualStatus} | ${scenario.passed ? "PASS" : "FAIL"} | ${scenario.violations.map(({ code }) => code).join(", ") || "-"} |`).join("\n")}

## 실패 상세

${failed.length === 0 ? "실패 없음." : failed.map((scenario) => `### ${scenario.id}\n\n${scenario.violations.map((item) => `- \`${item.code}\`: ${item.message}`).join("\n")}`).join("\n\n")}

## 2차 범위

- AI 설명 사실 일치율: structured diff와 연결할 claim schema를 먼저 고정한 뒤 별도 지표로 측정합니다.
`;
}

export function writeEvaluationReports(
  report: EvaluationReport,
  jsonPath: string,
  markdownPath: string,
): void {
  mkdirSync(dirname(jsonPath), { recursive: true });
  mkdirSync(dirname(markdownPath), { recursive: true });
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(markdownPath, reportMarkdown(report), "utf8");
}
