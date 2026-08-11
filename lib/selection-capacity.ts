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
};

export function summarizeSelectionCapacity(
  selectedPlaceIds: Iterable<string>,
  days: DayPlan[],
): SelectionCapacitySummary {
  const selected = new Set(selectedPlaceIds);
  const scheduled = new Set(
    days.flatMap((day) => day.items.map((item) => item.placeId))
      .filter((placeId) => selected.has(placeId)),
  );
  const minimumExclusionCount = Math.max(0, selected.size - scheduled.size);

  return {
    selectedCount: selected.size,
    schedulableCount: scheduled.size,
    minimumExclusionCount,
    requiresAdjustment: minimumExclusionCount > 0,
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
 * `배치 ∪ 제외`가 선택 집합을 정확히 덮을 때만 그 결과가 현재 선택의 것이다.
 * 새 장소를 고른 직후에는 어느 쪽에도 없어 덮이지 않는다.
 */
export function selectionResultIsCurrent(
  selectedPlaceIds: Iterable<string>,
  days: DayPlan[],
  rejectedPlaceIds: Iterable<string>,
): boolean {
  const selected = new Set(selectedPlaceIds);
  const accounted = new Set<string>(rejectedPlaceIds);
  for (const day of days) for (const item of day.items) accounted.add(item.placeId);
  for (const placeId of selected) if (!accounted.has(placeId)) return false;
  return true;
}
