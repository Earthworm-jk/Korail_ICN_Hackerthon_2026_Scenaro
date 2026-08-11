import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DayMoveMenu } from "@/app/day-move-menu";
import type { MessageKey } from "../i18n/messages";

/**
 * DAY 전체 이동의 터치·키보드 경로 (#146 10, PR #157 리뷰 2)
 *
 * 드래그만 두면 태블릿에서 쓸 수 없다. 이 진입점이 **드래그와 같은 일**을 하는지,
 * 그리고 쓸 수 없는 상태를 정직하게 알리는지를 고정한다.
 */
const copy: Partial<Record<MessageKey, string>> = {
  "step4.dayMoveLabel": "이 날 일정을 다른 날로 옮기기",
  "step4.dayMoveTitle": "어느 날로 옮길까요?",
  "step4.dayMoveTarget": "DAY {day} · {date}",
};
const tr = (key: MessageKey) => copy[key] ?? key;

const targets = [
  { date: "2026-08-13", index: 1 },
  { date: "2026-08-14", index: 2 },
];

function render(over: Partial<Parameters<typeof DayMoveMenu>[0]> = {}) {
  return renderToStaticMarkup(createElement(DayMoveMenu, {
    date: "2026-08-12", targets, disabled: false, onMove: () => {}, tr, ...over,
  }));
}

describe("진입점", () => {
  it("버튼과 메뉴가 서로를 가리킨다", () => {
    const html = render();
    const target = html.match(/popover[Tt]arget="([^"]+)"/)?.[1];
    expect(target).toBeTruthy();
    expect(html).toContain(`id="${target}"`);
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('role="menu"');
  });

  /** 버튼이라 Tab으로 닿고 Enter로 열린다 — 드래그에는 없는 경로다 */
  it("아이콘만 있어도 이름을 갖는다", () => {
    expect(render()).toContain('aria-label="이 날 일정을 다른 날로 옮기기"');
  });

  // 태블릿 터치 기준
  it("버튼 40px, 목적일 항목 44px", () => {
    const html = render();
    expect(html).toMatch(/min-h-10/);
    expect(html).toMatch(/min-h-11/);
  });
});

describe("고를 수 있는 것만 보여준다", () => {
  it("목적일마다 일차와 날짜를 함께 적는다", () => {
    const html = render();
    expect(html).toContain("DAY 2 · 2026-08-13");
    expect(html).toContain("DAY 3 · 2026-08-14");
  });

  /** 자기 자신으로 옮기면 바뀌는 것이 없다 — 호출부가 걸러 넘긴다 */
  it("옮길 곳이 없으면 버튼 자체를 두지 않는다", () => {
    expect(render({ targets: [] })).toBe("");
  });

  /**
   * 빈 날은 옮길 것이 없고, 편집이 막힌 구간에서는 조작하면 안 된다.
   * **숨기지 않고 비활성으로 남긴다** — 사라지면 왜 못 하는지도 모른다.
   */
  it("쓸 수 없을 때는 사라지지 않고 비활성이다", () => {
    const html = render({ disabled: true });
    expect(html).toContain("disabled");
    expect(html).toContain('aria-label="이 날 일정을 다른 날로 옮기기"');
  });
});
