import { describe, expect, it } from "vitest";

import {
  MAX_EXCLUSION_PLANS,
  exclusionPlansFor,
  removalCountFor,
  tradeOffBetween,
} from "@/lib/itinerary-goal-plans";
import type { DayPlan, ItineraryMetrics } from "@/lib/engine/types";

/**
 * 목표 → 제외안 → 맞바꿈 (#171).
 *
 * 여기서 지키는 것은 **결정성**과 **약속을 무르지 않는 것**이다. 같은 요청에 같은 안이
 * 나와야 하고, 사용자가 "꼭"이라고 말한 장소는 어느 안에서도 빠지지 않아야 한다.
 */

const scores = new Map([
  ["p-high", 0.9],
  ["p-mid", 0.5],
  ["p-low", 0.1],
  ["p-lowest", 0.05],
]);

const context = (over: Partial<Parameters<typeof exclusionPlansFor>[1]> = {}) => ({
  scheduledPlaceIds: ["p-high", "p-mid", "p-low", "p-lowest"],
  rankingScores: scores,
  ...over,
});

describe("감축 수", () => {
  it("목표가 없으면 빼지 않는다", () => {
    expect(removalCountFor({}, 9)).toBe(0);
  });

  it("목표보다 많으면 그 차이만큼 뺀다", () => {
    expect(removalCountFor({ targetPlaceCount: 7 }, 9)).toBe(2);
  });

  /** 이미 목표 이하인데 더 빼면 사용자가 요청하지 않은 축소가 된다 */
  it("이미 목표 이하면 빼지 않는다", () => {
    expect(removalCountFor({ targetPlaceCount: 7 }, 5)).toBe(0);
    expect(removalCountFor({ targetPlaceCount: 7 }, 7)).toBe(0);
  });
});

describe("제외안 만들기", () => {
  it("목표가 없으면 안을 만들지 않는다", () => {
    expect(exclusionPlansFor({}, context())).toEqual([]);
  });

  it("관련성이 낮은 쪽부터 뺀다", () => {
    const [plan] = exclusionPlansFor({ targetPlaceCount: 2 }, context());
    expect(plan.droppedPlaceIds).toEqual(["p-lowest", "p-low"]);
    expect(plan.strategy).toBe("lowest_ranked");
  });

  /** 같은 요청에 같은 답이 나와야 사용자가 두 번 물어도 흔들리지 않는다 */
  it("같은 입력이면 같은 안이다", () => {
    const first = exclusionPlansFor({ targetPlaceCount: 2 }, context());
    const second = exclusionPlansFor({ targetPlaceCount: 2 }, context());
    expect(first).toEqual(second);
  });

  it("점수가 같으면 id 사전순으로 가른다", () => {
    const tied = new Map([["p-b", 0.3], ["p-a", 0.3], ["p-keep", 0.9]]);
    const [plan] = exclusionPlansFor(
      { targetPlaceCount: 2 },
      { scheduledPlaceIds: ["p-b", "p-a", "p-keep"], rankingScores: tied },
    );
    expect(plan.droppedPlaceIds).toEqual(["p-a"]);
  });

  it("점수가 없는 장소는 가장 먼저 뺀다", () => {
    const [plan] = exclusionPlansFor(
      { targetPlaceCount: 2 },
      { scheduledPlaceIds: ["p-high", "p-mid", "p-unknown"], rankingScores: scores },
    );
    expect(plan.droppedPlaceIds).toEqual(["p-unknown"]);
  });
});

/** 사용자가 "꼭"이라고 말한 것을 우리가 무르면 그건 조율이 아니다 */
describe("꼭 유지", () => {
  it("고정한 장소는 어느 안에서도 빠지지 않는다", () => {
    const plans = exclusionPlansFor(
      { targetPlaceCount: 2, pinnedPlaceIds: ["p-lowest"] },
      context(),
    );
    expect(plans.length).toBeGreaterThan(0);
    for (const plan of plans) expect(plan.droppedPlaceIds).not.toContain("p-lowest");
  });

  it("고정이 있으면 그 사실을 안에 남긴다", () => {
    const [plan] = exclusionPlansFor(
      { targetPlaceCount: 3, pinnedPlaceIds: ["p-lowest"] },
      context(),
    );
    expect(plan.strategy).toBe("keep_pinned");
    expect(plan.droppedPlaceIds).toEqual(["p-low"]);
  });

  /**
   * 고정을 지키면 목표 수에 못 미칠 수 있다. 그때 고정을 무르지 않는다 — 뺄 수 있는
   * 만큼만 빼고, 목표에 못 미친다는 것은 재계산 결과가 말한다.
   */
  it("고정 때문에 목표에 못 미쳐도 고정을 무르지 않는다", () => {
    const plans = exclusionPlansFor(
      { targetPlaceCount: 1, pinnedPlaceIds: ["p-high", "p-mid", "p-low"] },
      context(),
    );
    expect(plans).toHaveLength(1);
    expect(plans[0].droppedPlaceIds).toEqual(["p-lowest"]);
  });

  it("전부 고정이면 만들 안이 없다", () => {
    expect(exclusionPlansFor(
      { targetPlaceCount: 1, pinnedPlaceIds: ["p-high", "p-mid", "p-low", "p-lowest"] },
      context(),
    )).toEqual([]);
  });
});

