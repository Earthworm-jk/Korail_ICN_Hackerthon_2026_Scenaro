"use server";
/**
 * 일정 생성·편집 재계산 단일 진입점 (API_SPEC 3.2)
 * 편집은 constraints를 바꿔 같은 액션을 재호출한다 — 무상태 전체 재계산.
 * #14 ver.0.4 확정: 필수 방문·방문일 고정 입력 없음(엔진 필드는 후속 PR에서 제거 예정),
 * 여행 속도·하루 여유는 사용자 설정이 아니라 내부 기본값.
 */
import { generateItinerary, TripConstraintsSchema } from "../engine";
import type { ItineraryResult, TripConstraints } from "../engine/types";
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

// PR #30 리뷰 ③: 입력 오류는 엔진의 planned/empty 계산 결과와 의미가 다르다.
// 잘못된 요청은 throw하지 않고 Action 경계에서 INVALID_REQUEST로 분리 반환한다.
export type PlanActionResult =
  | { ok: true; result: ItineraryResult }
  | { ok: false; code: "INVALID_REQUEST"; fieldErrors: Record<string, string> };

export async function planItinerary(request: PlanRequest): Promise<PlanActionResult> {
  const constraints: TripConstraints = {
    arrivalAt: request.arrivalAt,
    departureAt: request.departureAt,
    airportExitOffsetMin: request.airportExitOffsetMin,
    selectedActorIds: request.selectedActorIds,
    selectedWorkIds: request.selectedWorkIds,
    excludedPlaceIds: request.excludedPlaceIds,
    maxPlacesPerDay: DEFAULT_MAX_PLACES_PER_DAY,
    dailySlackMinutes: DEFAULT_DAILY_SLACK_MINUTES,
    departureBufferMinutes: request.departureBufferMinutes,
  };
  const parsed = TripConstraintsSchema.safeParse(constraints);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path.join(".") || "request";
      fieldErrors[field] ??= issue.message;
    }
    return { ok: false, code: "INVALID_REQUEST", fieldErrors };
  }
  return { ok: true, result: generateItinerary(constraints, loadRepositories()) };
}
