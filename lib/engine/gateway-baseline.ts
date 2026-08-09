import type { ItineraryResult } from "./types";

/**
 * #87 공항버스 대안이 핵심 추천과 비교할 때 필요한 최소 입력.
 * 권한·저장 판단에는 쓰지 않고 effects(localUseDelta/excludedPlaceIds)에만 사용한다.
 */
export type GatewayPlanningBaseline = {
  visitedPlaceIds: string[];
  localUseMinutes: number;
};

/** 서버가 만든 핵심 추천 결과를 직렬화 가능한 최소 baseline으로 축약한다. */
export function gatewayPlanningBaselineOf(
  result: ItineraryResult,
): GatewayPlanningBaseline | null {
  if (result.status !== "planned") return null;
  return {
    visitedPlaceIds: [...new Set(
      result.days.flatMap((day) => day.items.map(({ placeId }) => placeId)),
    )].sort((a, b) => a.localeCompare(b, "en")),
    localUseMinutes: result.days
      .flatMap((day) => day.regionWindows)
      .reduce((total, window) => total + window.availableMinutes, 0),
  };
}
