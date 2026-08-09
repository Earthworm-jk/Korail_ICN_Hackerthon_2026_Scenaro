"use server";
/**
 * 일정 생성·편집 재계산 단일 진입점 (API_SPEC 3.2)
 * 편집은 constraints를 바꿔 같은 액션을 재호출한다 — 무상태 전체 재계산.
 * #14 ver.0.4 확정: 필수 방문·방문일 고정 입력 없음(엔진 필드는 후속 PR에서 제거 예정),
 * 여행 속도·하루 여유는 사용자 설정이 아니라 내부 기본값.
 */
import {
  generateGatewayAlternatives,
  generateItinerary,
  TripConstraintsSchema,
} from "../engine";
import type { GatewayAlternative, ItineraryResult, TripConstraints } from "../engine/types";
import type { GatewayPlanningBaseline } from "../engine/gateway-baseline";
import { loadRepositories, type Repositories } from "../repositories/json";
import { z } from "zod";

export type PlanRequest = {
  arrivalAt: string;
  departureAt: string;
  airportReadyAt: string; // 공항 출발 가능 시각 (#14 차단 2 — 절대 시각)
  airportArrivalDeadline: string; // 공항 도착 마감 시각 (#14 차단 2 — 절대 시각)
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

export type GatewayAlternativesActionResult =
  | { ok: true; alternatives: GatewayAlternative[] }
  | {
      ok: false;
      code: "INVALID_REQUEST" | "INVALID_BASELINE";
      fieldErrors: Record<string, string>;
    };

const GatewayPlanningBaselineSchema = z.object({
  visitedPlaceIds: z.array(z.string().min(1)).max(100),
  localUseMinutes: z.number().int().nonnegative(),
}).superRefine((baseline, context) => {
  if (new Set(baseline.visitedPlaceIds).size !== baseline.visitedPlaceIds.length) {
    context.addIssue({
      code: "custom",
      path: ["visitedPlaceIds"],
      message: "visitedPlaceIds must not contain duplicates",
    });
  }
});

function constraintsFromRequest(request: PlanRequest): TripConstraints {
  return {
    arrivalAt: request.arrivalAt,
    departureAt: request.departureAt,
    airportReadyAt: request.airportReadyAt,
    selectedActorIds: request.selectedActorIds,
    selectedWorkIds: request.selectedWorkIds,
    excludedPlaceIds: request.excludedPlaceIds,
    maxPlacesPerDay: DEFAULT_MAX_PLACES_PER_DAY,
    dailySlackMinutes: DEFAULT_DAILY_SLACK_MINUTES,
    airportArrivalDeadline: request.airportArrivalDeadline,
  };
}

function fieldErrorsOf(error: { issues: Array<{ path: PropertyKey[]; message: string }> }) {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = issue.path.join(".") || "request";
    fieldErrors[field] ??= issue.message;
  }
  return fieldErrors;
}

function validateGatewayBaseline(
  input: GatewayPlanningBaseline,
  constraints: TripConstraints,
  repos: Repositories,
): { success: true; data: GatewayPlanningBaseline } | {
  success: false;
  fieldErrors: Record<string, string>;
} {
  const parsed = GatewayPlanningBaselineSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, fieldErrors: fieldErrorsOf(parsed.error) };
  }
  const fieldErrors: Record<string, string> = {};
  const placeIds = new Set(repos.places.map(({ id }) => id));
  const excluded = new Set(constraints.excludedPlaceIds);
  for (const id of parsed.data.visitedPlaceIds) {
    if (!placeIds.has(id)) {
      fieldErrors.visitedPlaceIds ??= `unknown place id: ${id}`;
    } else if (excluded.has(id)) {
      fieldErrors.visitedPlaceIds ??= `excluded place id: ${id}`;
    }
  }
  const tripWindowMinutes = Math.floor(
    (Date.parse(constraints.airportArrivalDeadline) - Date.parse(constraints.airportReadyAt)) / 60_000,
  );
  if (parsed.data.localUseMinutes > tripWindowMinutes) {
    fieldErrors.localUseMinutes = "localUseMinutes exceeds the trip window";
  }
  return Object.keys(fieldErrors).length > 0
    ? { success: false, fieldErrors }
    : { success: true, data: parsed.data };
}

export async function planItinerary(request: PlanRequest): Promise<PlanActionResult> {
  const constraints = constraintsFromRequest(request);
  const parsed = TripConstraintsSchema.safeParse(constraints);
  if (!parsed.success) {
    return { ok: false, code: "INVALID_REQUEST", fieldErrors: fieldErrorsOf(parsed.error) };
  }
  return { ok: true, result: generateItinerary(parsed.data, loadRepositories()) };
}

/** 핵심 추천을 먼저 표시한 뒤 별도로 붙는 비차단 공항버스 전체 일정 대안. */
export async function planGatewayAlternatives(
  request: PlanRequest,
  baseline: GatewayPlanningBaseline,
): Promise<GatewayAlternativesActionResult> {
  const constraints = constraintsFromRequest(request);
  const parsed = TripConstraintsSchema.safeParse(constraints);
  if (!parsed.success) {
    return { ok: false, code: "INVALID_REQUEST", fieldErrors: fieldErrorsOf(parsed.error) };
  }
  const repos = loadRepositories();
  const checkedBaseline = validateGatewayBaseline(baseline, parsed.data, repos);
  if (!checkedBaseline.success) {
    return {
      ok: false,
      code: "INVALID_BASELINE",
      fieldErrors: checkedBaseline.fieldErrors,
    };
  }
  return {
    ok: true,
    alternatives: generateGatewayAlternatives(parsed.data, repos, checkedBaseline.data),
  };
}
