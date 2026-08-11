"use server";

/**
 * #141 P0-1 방문일 조율과 P0-2 동선 추천의 서버 경계.
 *
 * 클라이언트는 문장과 현재 조건만 보낸다. 현재 일정·장소 ID·날짜 판정을 신뢰 입력으로
 * 받지 않고 서버에서 기준 일정을 다시 계산한 뒤, 검증 카탈로그와 엔진 결과로 제안한다.
 * OpenAI는 문장을 허용된 원시 명령으로 해석할 뿐이며 ID·날짜·시간은 만들지 않는다.
 */
import { z } from "zod";
import { interpretCommand, type CommandInterpretation } from "../adapters/command-interpretation";
import { env } from "../env";
import { tripDatesForWindow } from "../engine";
import type { ItineraryResult } from "../engine/types";
import { diffItineraries, type ItineraryDiff } from "../itinerary-diff";
import { parseCommand } from "../itinerary-command-fallback";
import { resolveCommand, type Clarification } from "../itinerary-command-resolver";
import type { VisitDateCommand } from "../itinerary-command";
import {
  changeSummaryOf,
  isExplainCommand,
  planRequestFor,
  planRequestForOrder,
  planRequestForPlaces,
  proposalFor,
  proposalForOrder,
  proposalForPlaces,
  type CommandProposal,
} from "../itinerary-command-executor";
import type { PlanRequest } from "./itinerary";
import { planItinerary } from "./itinerary";
import { getCandidatePlaces, type PlaceCandidate } from "./places";
import { loadRepositories } from "../repositories/json";

const SentenceSchema = z.string().trim().min(1).max(300);
const PlanRequestSchema = z.object({
  arrivalAt: z.iso.datetime({ offset: true }),
  departureAt: z.iso.datetime({ offset: true }),
  airportReadyAt: z.iso.datetime({ offset: true }),
  airportArrivalDeadline: z.iso.datetime({ offset: true }),
  selectedActorIds: z.array(z.string().min(1)).max(20),
  selectedWorkIds: z.array(z.string().min(1)).max(20),
  excludedPlaceIds: z.array(z.string().min(1)).max(100),
  preferredVisitDates: z.record(
    z.string().min(1),
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  ).optional(),
}).strict();

export type CommandActionInterpretation = Pick<
  CommandInterpretation,
  "source" | "fallbackReason"
>;

export type RouteRecommendation = {
  placeId: string;
  targetDate: string;
  travelMinutesDelta: number;
  routeMatch: "same_station" | "same_region";
  matchedWorkIds: string[];
  displacedPlaceIds: string[];
  movedPlaceIds: string[];
};

export type ProposalOutcomePayload = {
  kind: "proposal";
  proposal: CommandProposal;
  nextRequest: PlanRequest;
  nextResult: ItineraryResult;
  diff: ItineraryDiff;
  summary: ReturnType<typeof changeSummaryOf>;
};

/** 버튼·드래그 결과 — 해석 단계가 없어 `interpretation`이 없다 (#109) */
export type VisitDateEditResult =
  | { ok: false; code: "INVALID_REQUEST"; fieldErrors: Record<string, string> }
  | { ok: true; outcome: ProposalOutcomePayload };

export type CommandActionResult =
  | { ok: false; code: "INVALID_REQUEST"; fieldErrors: Record<string, string> }
  | {
      ok: true;
      interpretation: CommandActionInterpretation;
      outcome:
        | { kind: "clarify"; clarification: Clarification }
        | { kind: "explain" }
        | {
            kind: "recommendations";
            targetDate: string;
            recommendations: RouteRecommendation[];
          }
        | ProposalOutcomePayload;
    };

/** 버튼·드래그 입력 — 자연어와 달리 장소·날짜가 이미 정해져 온다 (#109) */
const VisitDateEditSchema = z.object({
  placeId: z.string().min(1),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  request: PlanRequestSchema,
});

