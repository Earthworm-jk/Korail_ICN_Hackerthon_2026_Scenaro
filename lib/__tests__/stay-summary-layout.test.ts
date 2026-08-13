import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { messages } from "../i18n/messages";

const css = readFileSync(
  fileURLToPath(new URL("../../app/globals.css", import.meta.url)),
  "utf8",
);

describe("DAY 시간 요약 표현", () => {
  it("체류·환승을 별도 일정 카드가 아닌 시간 요약으로 부른다", () => {
    expect(messages.ko["step4.stayTitle"]).toBe("체류·환승 시간 요약");
    expect(messages.en["step4.stayTitle"]).toBe("Stop & transfer time summary");
    expect(messages.ko["region.stayGuideOpen"]).toContain("체류·환승");
  });

  it("노란 경고 카드 대신 중립색 한 줄 통계로 표시한다", () => {
    expect(css).toMatch(/ul\[data-day-stays\]\s*\{[\s\S]*?max-width:\s*360px/);
    expect(css).toMatch(/ul\[data-day-stays\] > li\s*\{[\s\S]*?grid-template-columns:\s*auto minmax\(0, 1fr\) auto/);
    expect(css).toMatch(/ul\[data-day-stays\] > li\s*\{[\s\S]*?background:\s*transparent !important/);
    expect(css).toMatch(/ul\[data-day-stays\] \[data-row-main\] > span:first-child\s*\{\s*display:\s*none/);
  });

  it("모바일에서도 120px 일정 카드 높이와 타임라인 점을 사용하지 않는다", () => {
    expect(css).toMatch(/ul\[data-day-rows\]\[data-day-stays\] > li\s*\{[\s\S]*?height:\s*auto/);
    expect(css).toMatch(/ul\[data-day-rows\]\[data-day-stays\] > li::before\s*\{\s*display:\s*none/);
  });
});
