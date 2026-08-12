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
      scheduledPlaceIds: ["place-a", "place-b"],
      unscheduledPlaceIds: ["place-c"],
    });
  });

  /**
   * 어느 곳이 들어가고 어느 곳이 빠지는가 (#171).
   *
   * 지금까지는 이 집합을 만들어 **개수만 세고 버렸다.** 그래서 화면은 "9곳이 들어갑니다"라고
   * 말하면서 어느 9곳인지는 보여주지 못했고, 사용자는 미리보기 일정을 스크롤해 역산해야 했다.
   */
  describe("유지·제외 목록", () => {
    it("방문 순서대로 들어간 곳을 준다 — 화면에서 보는 차례와 같아야 읽힌다", () => {
      const summary = summarizeSelectionCapacity(
        ["place-c", "place-a", "place-b"],
        [day("2026-08-12", ["place-b", "place-a"]), day("2026-08-13", ["place-c"])],
      );
      expect(summary.scheduledPlaceIds).toEqual(["place-b", "place-a", "place-c"]);
    });

    it("선택 순서대로 빠진 곳을 준다 — 사용자가 고른 차례다", () => {
      const summary = summarizeSelectionCapacity(
        ["place-c", "place-a", "place-b"],
        [day("2026-08-12", ["place-a"])],
      );
      expect(summary.unscheduledPlaceIds).toEqual(["place-c", "place-b"]);
    });

    /** 개수와 목록이 어긋나면 "11곳"이라 적고 10줄을 그리게 된다 */
    it("개수와 목록 길이가 항상 맞는다", () => {
      const summary = summarizeSelectionCapacity(
        ["place-a", "place-b", "place-c", "place-d"],
        [day("2026-08-12", ["place-a", "place-b"])],
      );
      expect(summary.scheduledPlaceIds).toHaveLength(summary.schedulableCount);
      expect(summary.unscheduledPlaceIds).toHaveLength(summary.minimumExclusionCount);
    });

    it("같은 장소가 여러 일차에 있어도 목록에 한 번만 담는다", () => {
      const summary = summarizeSelectionCapacity(
        ["place-a", "place-b"],
        [day("2026-08-12", ["place-a"]), day("2026-08-13", ["place-a", "place-b"])],
      );
      expect(summary.scheduledPlaceIds).toEqual(["place-a", "place-b"]);
      expect(summary.unscheduledPlaceIds).toEqual([]);
    });

    /** 선택하지 않은 장소가 일정에 남아 있어도 우리 목록은 선택 기준이다 */
    it("선택하지 않은 장소는 어느 목록에도 넣지 않는다", () => {
      const summary = summarizeSelectionCapacity(
        ["place-a"],
        [day("2026-08-12", ["place-a", "place-stale"])],
      );
      expect(summary.scheduledPlaceIds).toEqual(["place-a"]);
      expect(summary.unscheduledPlaceIds).toEqual([]);
    });

    it("과선택이 아니면 빠진 목록이 비어 있다", () => {
      const summary = summarizeSelectionCapacity(
        ["place-a", "place-b"],
        [day("2026-08-12", ["place-a", "place-b"])],
      );
      expect(summary.requiresAdjustment).toBe(false);
      expect(summary.unscheduledPlaceIds).toEqual([]);
    });

    it("일정이 비면 선택 전부가 빠진 목록이다", () => {
      const summary = summarizeSelectionCapacity(["place-a", "place-b"], []);
      expect(summary.scheduledPlaceIds).toEqual([]);
      expect(summary.unscheduledPlaceIds).toEqual(["place-a", "place-b"]);
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

  /**
   * 반대 방향도 막아야 한다. 재계산이 실패해 이전 일정이 남으면 화면에는 두 곳이
   * 보이는데 상태 요약만 `선택 1 · 일정 반영 1 · 미배치 0`이 된다 — **성공한 것처럼
   * 보인다.**
   */
  it("선택을 줄였는데 이전 결과가 남아 있으면 현재가 아니다", () => {
    expect(selectionResultIsCurrent(["p1"], [dayWith("p1", "p2")], [])).toBe(false);
  });

  it("뺀 장소가 제외 목록에 남아 있어도 현재가 아니다", () => {
    expect(selectionResultIsCurrent(["p1"], [dayWith("p1")], ["p2"])).toBe(false);
  });

  it("아무것도 안 골랐으면 덮을 것이 없다", () => {
    expect(selectionResultIsCurrent([], [], [])).toBe(true);
  });
});
