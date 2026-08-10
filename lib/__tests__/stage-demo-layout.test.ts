import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const stageCss = readFileSync(
  new URL("../../app/stage-v4.css", import.meta.url),
  "utf8",
);

describe("태블릿 데모 레이아웃 계약", () => {
  it("하단 보조 기능을 한 줄로 유지해 최종 일정 CTA 영역을 비운다", () => {
    expect(stageCss).toMatch(
      /#stage-utility-dock\s*\{[^}]*width:\s*calc\(100vw - 462px\)[^}]*grid-template-columns:\s*repeat\(4,/,
    );
  });

  it("고정 패널을 피해 최종 액션까지 스크롤할 실제 여백을 둔다", () => {
    expect(stageCss).toMatch(
      /body:has\(div#place-picker\[data-place-sheet\]\) main\s*\{[^}]*padding-bottom:\s*88px !important/,
    );
    expect(stageCss).toContain("scroll-margin-bottom: 92px");
  });
});
