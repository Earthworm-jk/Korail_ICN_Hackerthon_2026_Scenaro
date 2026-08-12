/**
 * 목표에서 제외안을 만들고, 두 일정의 맞바꿈을 잰다 (#171).
 *
 * 목표하는 대화는 이렇다.
 *
 * ```
 * 사용자  20곳은 너무 많네. 7곳만 남기고 영진해변은 꼭 유지해줘.
 * AI     영진해변을 유지하고 7곳으로 줄인 안을 계산했습니다.
 *        현재 안보다 이동 42분 감소하지만 부산 장소 2곳이 빠집니다. 적용할까요?
 * ```
 *
 * ## 무엇을 여기서 하고 무엇을 안 하나
 *
 * **엔진을 부르지 않는다.** 여기서 만드는 것은 "이렇게 빼 보자"는 **후보안**이고, 그것이
 * 실제로 가능한지와 어느 안이 나은지는 **엔진이 다시 계산해서** 정한다(기존 사전식 비교
 * 기준 그대로). 랭킹 하위를 빼면 "엔진 기준 최선 N곳"이 된다는 보장이 없기 때문이다 —
 * 랭킹은 관련성이지 배치 효율이 아니고, 지역이 갈리면 이동 구조가 통째로 바뀐다.
 *
 * 그래서 이 모듈은 **순수 함수**다. 새 엔진 키도, 새 제약도 만들지 않는다. 엔진에 들어가는
 * 것은 지금도 있는 `excludedPlaceIds` 하나뿐이다.
 *
 * ## 왜 여러 안을 만드나
 *
 * 하나만 만들면 "이게 최선입니다"라고 말할 근거가 없고, 사용자가 "부산 한 곳은 남겨줘"처럼
 * 되물었을 때 비교할 것이 없다. 서로 다른 방향으로 몇 개를 만들어 두면 엔진이 고른 1등과
 * 2등을 함께 보여줄 수 있다 — 목표 대화의 마지막 turn이 그것이다.
 */
import type { DayPlan, ItineraryMetrics } from "./engine/types";

/** 한 번에 만들 후보안 수 상한. 안 하나마다 엔진을 다시 돌리므로 곧 응답 시간이다 */
export const MAX_EXCLUSION_PLANS = 4;

export type ItineraryGoal = {
  /** "7곳만 남겨줘" — 최종 방문 장소 수 */
  targetPlaceCount?: number;
  /** "영진해변은 꼭" — 어떤 안에서도 빼지 않는다 */
  pinnedPlaceIds?: readonly string[];
};

export type ExclusionPlan = {
  /** 이 안에서 새로 빼는 장소 (기존 제외 목록에 더한다) */
  droppedPlaceIds: string[];
  /** 이 안을 만든 방향 — 화면이 "왜 이 안인가"를 말할 때 쓴다 */
  strategy: "lowest_ranked" | "keep_pinned" | "fewest_regions";
};

type PlanContext = {
  /** 지금 일정에 들어가 있는 장소 (엔진이 고른 것) */
  scheduledPlaceIds: readonly string[];
  /** placeId → 관련성 점수. 없으면 0으로 본다 (#48) */
  rankingScores: ReadonlyMap<string, number>;
  /** placeId → 권역·역 식별자. 같은 곳을 함께 빼거나 남기는 데 쓴다 */
  regionOf?: ReadonlyMap<string, string>;
};

/**
 * 뺄 순서 — **결정적이어야 한다.** 같은 입력에 같은 제안이 나와야 사용자가 두 번 물어도
 * 같은 답을 받는다. 점수가 같으면 id 사전순으로 가른다.
 */
function removalOrder(
  placeIds: readonly string[],
  scores: ReadonlyMap<string, number>,
): string[] {
  return [...placeIds].sort((a, b) => {
    const diff = (scores.get(a) ?? 0) - (scores.get(b) ?? 0);
    return diff !== 0 ? diff : a.localeCompare(b);
  });
}

/** 목표가 요구하는 감축 수. 이미 목표 이하면 0 */
export function removalCountFor(goal: ItineraryGoal, scheduledCount: number): number {
  if (goal.targetPlaceCount === undefined) return 0;
  return Math.max(0, scheduledCount - Math.max(0, goal.targetPlaceCount));
}

/**
 * 목표에서 후보 제외안을 만든다.
 *
 * 고정 장소는 어느 안에서도 빠지지 않는다. 고정만으로 목표 수를 못 맞추면 **고정을 지키는
 * 쪽을 택한다** — 사용자가 "꼭"이라고 말한 것을 우리가 무르면 그건 조율이 아니다.
 */
