/**
 * 일정 생성·재계산 엔진 — 순수 TypeScript 모듈 (docs/ENGINE_SPEC.md)
 * 편집 3동작(제외/방문일 변경/항공편 시각 변경)은 모두 TripConstraints 필드만 바꿔
 * 이 단일 진입점을 다시 호출한다 (#2 최종 결정). 전체 재계산, 부분 패치 없음.
 *
 * 구현 예정: 08-09 플래너 P0 (로드맵 #6). 회귀 프리셋 3개가 이 함수를 검증한다.
 */
import type { Repositories } from "../repositories/json";
import type { ItineraryResult, TripConstraints } from "./types";
import { planItinerary } from "./planner";
import { z } from "zod";

const TripConstraintsSchema = z.object({
  arrivalAt: z.iso.datetime({ offset: true }),
  departureAt: z.iso.datetime({ offset: true }),
  airportExitOffsetMin: z.number().int().nonnegative(),
  airportStationId: z.string().min(1).optional(),
  gatewayStationId: z.string().min(1).optional(),
  selectedActorIds: z.array(z.string().min(1)).optional(),
  selectedActorId: z.string().min(1).optional(),
  selectedWorkIds: z.array(z.string().min(1)),
  requiredPlaceIds: z.array(z.string().min(1)),
  excludedPlaceIds: z.array(z.string().min(1)),
  pinnedDates: z.record(z.string(), z.iso.date()),
  maxPlacesPerDay: z.number().int().positive(),
  dailySlackMinutes: z.number().int().nonnegative(),
  departureBufferMinutes: z.number().int().nonnegative(),
}).superRefine((constraints, context) => {
  if (Date.parse(constraints.arrivalAt) >= Date.parse(constraints.departureAt)) {
    context.addIssue({
      code: "custom",
      path: ["departureAt"],
      message: "departureAt must be later than arrivalAt",
    });
  }

  const actorCount = new Set([
    ...(constraints.selectedActorIds ?? []),
    ...(constraints.selectedActorId ? [constraints.selectedActorId] : []),
  ]).size;
  if (actorCount === 0 && constraints.selectedWorkIds.length === 0) {
    context.addIssue({
      code: "custom",
      path: ["selectedWorkIds"],
      message: "at least one actor or work must be selected",
    });
  }
});

export function generateItinerary(
  constraints: TripConstraints,
  repos: Repositories,
): ItineraryResult {
  return planItinerary(TripConstraintsSchema.parse(constraints), repos);
}
