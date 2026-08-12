import { describe, expect, it } from "vitest";
import { runEvaluation, writeEvaluationReports } from "./runner";

describe("#181 MVP golden evaluation", () => {
  it("20 scenarios pass and emit JSON/Markdown reports", async () => {
    const report = await runEvaluation();
    writeEvaluationReports(report);

    expect(report.scenarioCount).toBe(20);
    expect(
      report.scenarios.filter((scenario) => !scenario.passed),
      "see reports/issue-181-evaluation.md for scenario IDs and violation codes",
    ).toEqual([]);
  });
});
