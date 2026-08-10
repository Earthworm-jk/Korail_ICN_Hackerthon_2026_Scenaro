import type { ItineraryResult } from "./engine/types";

/**
 * 최초 Step 3 선택은 후보 전체가 아니라 첫 일정 엔진 결과에 실제로 배치된 장소로 맞춘다.
 *
 * - planned: days[].items에 실제 들어간 후보만 선택
 * - empty: 실패 사유를 보여줄 수 있도록 원래 후보 선택을 유지
 *
 * 후보 순서를 보존해 카드 정렬·표시의 결정성을 유지한다.
 */
export function initialPlaceIdsFromItinerary(
  candidateIds: readonly string[],
  result: ItineraryResult,
): string[] {
  if (result.status !== "planned") return [...candidateIds];

  const candidateSet = new Set(candidateIds);
  const placed = new Set(
    result.days
      .flatMap((day) => day.items.map((item) => item.placeId))
      .filter((placeId) => candidateSet.has(placeId)),
  );

  // planned인데 배치 장소가 0인 비정상 조합에서는 사용자가 후보를 잃지 않게 원래 선택을 유지한다.
  if (placed.size === 0) return [...candidateIds];
  return candidateIds.filter((id) => placed.has(id));
}
