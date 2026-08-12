import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const css = read("../../app/stage-v5.css");
const wizard = read("../../app/planner-wizard.tsx");

describe("stage v5 단계 표시", () => {
  it("실제 nav 버튼의 aria-current를 선택한다", () => {
    expect(wizard).toMatch(/<button[\s\S]*?aria-current=\{current \? "step" : undefined\}/);
    expect(css).toContain('> nav > button[aria-current="step"]');
    expect(css).not.toContain('> nav > div[aria-current="step"]');
  });

  it("Step 2 선택 버튼의 최소 터치 높이를 40px로 유지한다", () => {
    expect(css).toMatch(
      /div\[class\*="bg-sc-subtle"\] button\s*\{[\s\S]*?min-height:\s*40px;/,
    );
    expect(css).not.toMatch(
      /div\[class\*="bg-sc-subtle"\] button\s*\{[\s\S]*?min-height:\s*(?:3[0-9])px;/,
    );
  });

  it("과선택 장식 화살표를 CSS 텍스트로 노출하지 않는다", () => {
    expect(css).not.toMatch(/h3::before\s*\{[\s\S]*?content:\s*"↕"/);
    expect(css).toMatch(/h3::before\s*\{[\s\S]*?content:\s*""/);
  });
});
