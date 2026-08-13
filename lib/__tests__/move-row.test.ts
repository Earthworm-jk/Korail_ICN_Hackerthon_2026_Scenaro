import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MoveRow } from "../../app/move-row";

const timelineCss = readFileSync(
  fileURLToPath(new URL("../../app/globals.css", import.meta.url)),
  "utf8",
);

describe("관람과 이동의 시각적 구분", () => {
  it("접힌 이동 행에서도 이동 종류·시각·구간·소요를 명시한다", () => {
    const markup = renderToStaticMarkup(createElement(
      MoveRow,
      {
        collapsed: true,
        icon: createElement("span", null, "기차"),
        label: "이동",
        route: "서울역 → 강릉역",
        startAt: "12:11",
        duration: "2시간 3분",
      },
      createElement("span", null, "상세 정보"),
    ));

    expect(markup).toContain("data-move-row");
    expect(markup).toContain("data-move-summary");
    expect(markup).toContain("data-move-kind");
    expect(markup).toContain("이동");
    expect(markup).toContain("12:11");
    expect(markup).toContain("서울역 → 강릉역");
    expect(markup).toContain("2시간 3분");
  });

  it("펼친 이동 행에도 이동 라벨을 유지한다", () => {
    const markup = renderToStaticMarkup(createElement(
      MoveRow,
      {
        collapsed: false,
        icon: createElement("span", null, "차량"),
        label: "이동",
        route: "",
      },
      createElement("span", null, "광화문 → 서울역"),
    ));

    expect(markup).toContain("data-move-kind");
    expect(markup).toContain("이동");
    expect(markup).toContain("광화문 → 서울역");
  });

  it("타임라인에서 관람 점과 다른 이동 연결점 색·형태를 쓴다", () => {
    expect(timelineCss).toMatch(/data-itinerary-row="train"[^}]*::before[\s\S]*?background:\s*var\(--sc-blue\)/);
    expect(timelineCss).toMatch(/data-itinerary-row="gateway"[^}]*::before/);
    expect(timelineCss).toMatch(/border-radius:\s*1px/);
  });
});
