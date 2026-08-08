"use server";
/**
 * 일정 생성·편집 재계산 단일 진입점 (API_SPEC 3.2)
 * 편집은 constraints를 바꿔 같은 액션을 재호출한다 — 무상태 전체 재계산.
 * #14 ver.0.4 확정: 필수 방문·방문일 고정 입력 없음(엔진 필드는 후속 PR에서 제거 예정),
 * 여행 속도·하루 여유는 사용자 설정이 아니라 내부 기본값.
 */
import { generateItinerary } from "../engine";
import type { ItineraryResult } from "../engine/types";
import { loadRepositories } from "../repositories/json";

export type PlanRequest = {
  arrivalAt: string;
  departureAt: string;
  airportExitOffsetMin: number;
  departureBufferMinutes: number;
  selectedActorIds: string[];
  selectedWorkIds: string[];
  excludedPlaceIds: string[];
};

const DEFAULT_MAX_PLACES_PER_DAY = 3;
const DEFAULT_DAILY_SLACK_MINUTES = 120;

export async function planItinerary(request: PlanRequest): Promise<ItineraryResult> {
  return generateItinerary(
    {
      arrivalAt: request.arrivalAt,
      departureAt: request.departureAt,
      airportExitOffsetMin: request.airportExitOffsetMin,
      selectedActorIds: request.selectedActorIds,
      selectedWorkIds: request.selectedWorkIds,
      requiredPlaceIds: [],
      excludedPlaceIds: request.excludedPlaceIds,
      pinnedDates: {},
      maxPlacesPerDay: DEFAULT_MAX_PLACES_PER_DAY,
      dailySlackMinutes: DEFAULT_DAILY_SLACK_MINUTES,
      departureBufferMinutes: request.departureBufferMinutes,
    },
    loadRepositories(),
  );
}