/** 같은 날 순서 드래그 (#145). 두 장소가 같으면 요청 자체가 뜻이 없다 */
const VisitOrderEditSchema = z.object({
  firstPlaceId: z.string().min(1),
  secondPlaceId: z.string().min(1),
  request: PlanRequestSchema,
}).refine(
  ({ firstPlaceId, secondPlaceId }) => firstPlaceId !== secondPlaceId,
  { path: ["secondPlaceId"], message: "같은 장소를 앞뒤로 둘 수 없습니다" },
);

/** 빈 날짜를 끌면 옮길 것이 없다 — 계산을 부르지 않고 입력에서 막는다 */
const DayMoveSchema = z.object({
  placeIds: z.array(z.string().min(1)).min(1),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  request: PlanRequestSchema,
});

function fieldErrorsOf(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    errors[issue.path.join(".") || "request"] ??= issue.message;
  }
  return errors;
}

function scheduledPlaceIds(result: ItineraryResult): Set<string> {
  return new Set(
    result.status === "planned"
      ? result.days.flatMap((day) => day.items.map((item) => item.placeId))
      : [],
  );
}

const MAX_RECOMMENDATIONS = 3;
const MAX_VALIDATION_CANDIDATES = 8;

async function routeRecommendations(params: {
  request: PlanRequest;
  before: ItineraryResult;
  candidates: PlaceCandidate[];
  targetDate: string;
}): Promise<RouteRecommendation[]> {
  if (params.before.status !== "planned") return [];
  const targetDay = params.before.days.find(({ date }) => date === params.targetDate);
  if (!targetDay) return [];

  const repos = loadRepositories();
  const candidateById = new Map(params.candidates.map((candidate) => [candidate.id, candidate]));
  const stationRegion = new Map<string, string>(
    repos.stations.map(({ id, regionId }) => [id, regionId]),
  );
  const targetStations = new Set(
    targetDay.items
      .map(({ placeId }) => candidateById.get(placeId)?.nearestStationId)
      .filter((id): id is string => id !== undefined),
  );
  for (const window of targetDay.regionWindows) targetStations.add(window.stationId);
  const targetRegions = new Set<string>(
    [...targetStations]
      .map((stationId) => stationRegion.get(stationId))
      .filter((id): id is string => id !== undefined),
  );
  const excluded = new Set(params.request.excludedPlaceIds);

  const shortlist = params.candidates
    .filter((candidate) => excluded.has(candidate.id))
    .map((candidate) => {
      const routeMatch = targetStations.has(candidate.nearestStationId)
        ? "same_station" as const
        : targetRegions.has(stationRegion.get(candidate.nearestStationId) ?? "")
          ? "same_region" as const
          : null;
      return routeMatch ? { candidate, routeMatch } : null;
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .sort((a, b) => {
      const routeOrder = Number(a.routeMatch === "same_region") - Number(b.routeMatch === "same_region");
      if (routeOrder !== 0) return routeOrder;
      const rankOrder = (a.candidate.aiRank ?? Number.MAX_SAFE_INTEGER)
        - (b.candidate.aiRank ?? Number.MAX_SAFE_INTEGER);
      if (rankOrder !== 0) return rankOrder;
      return a.candidate.id.localeCompare(b.candidate.id, "en");
    })
    .slice(0, MAX_VALIDATION_CANDIDATES);

  const recommendations: RouteRecommendation[] = [];
  for (const { candidate, routeMatch } of shortlist) {
    const nextRequest: PlanRequest = {
      ...params.request,
      excludedPlaceIds: params.request.excludedPlaceIds.filter((id) => id !== candidate.id),
      preferredVisitDates: {
        ...(params.request.preferredVisitDates ?? {}),
        [candidate.id]: params.targetDate,
      },
    };
    const action = await planItinerary(nextRequest);
    if (!action.ok || action.result.status !== "planned") continue;
    const scheduledOnTarget = action.result.days
      .find(({ date }) => date === params.targetDate)
      ?.items.some(({ placeId }) => placeId === candidate.id) === true;
    if (!scheduledOnTarget) continue;

    const diff = diffItineraries(params.before, action.result);
    recommendations.push({
      placeId: candidate.id,
      targetDate: params.targetDate,
      travelMinutesDelta: action.result.metrics.totalTravelMinutes - params.before.metrics.totalTravelMinutes,
      routeMatch,
      matchedWorkIds: candidate.workIds
        .filter((id) => params.request.selectedWorkIds.includes(id))
        .sort((a, b) => a.localeCompare(b, "en")),
      displacedPlaceIds: diff.places.dropped.map(({ placeId }) => placeId).sort((a, b) => a.localeCompare(b, "en")),
      movedPlaceIds: diff.places.moved.map(({ placeId }) => placeId).sort((a, b) => a.localeCompare(b, "en")),
    });

  }

  return recommendations
    .sort((a, b) => a.displacedPlaceIds.length - b.displacedPlaceIds.length
      || a.movedPlaceIds.length - b.movedPlaceIds.length
      || a.travelMinutesDelta - b.travelMinutesDelta
      || Number(a.routeMatch === "same_region") - Number(b.routeMatch === "same_region")
      || a.placeId.localeCompare(b.placeId, "en"))
    .slice(0, MAX_RECOMMENDATIONS);
}

/**
 * 자연어 한 문장을 해석하고, 실행 가능한 변경이면 전체 재계산 결과를 **제안**한다.
 * 이 함수는 어떤 결과도 저장하거나 확정하지 않는다. `needs_confirmation`은 호출 화면이
 * 명시적으로 적용하기 전까지 현재 일정을 유지한다.
 */
/**
 * 명령 하나를 재계산하고 제안으로 만든다 — 자연어·버튼·드래그가 공유하는 마지막 구간.
 *
 * 여기서 갈라지면 세 표현이 서로 다른 확정 규칙을 갖게 된다. #118 결정 2의
 * `별도 엔진을 만들지 않고 동일한 재계산 액션을 사용한다`가 이 함수다.
 */
async function buildProposalOutcome(
  command: VisitDateCommand,
  request: PlanRequest,
  before: ItineraryResult,
): Promise<ProposalOutcomePayload | { invalid: Record<string, string> }> {
  const proposedRequest = planRequestFor(command, request);
  const afterAction = await planItinerary(proposedRequest);
  if (!afterAction.ok) return { invalid: afterAction.fieldErrors };
  const proposal = proposalFor(command, before, afterAction.result);
  // 확인 창에서 고지한 displaced 장소를 사용자가 승인하면 그 장소는 선택에서도 빠진다.
  // 승인 직후 화면에 rejectedPlaces가 남지 않도록, 실제 적용용 결과는 해당 장소를 명시적으로
  // 제외한 요청으로 한 번 더 검증한다. proposal 자체는 첫 결과를 기준으로 유지해 무엇이
  // 제외되는지 사용자에게 그대로 설명한다.
  let nextRequest = proposedRequest;
  let nextResult = afterAction.result;
  if (proposal.decision !== "impossible" && proposal.displaced.length > 0) {
    nextRequest = {
      ...proposedRequest,
      excludedPlaceIds: [
        ...new Set([
          ...proposedRequest.excludedPlaceIds,
          ...proposal.displaced.map(({ placeId }) => placeId),
        ]),
      ],
    };
    const acceptedAction = await planItinerary(nextRequest);
    if (acceptedAction.ok) nextResult = acceptedAction.result;
  }
  return {
    kind: "proposal",
    proposal,
    nextRequest,
    nextResult,
    diff: diffItineraries(before, nextResult),
    summary: changeSummaryOf(before, nextResult),
  };
}

export async function runItineraryCommand(input: {
  sentence: string;
  request: PlanRequest;
}): Promise<CommandActionResult> {
  const parsedSentence = SentenceSchema.safeParse(input.sentence);
  const parsedRequest = PlanRequestSchema.safeParse(input.request);
  if (!parsedSentence.success || !parsedRequest.success) {
    return {
      ok: false,
      code: "INVALID_REQUEST",
      fieldErrors: {
        ...(parsedSentence.success ? {} : fieldErrorsOf(parsedSentence.error)),
        ...(parsedRequest.success ? {} : fieldErrorsOf(parsedRequest.error)),
      },
    };
  }

  const request = parsedRequest.data;
  // 변경 설명은 화면이 보유한 실제 diff를 문장으로 옮길 뿐이다. 대표 설명 문장은 LLM뿐
  // 아니라 기준 일정 재계산도 필요 없으므로 가장 먼저 종료한다.
  const deterministic = parseCommand(parsedSentence.data);
  if (deterministic.intent === "explain_changes") {
    return {
      ok: true,
      interpretation: { source: "deterministic" },
      outcome: { kind: "explain" },
    };
  }

  const beforeAction = await planItinerary(request);
  if (!beforeAction.ok) {
    return { ok: false, code: "INVALID_REQUEST", fieldErrors: beforeAction.fieldErrors };
  }

  const interpreted: CommandInterpretation = await interpretCommand(
    parsedSentence.data,
    { apiKey: env.OPENAI_API_KEY },
  );
  const interpretation: CommandActionInterpretation = {
    source: interpreted.source,
    ...(interpreted.fallbackReason ? { fallbackReason: interpreted.fallbackReason } : {}),
  };

  const candidates = await getCandidatePlaces({
    selectedActorIds: request.selectedActorIds,
    selectedWorkIds: request.selectedWorkIds,
  });
  const resolved = resolveCommand(interpreted.command, {
    tripDates: tripDatesForWindow(request.airportReadyAt, request.airportArrivalDeadline),
    candidates: candidates.candidates.map(({ id, name }) => ({ id, name })),
    scheduledPlaceIds: scheduledPlaceIds(beforeAction.result),
  });

  if (!resolved.ok) {
    return {
      ok: true,
      interpretation,
      outcome: { kind: "clarify", clarification: resolved.clarification },
    };
  }
  if (isExplainCommand(resolved.command)) {
    return { ok: true, interpretation, outcome: { kind: "explain" } };
  }
  if (resolved.command.intent === "recommend_along_route") {
    return {
      ok: true,
      interpretation,
      outcome: {
        kind: "recommendations",
        targetDate: resolved.command.targetDate,
        recommendations: await routeRecommendations({
          request,
          before: beforeAction.result,
          candidates: candidates.candidates,
          targetDate: resolved.command.targetDate,
        }),
      },
    };
  }

  const outcome = await buildProposalOutcome(resolved.command, request, beforeAction.result);
  if ("invalid" in outcome) {
    return { ok: false, code: "INVALID_REQUEST", fieldErrors: outcome.invalid };
  }
  return { ok: true, interpretation, outcome };
}

/**
 * 날짜 선택 버튼·드래그의 진입점 (#109).
 *
 * 자연어와 **같은 명령·같은 실행기·같은 판정**을 쓴다. 해석 단계만 없다 — 사용자가
 * 이미 장소와 날짜를 직접 골랐으므로 LLM도 파서도 부를 이유가 없다.
 */
/**
 * 날짜 통 이동 (#146 10)
 *
 * 그 날 장소 전부에 같은 날짜 선호를 건다. **새 엔진 계약은 없다** — `preferredVisitDates`
 * 하나에 항목이 여러 개 들어갈 뿐이다.
 *
 * 판정도 한 곳짜리와 같은 경로를 쓴다. 다만 여러 장소가 한 번에 움직이므로 부작용이 클 수
 * 있어, `ready`가 아니면 호출부가 확인을 받는다(#146 결정).
 */
export async function runDayMove(input: {
  placeIds: string[];
  targetDate: string;
  request: PlanRequest;
}): Promise<VisitDateEditResult> {
  const parsed = DayMoveSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "INVALID_REQUEST", fieldErrors: fieldErrorsOf(parsed.error) };
  }
  const { placeIds, targetDate, request } = parsed.data;
  const beforeAction = await planItinerary(request);
  if (!beforeAction.ok) {
    return { ok: false, code: "INVALID_REQUEST", fieldErrors: beforeAction.fieldErrors };
  }
  const nextRequest = planRequestForPlaces(placeIds, targetDate, request);
  const afterAction = await planItinerary(nextRequest);
  if (!afterAction.ok) {
    return { ok: false, code: "INVALID_REQUEST", fieldErrors: afterAction.fieldErrors };
  }
  return {
    ok: true,
    outcome: {
      kind: "proposal",
      proposal: proposalForPlaces(placeIds, targetDate, beforeAction.result, afterAction.result),
      nextRequest,
      nextResult: afterAction.result,
      diff: diffItineraries(beforeAction.result, afterAction.result),
      summary: changeSummaryOf(beforeAction.result, afterAction.result),
    },
  };
}

