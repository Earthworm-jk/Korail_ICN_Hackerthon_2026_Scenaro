import { describe, expect, it } from "vitest";
import { batchimOf, resolveJosa } from "../i18n/josa";
import { withValues } from "../i18n/messages";

/**
 * #145 — 조사 자동 선택
 *
 * 순서 변경은 시연에서 매번 문장을 남긴다. `대관령 삼양목장을(를) ... 옮겼습니다`가
 * 화면에 그대로 떠 있었다. 고르는 자리는 `withValues` 한 곳이므로 여기서 고정한다.
 */

describe("받침 판별", () => {
  it("받침이 있으면 true", () => {
    expect(batchimOf("장")).toBe(true);
    expect(batchimOf("문")).toBe(true);
  });

  it("받침이 없으면 false", () => {
    expect(batchimOf("사")).toBe(false);
    expect(batchimOf("래")).toBe(false);
  });

  /** 라틴 문자·숫자로 끝나는 이름에서 잘못 고르느니 모른다고 답한다 */
  it("한글이 아니면 undefined", () => {
    expect(batchimOf("a")).toBeUndefined();
    expect(batchimOf("1")).toBeUndefined();
    expect(batchimOf("역")).toBe(true);
  });
});

describe("조사 선택", () => {
  it("받침이 있으면 앞 형태를 쓴다", () => {
    expect(resolveJosa("대관령 삼양목장을(를)")).toBe("대관령 삼양목장을");
    expect(resolveJosa("광화문이(가)")).toBe("광화문이");
  });

  it("받침이 없으면 뒤 형태를 쓴다", () => {
    expect(resolveJosa("월정사을(를)")).toBe("월정사를");
    expect(resolveJosa("월정사이(가)")).toBe("월정사가");
  });

  /** `와(과)`만 순서가 뒤집힌다 — 받침이 있으면 `과`다 */
  it("와(과)는 순서가 반대다", () => {
    expect(resolveJosa("광화문와(과)")).toBe("광화문과");
    expect(resolveJosa("월정사와(과)")).toBe("월정사와");
  });

  it("고를 수 없으면 두 형태를 그대로 남긴다", () => {
    expect(resolveJosa("KTX을(를)")).toBe("KTX을(를)");
  });

  it("한 문장에 여러 개가 있어도 각각 고른다", () => {
    expect(resolveJosa("광화문이(가) 월정사을(를) 지난다")).toBe("광화문이 월정사를 지난다");
  });

  it("영문 문장은 건드리지 않는다", () => {
    const en = "Moved Woljeongsa ahead of Gwanghwamun.";
    expect(resolveJosa(en)).toBe(en);
  });
});

/**
 * 문구를 쓰는 쪽은 `withValues` 하나만 거친다. 여기가 깨지면 순서·제외·이동 문장이
 * 전부 `을(를)`로 돌아간다.
 */
describe("실제 문구", () => {
  it("순서 적용 문장에서 조사가 골라진다 — 받침 있는 이름", () => {
    expect(
      withValues("{first}을(를) {second} 앞으로 옮겼습니다.", {
        first: "대관령 삼양목장",
        second: "월정사",
      }),
    ).toBe("대관령 삼양목장을 월정사 앞으로 옮겼습니다.");
  });

  it("순서 적용 문장에서 조사가 골라진다 — 받침 없는 이름", () => {
    expect(
      withValues("{first}을(를) {second} 앞으로 옮겼습니다.", {
        first: "월정사",
        second: "광화문",
      }),
    ).toBe("월정사를 광화문 앞으로 옮겼습니다.");
  });

  it("제외 문장도 같은 자리에서 골라진다", () => {
    expect(
      withValues("{place}이(가) 일정에서 제외됩니다.", { place: "월정사" }),
    ).toBe("월정사가 일정에서 제외됩니다.");
  });
});
