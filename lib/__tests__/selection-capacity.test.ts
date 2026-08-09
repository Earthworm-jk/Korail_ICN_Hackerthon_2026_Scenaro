import { describe, expect, it } from "vitest";
import { summarizeSelectionCapacity } from "../selection-capacity";
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
