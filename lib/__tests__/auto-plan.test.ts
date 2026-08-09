import { describe, expect, it } from "vitest";
import { autoPlanDecision } from "../auto-plan";

/**
 * 자동 재계산 트리거 (#85 기술항목 2, PR #99 리뷰 2)
 *
 * "0곳이면 그냥 return"이 직전 일정을 화면에 남기던 문제를 여기서 고정한다.
 */
describe("자동 재계산 판단", () => {
  const base = { onPlacesStep: true, hasCandidates: true, reopened: false, selectedCount: 3 };

  it("촬영지 단계에서 장소가 있으면 재계산을 예약한다", () => {
    expect(autoPlanDecision(base)).toBe("schedule");
  });

  it("1곳 → 0곳이면 예약이 아니라 결과를 내린다", () => {
    expect(autoPlanDecision({ ...base, selectedCount: 1 })).toBe("schedule");
    expect(autoPlanDecision({ ...base, selectedCount: 0 })).toBe("clear");
  });

  it("재열람 중에는 0곳이어도 저장된 일정을 건드리지 않는다", () => {
    expect(autoPlanDecision({ ...base, reopened: true })).toBe("skip");
    expect(autoPlanDecision({ ...base, reopened: true, selectedCount: 0 })).toBe("skip");
  });

  it("다른 단계이거나 후보를 아직 못 받았으면 아무것도 하지 않는다", () => {
    expect(autoPlanDecision({ ...base, onPlacesStep: false })).toBe("skip");
    expect(autoPlanDecision({ ...base, hasCandidates: false })).toBe("skip");
    // 후보가 없는 동안 0곳인 것은 "선택을 지운" 것이 아니다
    expect(autoPlanDecision({ ...base, hasCandidates: false, selectedCount: 0 })).toBe("skip");
  });
});