/**
 * 랭킹 하위만 빼면 여러 권역에서 한 곳씩 빠져 이동이 그대로 남는다. 한 권역을 비우면
 * 그 왕복이 통째로 사라진다 — 어느 쪽이 나은지는 엔진이 정하므로 둘 다 만든다.
 */
describe("권역을 비우는 방향도 함께 만든다", () => {
  const regionOf = new Map([
    ["p-high", "seoul"],
    ["p-mid", "busan"],
    ["p-low", "busan"],
    ["p-lowest", "seoul"],
  ]);

  it("방향이 다른 안을 함께 낸다", () => {
    const plans = exclusionPlansFor({ targetPlaceCount: 2 }, context({ regionOf }));
    expect(plans.length).toBeGreaterThan(1);
    expect(plans.map((plan) => plan.strategy)).toContain("fewest_regions");
  });

  it("같은 안을 두 번 내지 않는다", () => {
    const plans = exclusionPlansFor({ targetPlaceCount: 2 }, context({ regionOf }));
    const keys = plans.map((plan) => [...plan.droppedPlaceIds].sort().join("|"));
    expect(new Set(keys).size).toBe(keys.length);
  });

  /** 안 하나마다 엔진을 다시 돌리므로 곧 응답 시간이다 */
  it("상한을 넘지 않는다", () => {
    const many = Array.from({ length: 30 }, (_, i) => `p${i}`);
    const plans = exclusionPlansFor(
      { targetPlaceCount: 5 },
      {
        scheduledPlaceIds: many,
        rankingScores: new Map(many.map((id, i) => [id, i / 100])),
        regionOf: new Map(many.map((id, i) => [id, `r${i % 8}`])),
      },
    );
    expect(plans.length).toBeLessThanOrEqual(MAX_EXCLUSION_PLANS);
  });
});

describe("맞바꿈 재기", () => {
  const day = (placeIds: string[]): DayPlan =>
    ({ date: "2026-08-12", items: placeIds.map((placeId) => ({ placeId })), rides: [], regionWindows: [] }) as unknown as DayPlan;
  const metrics = (travel: number, transfers: number): ItineraryMetrics =>
    ({ totalTravelMinutes: travel, totalRailMinutes: travel, transferCount: transfers, departureSlackMinutes: 0 });

  it("이동이 줄면 음수로 나온다 — 화면이 문장으로 옮긴다", () => {
    const result = tradeOffBetween(
      { days: [day(["a", "b", "c"])], metrics: metrics(300, 4) },
      { days: [day(["a"])], metrics: metrics(258, 2) },
    );
    expect(result.travelMinutesDelta).toBe(-42);
    expect(result.transferDelta).toBe(-2);
  });

  it("빠지는 장소를 알려준다", () => {
    const result = tradeOffBetween(
      { days: [day(["a", "busan-1", "busan-2"])], metrics: metrics(300, 4) },
      { days: [day(["a"])], metrics: metrics(258, 2) },
    );
    expect(result.droppedPlaceIds).toEqual(["busan-1", "busan-2"]);
    expect(result.addedPlaceIds).toEqual([]);
  });

  /** 자리가 나면 다른 곳이 들어올 수 있다 — 그것도 사용자가 알아야 한다 */
  it("새로 들어오는 장소도 알려준다", () => {
    const result = tradeOffBetween(
      { days: [day(["a", "b"])], metrics: metrics(300, 4) },
      { days: [day(["a", "c"])], metrics: metrics(280, 3) },
    );
    expect(result.droppedPlaceIds).toEqual(["b"]);
    expect(result.addedPlaceIds).toEqual(["c"]);
  });

  it("바뀐 것이 없으면 전부 0이다", () => {
    const same = { days: [day(["a", "b"])], metrics: metrics(300, 4) };
    expect(tradeOffBetween(same, same)).toEqual({
      travelMinutesDelta: 0,
      transferDelta: 0,
      droppedPlaceIds: [],
      addedPlaceIds: [],
    });
  });

  it("여러 날에 흩어져 있어도 모두 센다", () => {
    const result = tradeOffBetween(
      { days: [day(["a"]), day(["b", "c"])], metrics: metrics(300, 4) },
      { days: [day(["a"]), day(["b"])], metrics: metrics(250, 3) },
    );
    expect(result.droppedPlaceIds).toEqual(["c"]);
  });
});
