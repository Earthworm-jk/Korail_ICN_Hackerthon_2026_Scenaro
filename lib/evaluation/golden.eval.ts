import { describe, expect, it } from "vitest";
import { runEvaluation, writeEvaluationReports } from "./runner";

describe("#181 MVP golden evaluation", () => {
  it("20 scenarios pass and emit JSON/Markdown reports", async () => {
    const report = await runEvaluation();
    const outputDir = process.env.EVALUATION_REPORT_DIR ?? "artifacts/evaluation";
    writeEvaluationReports(
      report,
      `${outputDir}/issue-181-evaluation.json`,
      `${outputDir}/issue-181-evaluation.md`,
    );

    expect(report.scenarioCount).toBe(20);
    expect(
      report.scenarios.filter((scenario) => !scenario.passed),
      `see ${outputDir}/issue-181-evaluation.md for scenario IDs and violation codes`,
    ).toEqual([]);
  });
});