export function exclusionPlansFor(goal: ItineraryGoal, context: PlanContext): ExclusionPlan[] {
  const pinned = new Set(goal.pinnedPlaceIds ?? []);
  const removable = context.scheduledPlaceIds.filter((id) => !pinned.has(id));
  const needed = removalCountFor(goal, context.scheduledPlaceIds.length);
  if (needed === 0) return [];

  const ordered = removalOrder(removable, context.rankingScores);
  // 고정을 지키면 목표에 못 미치더라도 뺄 수 있는 만큼만 뺀다
  const count = Math.min(needed, ordered.length);
  if (count === 0) return [];

  const plans: ExclusionPlan[] = [
    { droppedPlaceIds: ordered.slice(0, count), strategy: pinned.size > 0 ? "keep_pinned" : "lowest_ranked" },
  ];

  /**
   * 방향이 다른 안을 하나 더 만든다 — 권역을 통째로 비우는 쪽이다.
   *
   * 랭킹 하위만 빼면 여러 권역에서 한 곳씩 빠져 이동이 그대로 남는 경우가 많다. 한 권역을
   * 비우면 그 왕복이 통째로 사라져서 **이동 시간이 크게 줄어드는 안**이 나온다. 어느 쪽이
   * 나은지는 엔진이 정한다.
   */
  const regions = context.regionOf;
  if (regions !== undefined) {
    const byRegion = new Map<string, string[]>();
    for (const id of removable) {
      const region = regions.get(id);
      if (region === undefined) continue;
      const bucket = byRegion.get(region);
      if (bucket) bucket.push(id);
      else byRegion.set(region, [id]);
    }
    const candidates = [...byRegion.entries()]
      .filter(([, ids]) => ids.length > 0 && ids.length <= count)
      .sort(([regionA, idsA], [regionB, idsB]) =>
        idsB.length - idsA.length || regionA.localeCompare(regionB));

    for (const [, ids] of candidates) {
      if (plans.length >= MAX_EXCLUSION_PLANS) break;
      const rest = removalOrder(removable.filter((id) => !ids.includes(id)), context.rankingScores);
      const dropped = [...ids, ...rest.slice(0, count - ids.length)].sort();
      if (plans.some((plan) => sameIds(plan.droppedPlaceIds, dropped))) continue;
      plans.push({ droppedPlaceIds: dropped, strategy: "fewest_regions" });
    }
  }

  return plans.slice(0, MAX_EXCLUSION_PLANS);
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((id, index) => id === sortedB[index]);
}

export type ItineraryTradeOff = {
  /** 음수면 줄어든 것 — "이동 42분 감소" */
  travelMinutesDelta: number;
  transferDelta: number;
  /** 이번 안에서 빠지는 장소 */
  droppedPlaceIds: string[];
  /** 이번 안에서 새로 들어오는 장소 — 자리가 나면 다른 곳이 들어올 수 있다 */
  addedPlaceIds: string[];
};

/**
 * 두 일정의 맞바꿈을 잰다 — **화면이 문장으로 옮길 숫자만** 내놓는다.
 *
 * 문장을 여기서 만들지 않는 이유는 locale 때문이다(#142 리뷰와 같은 이유). 그리고 이 값이
 * 곧 사용자가 승인 여부를 정하는 근거다 — "42분 줄지만 부산 2곳이 빠진다"를 보여주지 않고
 * 적용하면 무엇을 잃었는지 모른 채 진행하게 된다.
 */
export function tradeOffBetween(
  before: { days: readonly DayPlan[]; metrics: ItineraryMetrics },
  after: { days: readonly DayPlan[]; metrics: ItineraryMetrics },
): ItineraryTradeOff {
  const beforeIds = new Set(placeIdsOf(before.days));
  const afterIds = new Set(placeIdsOf(after.days));

  return {
    travelMinutesDelta: after.metrics.totalTravelMinutes - before.metrics.totalTravelMinutes,
    transferDelta: after.metrics.transferCount - before.metrics.transferCount,
    droppedPlaceIds: [...beforeIds].filter((id) => !afterIds.has(id)).sort(),
    addedPlaceIds: [...afterIds].filter((id) => !beforeIds.has(id)).sort(),
  };
}

function placeIdsOf(days: readonly DayPlan[]): string[] {
  return days.flatMap((day) => day.items.map((item) => item.placeId));
}