/**
 * 같은 날 방문 순서 조율 (#145).
 *
 * `runVisitDateEdit`과 **같은 골격이다** — 명령 전 일정을 먼저 계산하고, 요청을 패치해
 * 다시 계산한 뒤 둘을 비교해 제안을 만든다. #118 결정 2의 `별도 엔진을 만들지 않고
 * 동일한 재계산 액션을 사용한다`가 여기에도 걸린다.
 *
 * 엔진의 순환 거부(`INVALID_REQUEST`)는 그대로 올려 보낸다. 화면이 어느 쌍이 문제인지
 * 말할 수 있어야 하므로 여기서 삼키지 않는다.
 */
export async function runVisitOrderEdit(input: {
  firstPlaceId: string;
  secondPlaceId: string;
  request: PlanRequest;
}): Promise<VisitDateEditResult> {
  const parsed = VisitOrderEditSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "INVALID_REQUEST", fieldErrors: fieldErrorsOf(parsed.error) };
  }
  const { firstPlaceId, secondPlaceId, request } = parsed.data;
  const beforeAction = await planItinerary(request);
  if (!beforeAction.ok) {
    return { ok: false, code: "INVALID_REQUEST", fieldErrors: beforeAction.fieldErrors };
  }
  const proposedRequest = planRequestForOrder(firstPlaceId, secondPlaceId, request);
  const afterAction = await planItinerary(proposedRequest);
  if (!afterAction.ok) {
    return { ok: false, code: "INVALID_REQUEST", fieldErrors: afterAction.fieldErrors };
  }
  const proposal = proposalForOrder(
    firstPlaceId, secondPlaceId, beforeAction.result, afterAction.result,
  );
  return {
    ok: true,
    outcome: {
      kind: "proposal",
      proposal,
      nextRequest: proposedRequest,
      nextResult: afterAction.result,
      diff: diffItineraries(beforeAction.result, afterAction.result),
      summary: changeSummaryOf(beforeAction.result, afterAction.result),
    },
  };
}

export async function runVisitDateEdit(input: {
  placeId: string;
  targetDate: string;
  request: PlanRequest;
}): Promise<VisitDateEditResult> {
  const parsed = VisitDateEditSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "INVALID_REQUEST", fieldErrors: fieldErrorsOf(parsed.error) };
  }
  const { placeId, targetDate, request } = parsed.data;
  const beforeAction = await planItinerary(request);
  if (!beforeAction.ok) {
    return { ok: false, code: "INVALID_REQUEST", fieldErrors: beforeAction.fieldErrors };
  }
  // 일정에 이미 있으면 이동, 없으면 추가 — resolver와 같은 규칙이다
  const intent = scheduledPlaceIds(beforeAction.result).has(placeId) ? "move_place" : "add_place";
  const outcome = await buildProposalOutcome(
    { intent, placeId, targetDate },
    request,
    beforeAction.result,
  );
  if ("invalid" in outcome) {
    return { ok: false, code: "INVALID_REQUEST", fieldErrors: outcome.invalid };
  }
  return { ok: true, outcome };
}
