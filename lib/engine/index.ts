/**
 * 일정 생성·재계산 엔진 — 순수 TypeScript 모듈 (docs/ENGINE_SPEC.md)
 * 편집 3동작(제외/방문일 변경/항공편 시각 변경)은 모두 TripConstraints 필드만 바꿔
 * 이 단일 진입점을 다시 호출한다 (#2 최종 결정). 전체 재계산, 부분 패치 없음.
 *
 * 구현 예정: 08-09 플래너 P0 (로드맵 #6). 회귀 프리셋 3개가 이 함수를 검증한다.
 */
import type { Repositories } from "../repositories/json";
import type { ItineraryResult, TripConstraints } from "./types";
import { planItinerary, preferredVisitDateErrors,
  preferredOrderErrors, tripDatesForWindow } from "./planner";
import { buildGatewayAlternatives } from "./gateway-alternatives";
import { gatewayPlanningBaselineOf, type GatewayPlanningBaseline } from "./gateway-baseline";
import { z } from "zod";

// PR #30 리뷰 ③: Server Action 경계가 같은 계약을 safeParse해 잘못된 요청을
// throw 없이 INVALID_REQUEST로 반환할 수 있도록 내보낸다
export { preferredVisitDateErrors, preferredOrderErrors, tripDatesForWindow };

/**
 * 순서 쌍 그래프의 첫 순환 (#145 · PR #153 리뷰 3번).
 *
 * precedence는 `먼저 → 나중` 방향 간선이다. 순환이 있으면 그 안의 쌍은 어떤 배치로도 전부
 * 지킬 수 없으므로 입력 자체가 모순이다. 길이 2(직접 역쌍)도 이 검사에 함께 걸린다.
 *
 * 깊이 우선으로 훑으며 현재 경로에 다시 닿으면 그 구간을 돌려준다 — 어떤 쌍이 문제인지
 * 사용자에게 말해 주려면 순환 여부만으로는 부족하다.
 */
function firstOrderCycle(pairs: readonly (readonly [string, string])[]): string[] | null {
  const next = new Map<string, string[]>();
  for (const [first, second] of pairs) {
    next.set(first, [...(next.get(first) ?? []), second]);
  }
  const done = new Set<string>();
  const path: string[] = [];
  const onPath = new Set<string>();

  const walk = (node: string): string[] | null => {
    if (onPath.has(node)) return [...path.slice(path.indexOf(node)), node];
    if (done.has(node)) return null;
    onPath.add(node);
    path.push(node);
    for (const child of next.get(node) ?? []) {
      const found = walk(child);
      if (found !== null) return found;
    }
    path.pop();
    onPath.delete(node);
    done.add(node);
    return null;
  };

  // 시작점은 입력 순서를 따른다 — 같은 입력이면 같은 순환을 돌려주기 위해서다
  for (const [first] of pairs) {
    const found = walk(first);
    if (found !== null) return found;
  }
  return null;
}

