import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * 스테이지 그리드의 단독 소유자 (#146 3-1)
 *
 * 스테이지 그리드 선택자가 `globals` · `stage` · `stage-v2` · `stage-v4` 넷에 흩어져
 * 있었다. 전부 3열(좌 rail / 지도 / 우 rail) 전제였고, 마지막 v4의 2열이 그 위를 덮어
 * **화면은 맞는데 앞 세 파일은 거짓말을 하고 있는** 상태였다.
 *
 * 거짓말이 비싼 이유는 다음 작업 때문이다. 시트를 바닥 독으로 옮기면 v4의 덮어쓰기는
 * 시트를 따라가는데 앞 파일의 3열 전제는 그대로 남아 옛 레이아웃이 되살아난다 —
 * 좌측에 옛 사이드바가 돌아오고 일정 rail이 한 글자 폭으로 짜부라진다. 실제로 그렇게
 * 깨졌다.
 *
 * 그래서 값이 아니라 **소유권**을 고정한다. 어느 파일이 몇 px을 쓰는지는 자유지만,
 * 스테이지 그리드를 정하는 파일은 하나여야 한다.
 */
const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../../app/${name}`, import.meta.url)), "utf8");

/** 스테이지 그리드를 겨냥하는 선택자 — `#place-picker`를 직계로 담은 `div.grid` */
const STAGE_GRID = /[^{}]*div\.grid:has\(>\s*(?:div)?#place-picker[^{}]*\{/g;

const OWNER = "stage-v4.css";
const OTHERS = ["globals.css", "stage.css", "stage-v2.css", "stage-v3.css"];

describe("스테이지 그리드 소유권", () => {
  it.each(OTHERS)("%s는 스테이지 그리드를 정의하지 않는다", (name) => {
    const hits = read(name).match(STAGE_GRID) ?? [];
    expect(hits.map((s) => s.trim()), `${name}에 스테이지 그리드 규칙이 되살아났다`)
      .toEqual([]);
  });

  it(`${OWNER}가 스테이지 그리드를 정의한다`, () => {
    expect((read(OWNER).match(STAGE_GRID) ?? []).length).toBeGreaterThan(0);
  });
});

describe("v4가 인수한 선언", () => {
  /**
   * `display`와 `row-gap`은 v4가 원래 정하지 않던 속성이라, 앞 파일을 지울 때
   * 같이 사라지면 계산 결과가 조용히 바뀐다 — `display`는 stage.css가, `row-gap: 8px`는
   * stage-v2가 실제로 이기고 있었다. 지우면서 v4로 옮겼고, 그 이전을 여기서 지킨다.
   *
   * `row-gap`이 빠지면 Tailwind `gap-[18px]`로 돌아가 줄 간격이 10px 벌어진다.
   * 눈에 잘 안 띄고 스크린샷으로만 잡히는 부류라 값을 못박는다.
   */
  const rule = (() => {
    const css = read(OWNER);
    // 열을 정하는 블록 — `grid-template-columns`를 담은 스테이지 그리드 규칙
    for (const head of css.match(STAGE_GRID) ?? []) {
      const at = css.indexOf(head);
      const body = css.slice(at + head.length, css.indexOf("}", at));
      if (body.includes("grid-template-columns")) return body;
    }
    throw new Error(`${OWNER}에 열을 정하는 스테이지 그리드 규칙이 없다`);
  })();

  it("열 정의를 그대로 들고 있다", () => {
    expect(rule).toMatch(/grid-template-columns:[^;]+;/);
    expect(rule).toMatch(/column-gap:\s*\d+px/);
  });

  it("stage.css에서 넘겨받은 display가 살아 있다", () => {
    expect(rule).toMatch(/display:\s*grid/);
  });

  it("stage-v2에서 넘겨받은 row-gap 8px가 살아 있다", () => {
    expect(rule).toMatch(/row-gap:\s*8px/);
  });
});
