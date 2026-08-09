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