export const TripConstraintsSchema = z.object({
  arrivalAt: z.iso.datetime({ offset: true }),
  departureAt: z.iso.datetime({ offset: true }),
  airportReadyAt: z.iso.datetime({ offset: true }),
  airportStationId: z.string().min(1).optional(),
  gatewayStationId: z.string().min(1).optional(),
  selectedActorIds: z.array(z.string().min(1)).optional(),
  selectedActorId: z.string().min(1).optional(),
  selectedWorkIds: z.array(z.string().min(1)),
  excludedPlaceIds: z.array(z.string().min(1)),
  maxPlacesPerDay: z.number().int().positive(),
  dailySlackMinutes: z.number().int().nonnegative(),
  airportArrivalDeadline: z.iso.datetime({ offset: true }),
  // #139 방문일 소프트 선호 — placeId → YYYY-MM-DD(KST). 하드 고정(pinnedDates)이 아니다.
  // 날짜가 여행 기간 안인지·장소가 후보인지는 엔진이 판정한다(기간·후보 집합을 알아야 한다).
  preferredVisitDates: z.record(
    z.string().min(1),
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "preferredVisitDates must be YYYY-MM-DD"),
  ).optional(),
  /**
   * `[먼저, 나중]` 쌍 배열 (#145). 아래 superRefine이 **모순된 입력을 여기서 막는다** —
   * 엔진 안에서 조용히 무시하면 사용자는 요청이 사라진 이유를 알 수 없다.
   */
  preferredOrder: z.array(
    z.tuple([z.string().min(1), z.string().min(1)]),
  ).optional(),
}).superRefine((constraints, context) => {
  const pairs = constraints.preferredOrder ?? [];
  const seen = new Set<string>();
  pairs.forEach(([first, second], index) => {
    if (first === second) {
      context.addIssue({
        code: "custom",
        path: ["preferredOrder", index],
        message: "preferredOrder pair must reference two different places",
      });
      return;
    }
    const key = `${first}|${second}`;
    if (seen.has(key)) {
      context.addIssue({
        code: "custom",
        path: ["preferredOrder", index],
        message: `duplicate preferredOrder pair: ${key}`,
      });
    }
    seen.add(key);
  });

  // 순환은 길이 2뿐 아니라 3 이상도 모순이다 — `A→B, B→C, C→A`는 동시에 만족할 수 없다.
  // 드래그를 여러 번 하면 이런 쌍이 쌓일 수 있고, 조용히 일부를 `adjusted`로 돌려주면
  // 사용자의 모순된 요청을 그대로 받아 버린다 (PR #153 리뷰 3번).
  const cycle = firstOrderCycle(pairs);
  if (cycle !== null) {
    context.addIssue({
      code: "custom",
      path: ["preferredOrder"],
      message: `contradictory preferredOrder cycle: ${cycle.join(" → ")}`,
    });
  }
  if (Date.parse(constraints.arrivalAt) >= Date.parse(constraints.departureAt)) {
    context.addIssue({
      code: "custom",
      path: ["departureAt"],
      message: "departureAt must be later than arrivalAt",
    });
  }

  // #14 차단 2: 절대 시각 경계의 순서 — arrivalAt <= airportReadyAt < airportArrivalDeadline <= departureAt
  if (Date.parse(constraints.airportReadyAt) < Date.parse(constraints.arrivalAt)) {
    context.addIssue({
      code: "custom",
      path: ["airportReadyAt"],
      message: "airportReadyAt must not be earlier than arrivalAt",
    });
  }
  if (Date.parse(constraints.airportArrivalDeadline) > Date.parse(constraints.departureAt)) {
    context.addIssue({
      code: "custom",
      path: ["airportArrivalDeadline"],
      message: "airportArrivalDeadline must not be later than departureAt",
    });
  }
  if (Date.parse(constraints.airportReadyAt) >= Date.parse(constraints.airportArrivalDeadline)) {
    context.addIssue({
      code: "custom",
      path: ["airportArrivalDeadline"],
      message: "airportArrivalDeadline must be later than airportReadyAt",
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
  const parsed = TripConstraintsSchema.parse(constraints);
  return planItinerary(parsed, repos);
}

/**
 * #58 공항버스는 핵심 추천의 2초 응답을 막지 않는 후속 보강 결과다.
 * 순수 엔진 E2E와 후속 Server Action에서만 명시적으로 호출한다.
 */
export function generateItineraryWithGatewayAlternatives(
  constraints: TripConstraints,
  repos: Repositories,
): ItineraryResult {
  const parsed = TripConstraintsSchema.parse(constraints);
  const result = planItinerary(parsed, repos);
  if (result.status !== "planned") return result;
  const baseline = gatewayPlanningBaselineOf(result);
  if (!baseline) return result; // planned 분기에서는 도달하지 않는 방어 절
  const gatewayAlternatives = buildGatewayAlternatives(parsed, repos, baseline);
  return gatewayAlternatives.length > 0
    ? { ...result, gatewayAlternatives }
    : result;
}

/** #87 후속 Action용 — 핵심 추천을 재계산하지 않고 대안 플래너만 실행한다. */
export function generateGatewayAlternatives(
  constraints: TripConstraints,
  repos: Repositories,
  baseline: GatewayPlanningBaseline,
) {
  const parsed = TripConstraintsSchema.parse(constraints);
  return buildGatewayAlternatives(parsed, repos, baseline);
}
