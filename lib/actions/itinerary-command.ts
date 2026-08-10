"use server";

/**
 * #141 P0-1 자연어 일정 조율의 서버 경계.
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
import {
  changeSummaryOf,
  isExplainCommand,
  planRequestFor,
  proposalFor,
  type CommandProposal,
} from "../itinerary-command-executor";
import type { PlanRequest } from "./itinerary";
import { planItinerary } from "./itinerary";
import { getCandidatePlaces } from "./places";

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

export type CommandActionResult =
  | { ok: false; code: "INVALID_REQUEST"; fieldErrors: Record<string, string> }
  | {
      ok: true;
      interpretation: CommandActionInterpretation;
      outcome:
        | { kind: "clarify"; clarification: Clarification }
        | { kind: "explain" }
        | {
            kind: "proposal";
            proposal: CommandProposal;
            nextRequest: PlanRequest;
            nextResult: ItineraryResult;
            diff: ItineraryDiff;
            summary: ReturnType<typeof changeSummaryOf>;
          };
    };

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

/**
 * 자연어 한 문장을 해석하고, 실행 가능한 변경이면 전체 재계산 결과를 **제안**한다.
 * 이 함수는 어떤 결과도 저장하거나 확정하지 않는다. `needs_confirmation`은 호출 화면이
 * 명시적으로 적용하기 전까지 현재 일정을 유지한다.
 */
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
  const beforeAction = await planItinerary(request);
  if (!beforeAction.ok) {
    return { ok: false, code: "INVALID_REQUEST", fieldErrors: beforeAction.fieldErrors };
  }

  // 변경 설명은 실제 diff를 화면이 이미 보유한다. API를 호출해 같은 사실을 다시 쓰지 않는다.
  const deterministic = parseCommand(parsedSentence.data);
  const interpreted: CommandInterpretation = deterministic.intent === "explain_changes"
    ? { command: deterministic, source: "deterministic" }
    : await interpretCommand(parsedSentence.data, { apiKey: env.OPENAI_API_KEY });
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

  const proposedRequest = planRequestFor(resolved.command, request);
  const afterAction = await planItinerary(proposedRequest);
  if (!afterAction.ok) {
    return { ok: false, code: "INVALID_REQUEST", fieldErrors: afterAction.fieldErrors };
  }
  const proposal = proposalFor(resolved.command, beforeAction.result, afterAction.result);
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
  const diff = diffItineraries(beforeAction.result, nextResult);
  return {
    ok: true,
    interpretation,
    outcome: {
      kind: "proposal",
      proposal,
      nextRequest,
      nextResult,
      diff,
      summary: changeSummaryOf(beforeAction.result, nextResult),
    },
  };
}
