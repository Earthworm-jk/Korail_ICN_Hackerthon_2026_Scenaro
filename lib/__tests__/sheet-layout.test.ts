import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * 시트 레이아웃 계약 (#146 1절, PR #154 리뷰)
 *
 * 브라우저 실측으로만 잡던 회귀들이다. 실측은 재현되지 않으니 **계약을 고정한다** —
 * 셋 다 "규칙 하나가 빠지면 조용히 잘리는" 부류라 값 자체를 못박아야 의미가 있다.
 */
const css = readFileSync(
  fileURLToPath(new URL("../../app/place-recommendation-sheet.module.css", import.meta.url)),
  "utf8",
);

/** 중괄호 블록 하나를 통째로 꺼낸다 */
function ruleOf(source: string, selector: string): string {
  const at = source.indexOf(`${selector} {`);
  expect(at, `${selector} 규칙이 없다`).toBeGreaterThan(-1);
  return source.slice(at, source.indexOf("}", at));
}

const desktop = css.slice(css.indexOf("@media (min-width: 1024px)"));

describe("시트 스크롤 경계", () => {
  /**
   * `.sheet`가 `max-height`로 잘리는데 `.body`가 줄어들 수 없으면, 스크롤바는 생기지만
   * 부모의 `overflow: hidden`이 아랫부분을 잘라 **끝까지 닿지 않는다.**
   */
  it("시트가 flex 컬럼이라 자식이 그 높이 안에서 스크롤한다", () => {
    const sheet = ruleOf(css, ".sheet");
    expect(sheet).toContain("display: flex");
    expect(sheet).toContain("flex-direction: column");
  });

  it("본문이 부모 높이 안에서 줄어들 수 있다", () => {
    const body = ruleOf(css, ".body");
    expect(body).toContain("min-height: 0");
    expect(body).toMatch(/flex: 1/);
    expect(body).toContain("overflow-y: auto");
  });

  it("데스크톱에서 시트 높이를 제한하는 쪽은 여전히 시트다", () => {
    expect(ruleOf(desktop, ".sheet")).toMatch(/max-height/);
  });
});

describe("카드 줄", () => {
  // 시트는 지도 위에 떠 있다 — 세로로 자라면 지도를 덮는다
  it("가로로 눕고 가로 스크롤한다", () => {
    const list = ruleOf(css, ".list");
    expect(list).toContain("grid-auto-flow: column");
    expect(list).toContain("overflow-x: auto");
  });

  it("카드 최소 폭 200px는 어느 폭에서도 유지된다", () => {
    expect(ruleOf(css, ".list")).toContain("minmax(200px");
    // 태블릿에서 다시 좁히지 않는다 — 한글 이름이 잘린다
    expect(desktop).not.toMatch(/minmax\(1[0-9]{2}px/);
  });

  it("태블릿에서 히트 영역을 강제로 줄이지 않는다", () => {
    expect(desktop).not.toContain("min-height: 28px");
  });
});

describe("사진 카드 오버레이", () => {
  it("cover 썸네일이 카드를 채운다 — 미디어 쿼리의 64px에 지지 않게 명시도를 겹친다", () => {
    const cover = ruleOf(css, ".thumbnail.thumbnailCover");
    expect(cover).toContain("width: 100%");
    expect(cover).toContain("height: 100%");
  });

  // 좌상단은 출처 표기 단독 — 운영시간 배지는 이름 줄로 내려갔다
  it("cover에서 출처 표기가 좌상단으로 간다", () => {
    const attribution = ruleOf(css, ".thumbnail.thumbnailCover .thumbnailAttribution");
    expect(attribution).toContain("top: 4px");
    expect(attribution).toContain("bottom: auto");
  });
});
