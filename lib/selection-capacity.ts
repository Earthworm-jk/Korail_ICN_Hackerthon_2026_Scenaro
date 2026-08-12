/**
 * #84 과선택 계약 — 엔진이 만든 최선 부분집합을 최종 일정으로 오인하지 않도록
 * 사용자가 선택한 장소 수와 실제 배치된 고유 장소 수를 대조한다.
 */
import type { DayPlan } from "./engine/types";

export type SelectionCapacitySummary = {
  selectedCount: number;
  schedulableCount: number;
  minimumExclusionCount: number;
  requiresAdjustment: boolean;
  /**
   * 일정에 들어간 장소 — **어느 곳인지** (#171).
   *
   * 지금까지는 이 집합을 만들어 개수만 세고 버렸다. 그래서 화면은 "9곳이 들어갑니다"라고
   * 말하면서 **어느 9곳인지는 아무 데도 보여주지 못했다.** 사용자는 미리보기 일정을
   * 스크롤해 역산해야 했다.
   *
   * 방문 순서를 따른다 — 사용자가 화면에서 보는 차례와 같아야 목록이 읽힌다.
   */
  scheduledPlaceIds: string[];
  /**
   * 선택했지만 못 들어간 장소.
   *
   * 엔진의 `rejectedPlaces`와 다르다. 그쪽은 **사유가 붙은 것**만 담고, 이쪽은 선택과
   * 결과를 대조해 남는 전부다 — 사유를 못 만든 경우까지 포함해야 개수(`minimumExclusionCount`)와
   * 목록이 어긋나지 않는다.
   *
   * 선택 순서를 따른다 — 사용자가 고른 차례다.
   */
  unscheduledPlaceIds: string[];
};

export function summarizeSelectionCapacity(
  selectedPlaceIds: Iterable<string>,
  days: DayPlan[],
): SelectionCapacitySummary {
  const selected = new Set(selectedPlaceIds);
  const scheduledIds = [
    ...new Set(
      days.flatMap((day) => day.items.map((item) => item.placeId))
        .filter((placeId) => selected.has(placeId)),
    ),
  ];
  const scheduled = new Set(scheduledIds);
  const minimumExclusionCount = Math.max(0, selected.size - scheduled.size);

  return {
    selectedCount: selected.size,
    schedulableCount: scheduled.size,
    minimumExclusionCount,
    requiresAdjustment: minimumExclusionCount > 0,
    scheduledPlaceIds: scheduledIds,
    unscheduledPlaceIds: [...selected].filter((placeId) => !scheduled.has(placeId)),
  };
}

/**
 * 지금 보이는 결과가 **현재 선택으로 계산된 것인가** (PR #156 리뷰 3)
 *
 * `summarizeSelectionCapacity`는 선택 집합과 표시 중인 일정을 비교한다. 그런데 선택은
 * 즉시 바뀌고 일정은 엔진 응답 후에 바뀐다. 그 사이에는 방금 고른 장소가 "이전 일정에
 * 없다"는 이유만으로 **미배치로 찍힌다.** 재계산이 실패해 직전 결과가 남으면 그 오판이
 * 계속된다.
 *
 * 엔진은 선택한 장소를 배치하거나 사유와 함께 제외한다 — 둘 중 하나다. 그래서
 * `배치 ∪ 제외`가 선택 집합과 **정확히 같을 때만** 그 결과가 현재 선택의 것이다.
 *
 * **양방향을 봐야 한다** (PR #156 리뷰 재확인).
 * - 선택에 있는데 결과에 없다 → 방금 고른 장소다. 아직 계산되지 않았다.
 * - 결과에 있는데 선택에 없다 → 방금 뺀 장소다. 이전 결과가 남아 있다.
 *
 * 뒤쪽을 빼먹으면 **재계산이 실패했을 때 거짓말을 한다.** 두 곳을 골랐다가 하나를 뺐는데
 * 재계산이 실패하면 화면에는 이전 일정 두 곳이 그대로 보이는데, `updating`이 풀린 뒤
 * 상태 요약은 `선택 1 · 일정 반영 1 · 미배치 0`이라고 말한다 — 현재 선택으로 성공한
 * 결과처럼 보인다.
 */
export function selectionResultIsCurrent(
  selectedPlaceIds: Iterable<string>,
  days: DayPlan[],
  rejectedPlaceIds: Iterable<string>,
): boolean {
  const selected = new Set(selectedPlaceIds);
  const accounted = new Set<string>(rejectedPlaceIds);
  for (const day of days) for (const item of day.items) accounted.add(item.placeId);
  if (selected.size !== accounted.size) return false;
  for (const placeId of selected) if (!accounted.has(placeId)) return false;
  return true;
}
