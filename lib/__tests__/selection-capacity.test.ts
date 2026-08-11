import { describe, expect, it } from "vitest";
import { selectionResultIsCurrent, summarizeSelectionCapacity } from "../selection-capacity";
import type { DayPlan } from "../engine/types";

const day = (date: string, placeIds: string[]): DayPlan => ({
  date,
  rides: [],
  regionWindows: [],
  items: placeIds.map((placeId) => ({
    placeId,
    arriveAt: `${date}T01:00:00.000Z`,
    departAt: `${date}T02:00:00.000Z`,
    accessMinutes: 10,
  })),
});

describe("#84 과선택 수용량 요약", () => {
  it("선택 N·배치 가능 M·최소 제외 K=N-M을 계산한다", () => {
    expect(summarizeSelectionCapacity(
      ["place-a", "place-b", "place-c"],
      [day("2026-08-12", ["place-a"]), day("2026-08-13", ["place-b"])],
    )).toEqual({
      selectedCount: 3,
      schedulableCount: 2,
      minimumExclusionCount: 1,
      requiresAdjustment: true,
    });
  });

  it("같은 장소가 여러 일차에 있어도 배치 수를 중복 계산하지 않는다", () => {
    expect(summarizeSelectionCapacity(
      ["place-a", "place-b"],
      [day("2026-08-12", ["place-a"]), day("2026-08-13", ["place-a", "place-b"])],
    ).schedulableCount).toBe(2);
  });

  it("선택 장소를 전부 배치하면 조정이 필요하지 않다", () => {
    expect(summarizeSelectionCapacity(
      ["place-a", "place-b"],
      [day("2026-08-12", ["place-a", "place-b"])],
    ).requiresAdjustment).toBe(false);
  });

  it("빈 결과는 선택 장소 전부를 최소 제외 개수로 안내한다", () => {
    expect(summarizeSelectionCapacity(["place-a", "place-b"], [])).toMatchObject({
      schedulableCount: 0,
      minimumExclusionCount: 2,
      requiresAdjustment: true,
    });
  });

  it("현재 선택 밖의 방문은 배치 가능 수에 포함하지 않는다", () => {
    expect(summarizeSelectionCapacity(
      ["place-a"],
      [day("2026-08-12", ["place-a", "legacy-place"])],
    ).schedulableCount).toBe(1);
  });
});

describe("PR #156 리뷰 3 — 결과가 현재 선택의 것인가", () => {
  const dayWith = (...placeIds: string[]): DayPlan => ({
    date: "2026-08-12",
    items: placeIds.map((placeId) => ({
      placeId, arriveAt: "2026-08-12T01:00:00.000Z",
      departAt: "2026-08-12T02:00:00.000Z", accessMinutes: 10,
    })),
    rides: [], regionWindows: [],
  });

  it("배치와 제외가 선택을 덮으면 현재 결과다", () => {
    expect(selectionResultIsCurrent(["p1", "p2"], [dayWith("p1")], ["p2"])).toBe(true);
  });

  /**
   * 새로 고른 장소는 배치에도 제외에도 없다. 이때 배치 수를 말하면
   * **아직 계산도 안 한 장소를 "미배치"로 단정하게 된다.**
   */
  it("방금 고른 장소는 어느 쪽에도 없어 아직 아니다", () => {
    expect(selectionResultIsCurrent(["p1", "p2"], [dayWith("p1")], [])).toBe(false);
  });

  // 재계산이 실패해 직전 결과가 남아도 같은 판정이 걸린다
  it("선택을 줄인 직후에도 이전 결과는 그대로 통과한다", () => {
    expect(selectionResultIsCurrent(["p1"], [dayWith("p1", "p2")], [])).toBe(true);
  });

  it("아무것도 안 골랐으면 덮을 것이 없다", () => {
    expect(selectionResultIsCurrent([], [], [])).toBe(true);
  });
});
