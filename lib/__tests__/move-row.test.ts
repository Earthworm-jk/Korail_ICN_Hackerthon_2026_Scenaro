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

  it("타임라인에서 관람보다 중립적인 이동 연결점 색·형태를 쓴다", () => {
    expect(timelineCss).toMatch(/data-itinerary-row="train"[^}]*::before[\s\S]*?background:\s*var\(--sc-line-strong\)/);
    expect(timelineCss).toMatch(/data-itinerary-row="gateway"[^}]*::before/);
    expect(timelineCss).toMatch(/border-radius:\s*1px/);
  });

  it("관광지 카드에 색 면을 주고 이동 라벨은 중립색으로 낮춘다", () => {
    expect(timelineCss).toMatch(/\[data-itinerary-row="place"\]\s*{[^}]*background:\s*color-mix/);
    expect(timelineCss).toMatch(/\[data-move-row\] \[data-move-kind\]\s*{[^}]*color:\s*var\(--sc-muted\)/);
  });

  it("이동 행은 관람 행과 가로폭을 맞추고 세로 높이만 줄인다", () => {
    expect(timelineCss).toMatch(/\[data-move-summary\]\s*{[^}]*width:\s*100%/);
    expect(timelineCss).not.toContain("width: min(100%, 184px)");
    expect(timelineCss).toMatch(/\[data-move-summary\]\s*{[^}]*grid-template-columns:\s*auto minmax\(0, 1fr\)/);
    expect(timelineCss).toMatch(/li\[data-itinerary-row="train"\],[\s\S]*?li\[data-itinerary-row="gateway"\]\s*{[^}]*height:\s*78px/);
  });
});
