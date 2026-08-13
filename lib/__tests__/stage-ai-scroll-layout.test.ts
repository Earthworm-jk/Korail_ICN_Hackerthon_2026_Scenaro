import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const css = source("../../app/stage-v4.css");
const wizard = source("../../app/planner-wizard.tsx");
const panel = source("../../app/itinerary-command-panel.tsx");

describe("AI 카드가 열린 일정 화면의 스크롤 계약", () => {
  it("CSS 셀렉터가 실제 일정 stage와 앱 셸 표식에 결합된다", () => {
    for (const marker of ["data-planner-stage", "data-app-shell"]) {
      expect(wizard).toContain(marker);
      expect(css).toContain(`[${marker}]`);
    }
    expect(panel).toContain("data-itinerary-command-panel");
    expect(css).toContain(":has([data-itinerary-command-panel])");
  });

  it("레이아웃 상수는 이름 있는 변수와 근거 설명으로 유지한다", () => {
    for (const variable of [
      "--sc-stage-min-height",
      "--sc-stage-max-height",
      "--sc-stage-fixed-chrome",
      "--sc-stage-day-min-height",
      "--sc-stage-day-viewport-height",
    ]) expect(css).toContain(variable);
    expect(css).toContain("#212에서 70px");
  });

  it("AI 카드가 열려도 둥근 셸은 가로 overflow를 계속 자른다", () => {
    expect(css).toMatch(/\[data-app-shell\]\s*\{[\s\S]*?overflow-x:\s*clip;[\s\S]*?overflow-y:\s*visible;/);
  });
});
