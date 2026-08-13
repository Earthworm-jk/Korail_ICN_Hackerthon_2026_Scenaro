import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * 스테이지 높이 하한의 범위 (#146 ②, PR #155 리뷰)
 *
 * `stage-v4.css`의 하한은 **ID 선택자**라 Tailwind 유틸리티를 명시도로 이긴다. 그래서
 * 컴포넌트가 `min-h-10`으로 40px를 요구해도 조용히 36px로 대체됐고, 터치 영역 계약이
 * 화면에서 무효가 됐다. 컴포넌트마다 `!important`로 되돌리면 함정이 그대로 남으므로
 * **규칙의 범위를 좁혔다.** 그 범위가 다시 넓어지지 않게 고정한다.
 */
const css = readFileSync(
  fileURLToPath(new URL("../../app/stage-v4.css", import.meta.url)),
  "utf8",
);
const sheet = readFileSync(
  fileURLToPath(new URL("../../app/place-recommendation-sheet.tsx", import.meta.url)),
  "utf8",
);

const RULE = /(#place-picker[^{]*button[^{]*)\{\s*min-height:\s*36px/;

describe("스테이지 버튼 높이 하한", () => {
  it("하한 규칙이 아직 있다 — 레거시 조작부는 이게 필요하다", () => {
    expect(css).toMatch(RULE);
  });

  /** 이게 빠지면 `min-h-10`을 붙여도 36px가 된다 */
  it("스스로 높이를 선언한 버튼은 비켜 간다", () => {
    const selector = css.match(RULE)![1];
    const targets = selector.split(",").map((s) => s.trim()).filter(Boolean);
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      expect(target, `${target}에 min-h 예외가 없다`).toContain(':not([class*="min-h-"])');
    }
  });

  // 전역 44px 일괄 상향은 기존 스테이지 여백을 움직인다 — 하한 값 자체는 그대로 둔다
  it("하한 값을 올려서 해결하지 않는다", () => {
    expect(css).not.toMatch(/#place-picker[^{]*button[^{]*\{\s*min-height:\s*4[0-9]px/);
  });

  it("전체 촬영지의 유일한 진입점은 44px 터치 높이를 직접 선언한다", () => {
    expect(sheet).toMatch(/styles\.openBrowser[^"`]*min-h-11/);
  });
});
