import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * 시트 레이아웃 계약 (#207, PR #154 리뷰)
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

describe("전체 촬영지 단일 진입", () => {
  it("시트가 flex 컬럼이라 자식이 그 높이 안에서 스크롤한다", () => {
    const sheet = ruleOf(css, ".sheet");
    expect(sheet).toContain("display: flex");
    expect(sheet).toContain("flex-direction: column");
  });

  it("5개 미리보기 본문과 가로 목록 규칙이 없다", () => {
    expect(css).not.toMatch(/^\.body\s*\{/m);
    expect(css).not.toMatch(/^\.list\s*\{/m);
    expect(css).not.toMatch(/^\.more(Item)?\s*\{/m);
  });

  it("전체 촬영지 진입 버튼은 충분한 높이와 hover 피드백을 갖는다", () => {
    expect(css).toMatch(/\.openBrowser\s*\{\s*min-height:\s*44px/);
    expect(css).toContain(".openBrowser:hover");
  });

  it("AI 추천이 있을 때만 쓰는 보조 영역은 자체 스크롤 경계를 갖는다", () => {
    const recommendations = ruleOf(css, ".recommendations");
    expect(recommendations).toContain("max-height");
    expect(recommendations).toContain("overflow-y: auto");
  });
});

describe("모서리 버튼 여백 예약", () => {
  /**
   * 버튼은 카드 오른쪽에서 `inset`만큼 안쪽에서 시작해 `size`만큼 차지한다. 이름 줄이
   * `size`만 비우면 **`inset`만큼 겹친다** — 실제로 40px 버튼에 40px만 비워 두고 있었다.
   *
   * 그래서 값을 크게 적어 두는 대신 파생시켰다. 이 테스트가 지키는 것은 여백의 *크기*가
   * 아니라 **파생 관계 자체**다. 상수로 되돌아가면 버튼만 커졌을 때 조용히 어긋난다.
   */
  it("이름 줄 여백이 버튼 크기·오프셋·간격에서 파생된다", () => {
    const bar = ruleOf(css, ".photoCardBar");
    const reserved = bar.match(/padding-right:\s*calc\(([\s\S]*?)\);/);
    expect(reserved, "padding-right가 calc 파생이 아니다").not.toBeNull();
    for (const token of ["--corner-button-inset", "--corner-button-size", "--corner-button-gap"]) {
      expect(reserved![1]).toContain(token);
    }
  });

  it("버튼과 이름 줄이 같은 변수를 본다 — 값은 카드가 한 번만 정의한다", () => {
    const card = ruleOf(css, ".photoCard");
    expect(card).toMatch(/--corner-button-size:\s*\d+px/);
    expect(card).toMatch(/--corner-button-inset:\s*\d+px/);
    expect(card).toMatch(/--corner-button-gap:\s*\d+px/);
    expect(ruleOf(css, ".cornerButton")).toContain("var(--corner-button-size)");
    expect(ruleOf(css, ".cornerButtonDetail")).toContain("var(--corner-button-inset)");
  });

  /** 예약 폭은 언제나 버튼이 차지하는 폭보다 커야 한다 — 파생식을 실제로 계산해 본다 */
  it("계산해 보면 예약 폭이 버튼 오른쪽 끝을 넘어선다", () => {
    const card = ruleOf(css, ".photoCard");
    const px = (name: string) => Number(card.match(new RegExp(`${name}:\\s*(\\d+)px`))![1]);
    const size = px("--corner-button-size");
    const inset = px("--corner-button-inset");
    const gap = px("--corner-button-gap");
    expect(inset + size + gap).toBeGreaterThan(inset + size);
    // 히트 영역 하한도 여기서 같이 지킨다
    expect(size).toBeGreaterThanOrEqual(40);
  });
});

describe("사진 카드 오버레이", () => {
  it("cover 썸네일이 카드를 채운다 — 미디어 쿼리의 64px에 지지 않게 명시도를 겹친다", () => {
    const cover = ruleOf(css, ".thumbnail.thumbnailCover");
    expect(cover).toContain("width: 100%");
    expect(cover).toContain("height: 100%");
  });

  /**
   * 출처와 운영시간 경고는 **동시에** 뜰 수 있다. 둘 다 좌상단에 있으면 겹치므로
   * 서로 다른 앵커에 묶는다 — 출처는 위, 이름 줄(운영시간 경고가 들어간)은 아래.
   * 값이 아니라 이 분리 자체가 계약이다.
   */
  it("출처는 위에, 이름 줄은 아래에 고정돼 동시에 떠도 겹치지 않는다", () => {
    const attribution = ruleOf(css, ".thumbnail.thumbnailCover .thumbnailAttribution");
    expect(attribution).toContain("top: 4px");
    expect(attribution).toContain("bottom: auto");

    const bar = ruleOf(css, ".photoCardBar");
    expect(bar).toContain("bottom: 0");
    expect(bar).not.toMatch(/\btop:/);
  });
});
