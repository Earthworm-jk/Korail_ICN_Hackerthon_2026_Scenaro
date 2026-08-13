import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { messages } from "../i18n/messages";

const wizard = readFileSync(
  fileURLToPath(new URL("../../app/planner-wizard.tsx", import.meta.url)),
  "utf8",
);

/**
 * 1단계 화면이 "무엇을 정하는 화면인지"를 스스로 말하게 한 변경 (멘토 UI 지적).
 *
 * 입력 네 개가 흩어져 있어 무엇을 만들어내는 화면인지 읽히지 않았다. 같은 방향의
 * 항공편과 공항 시각을 한 카드에 두고, 그 결과인 "사용 가능 시간"은 사이드바 한 곳이
 * 맡는다 — 본문에도 같이 두면 같은 값이 두 번 나온다.
 */
describe("1단계 사용 가능 시간", () => {
  it("사이드바 한 곳만 값을 만든다 — 본문은 같은 값을 다시 적지 않는다", () => {
    const definitions = wizard.match(/function usableWindowText\(/g) ?? [];
    expect(definitions).toHaveLength(1);
    const calls = wizard.match(/usableWindowText\(/g) ?? [];
    expect(calls.length).toBe(2); // 정의 1 + 호출 1 (사이드바)
  });

  it("사용 가능 시간과 그 설명이 사이드바 안에 함께 있다", () => {
    const sidebar = wizard.slice(
      wizard.indexOf("function SummarySidebar("),
      wizard.indexOf("function WindowHintDialog("),
    );
    expect(sidebar).toContain('tr("summary.window")');
    expect(sidebar).toContain('tr("step1.windowHint")');
  });

  /**
   * 모바일은 요약이 가로 밴드라 설명 줄이 입력 화면을 밀어낸다. 거기서는 첫 진입
   * 팝업이 같은 말을 하고, 닫으면 입력 화면에 남지 않는다.
   */
  describe("모바일 첫 진입 안내", () => {
    const dialog = wizard.slice(
      wizard.indexOf("function WindowHintDialog("),
      wizard.indexOf("/** 그 장소가 지금 배치된 날짜"),
    );

    it("사이드바 설명 줄은 태블릿 이상에서만 보인다", () => {
      expect(wizard).toMatch(/className="[^"]*hidden[^"]*md:block"[^>]*>\s*\{tr\("step1\.windowHint"\)\}/);
    });

    it("팝업은 좁은 화면에서만 보인다 — 폭 판정은 CSS가 한다", () => {
      expect(dialog).toContain("md:hidden");
      // 폭을 재서 상태로 들면 서버 렌더에 폭이 없어 첫 그림이 어긋난다
      expect(dialog).not.toMatch(/matchMedia|innerWidth/);
    });

    it("팝업과 사이드바가 같은 문구를 쓴다", () => {
      expect(dialog).toContain('tr("step1.windowHint")');
    });

    it("닫은 기록을 저장소에 남기지 않는다 — 새로 열 때마다 다시 보여야 한다", () => {
      expect(dialog).not.toMatch(/localStorage|sessionStorage/);
    });
  });

  it("이 시간이 무엇인지 한 줄로 설명한다", () => {
    expect(messages.ko["step1.windowHint"]).toContain("K-콘텐츠");
    expect(messages.en["step1.windowHint"]).toContain("K-content");
  });

  it("공항 시각 입력이 같은 방향 항공편 카드 안에 있다", () => {
    // 방향별 카드를 도는 map 안에서 공항 시각 입력이 렌더된다
    const cardBlock = wizard.slice(
      wizard.indexOf('["arrival", arrival, setArrival] as const'),
      wizard.indexOf('tr("step1.timetableWindow")'),
    );
    expect(cardBlock).toContain('htmlFor="airport-ready-date"');
    expect(cardBlock).toContain('htmlFor="airport-deadline-date"');
  });

  /**
   * 사용자가 정하는 두 시각이 어느 공항 기준인지 문장 안에 있어야 한다. 카드 옆
   * ICN 배지는 장식으로 읽히고, "입국·출국"은 한국 기준 용어라 외국인 사용자가
   * 자기 출발 공항으로 오해할 수 있다.
   */
  it("공항 시각 문구가 어느 공항인지 말한다", () => {
    for (const key of ["step1.arrival", "step1.departure", "step1.airportReady", "step1.airportDeadline"] as const) {
      expect(messages.ko[key]).toContain("인천공항");
      expect(messages.en[key]).toContain("Incheon");
    }
  });

  it("nav와 본문 제목이 같은 말을 쓴다", () => {
    expect(messages.ko["nav.step1"]).toBe("여행 시간");
    expect(messages.ko["step1.title"]).toBe("여행 시간");
    expect(messages.en["nav.step1"]).toBe("Trip time");
    expect(messages.en["step1.title"]).toBe("Trip time");
  });
});
