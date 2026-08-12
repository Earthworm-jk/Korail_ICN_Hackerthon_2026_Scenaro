"use client";

import { Sparkles, X } from "lucide-react";
import type {
  CommandActionInterpretation,
  CommandActionResult,
} from "@/lib/actions/itinerary-command";
// 자리표시자 치환은 공용 함수 하나만 쓴다 (#145). 사본을 두면 조사 선택 같은
// 공통 규칙이 한쪽에만 붙는다 — 실제로 이 파일의 사본이 조사 수정을 통째로 놓쳤다.
import { withValues, type MessageKey } from "@/lib/i18n/messages";
import type { ItineraryDiff } from "@/lib/itinerary-diff";
import type { Clarification } from "@/lib/itinerary-command-resolver";
import type { CommandProposal } from "@/lib/itinerary-command-executor";
import { impactLinesOf } from "@/lib/itinerary-command-messages";

type SuccessfulResult = Extract<CommandActionResult, { ok: true }>;
export type ProposalOutcome = Extract<SuccessfulResult["outcome"], { kind: "proposal" }>;
export type RecommendationOutcome = Extract<SuccessfulResult["outcome"], { kind: "recommendations" }>;

export type CommandFeedback =
  | { kind: "clarify"; interpretation: CommandActionInterpretation; clarification: Clarification }
  | {
      kind: "proposal";
      /** 버튼·드래그에는 해석 단계가 없다 — 없으면 출처 줄을 그리지 않는다 (#109) */
      interpretation?: CommandActionInterpretation;
      outcome: ProposalOutcome;
      applied: boolean;
      submittedSequence: number;
    }
  | { kind: "explain"; interpretation: CommandActionInterpretation }
  | {
      kind: "recommendations";
      interpretation: CommandActionInterpretation;
      outcome: RecommendationOutcome;
      submittedSequence: number;
    }
  | { kind: "cancelled" }
  | { kind: "undone" }
  | { kind: "error" };

type Props = {
  value: string;
  pending: boolean;
  disabled: boolean;
  disabledMessage?: MessageKey;
  feedback: CommandFeedback | null;
  lastDiff: ItineraryDiff | null;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onExample: (value: string) => void;
  onApply: (outcome: ProposalOutcome, submittedSequence: number) => void;
  onUndo: () => void;
  canUndo: boolean;
  onClose: () => void;
  /** 확인 대기 중에는 닫히지 않는다 (#151) */
  closeDisabled: boolean;
  onDismiss: () => void;
  placeName: (placeId: string) => string;
  tr: (key: MessageKey) => string;
};


function sourceLabel(
  interpretation: CommandActionInterpretation,
  tr: Props["tr"],
): { text: string; warning: boolean } {
  if (interpretation.source === "llm") {
    return { text: tr("ai.sourceLlm"), warning: false };
  }
  if (interpretation.fallbackReason === "NO_API_KEY") {
    return { text: tr("ai.sourceNoKey"), warning: true };
  }
  if (interpretation.fallbackReason === "INTERPRETATION_FAILED") {
    return { text: tr("ai.sourceFailed"), warning: true };
  }
  return { text: tr("ai.sourceDeterministic"), warning: false };
}

function clarificationText(
  clarification: Clarification,
  placeName: Props["placeName"],
  tr: Props["tr"],
): string {
  switch (clarification.code) {
    case "PLACE_NOT_FOUND":
      return withValues(tr("ai.clarifyNotFound"), { query: clarification.query });
    case "PLACE_AMBIGUOUS":
      return withValues(tr("ai.clarifyAmbiguous"), {
        query: clarification.query,
        matches: clarification.matches.map(({ id }) => placeName(id)).join(", "),
      });
    case "DAY_OUT_OF_RANGE":
      return withValues(tr("ai.clarifyDayRange"), { count: clarification.tripDayCount });
    case "MOVE_TARGET_NOT_SCHEDULED":
      return withValues(tr("ai.clarifyMoveMissing"), {
        place: placeName(clarification.placeId),
      });
    case "UNSUPPORTED":
      if (clarification.detail.source === "llm") return clarification.detail.question;
      if (clarification.detail.reason === "EMPTY_INPUT") return tr("ai.clarifyEmpty");
      if (clarification.detail.reason === "PLACE_MISSING") return tr("ai.clarifyPlace");
      if (clarification.detail.reason === "DAY_MISSING") {
        return withValues(tr("ai.clarifyDay"), {
          place: clarification.detail.placeName ?? tr("common.nameUnavailable"),
        });
      }
      return tr("ai.clarifyUnsupported");
  }
}

function diffExplanation(diff: ItineraryDiff | null, tr: Props["tr"]): string {
  if (!diff) return tr("ai.explainNone");
  if (!diff.changed) return tr("ai.explainUnchanged");
  return withValues(tr("ai.explainSummary"), {
    added: diff.places.added.length,
    moved: diff.places.moved.length,
    dropped: diff.places.dropped.length,
    rides: Math.max(diff.rides.added.length, diff.rides.dropped.length),
  });
}

/**
 * 제안 대상을 문장으로 (#146 10 — 날짜 통 드래그)
 *
 * 여러 장소를 한 번에 옮길 때 **한 곳처럼 말하면 안 된다.** 대표 이름만 적으면 나머지가
 * 조용히 움직인 것처럼 보이고, 사용자는 확인 창에서 무엇에 동의하는지 모른다.
 */
function targetLabelOf(
  proposal: CommandProposal,
  single: string,
  many: string,
  partial: string,
  placeName: (id: string) => string,
  orderLabel: string,
): string {
  /*
   * **순서 요청을 가장 먼저 가른다** (#145). 아래 문구들은 전부 날짜를 말하는데
   * 순서 요청에는 요청 날짜가 없다 - 그대로 두면 자리만 바꿨는데 "그 날 일정에
   * 반영했습니다"가 되어 날짜를 옮긴 것처럼 읽힌다. 실제로 그렇게 나왔다.
   */
  if (proposal.kind === "order") {
    const [first, second] = proposal.orderPair ?? [proposal.placeId, proposal.placeId];
    return withValues(orderLabel, { first: placeName(first), second: placeName(second) });
  }

  /*
   * **대상 수로 먼저 가른다.** `scheduledDate` 유무를 앞에 두면 한 곳짜리 실패까지
   * DAY 문구로 새어 나간다 — `impossible`에는 원래 `scheduledDate`가 없으므로,
   * 자연어나 날짜 버튼으로 장소 하나를 못 옮긴 기존 경로가 "이 날 일정을 통째로
   * 옮길 수 없습니다"라고 말하게 된다(PR #157 리뷰).
   */
  if (proposal.placeIds.length === 1) {
    return withValues(single, {
      place: placeName(proposal.placeId),
      date: proposal.scheduledDate ?? proposal.requestedDate,
    });
  }

  // 흩어지거나 일부가 빠지면 날짜도 개수도 단정할 수 없다 — 확인 창에서는 "일부는 다른
  // 날로 조정"이라 정확히 알려 놓고 적용 후에 "N곳을 그 날로 옮겼다"고 하면 거짓이 된다
  if (proposal.scheduledDate === undefined) return partial;
  return withValues(many, {
    count: String(proposal.placeIds.length),
    date: proposal.scheduledDate,
  });
}

export function ItineraryCommandPanel({
  value,
  pending,
  disabled,
  disabledMessage = "ai.disabled",
  feedback,
  lastDiff,
  onChange,
  onSubmit,
  onExample,
  onApply,
  onUndo,
  canUndo,
  onClose,
  closeDisabled,
  onDismiss,
  placeName,
  tr,
}: Props) {
  const interpretation = feedback && (
    feedback.kind === "clarify"
    || feedback.kind === "proposal"
    || feedback.kind === "explain"
    || feedback.kind === "recommendations"
  ) ? feedback.interpretation ?? null : null;
  const source = interpretation ? sourceLabel(interpretation, tr) : null;
  const addExample = tr("ai.exampleAdd");
  const recommendExample = tr("ai.exampleRecommend");
  const explainExample = tr("ai.exampleExplain");

  return (
    <section
      className="mt-3 ml-auto w-full max-w-[400px] rounded-xl border border-sc-blue/25 bg-gradient-to-br from-sc-blue-soft to-sc-surface p-3"
      aria-labelledby="itinerary-ai-title"
      data-itinerary-command-panel
      id="itinerary-ai-panel"
    >
      <div className="flex items-start gap-2">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-sc-blue text-white">
          <Sparkles aria-hidden="true" className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h4 id="itinerary-ai-title" className="text-sm font-semibold text-sc-blue">
            {tr("ai.title")}
          </h4>
          <p className="mt-0.5 text-xs text-sc-muted">{tr("ai.subtitle")}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={closeDisabled}
          aria-label={tr("ai.close")}
          className="flex size-8 shrink-0 items-center justify-center rounded-full border text-sc-muted hover:border-sc-blue hover:text-sc-blue disabled:opacity-40"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>

      <form
        className="mt-3 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <input
          value={value}
          maxLength={300}
          disabled={disabled || pending}
          onChange={(event) => onChange(event.target.value)}
          placeholder={tr("ai.placeholder")}
          aria-label={tr("ai.inputLabel")}
          className="min-w-0 flex-1 rounded-lg border border-sc-blue/25 bg-sc-surface px-3 py-2 text-sm outline-none focus:border-sc-blue disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={disabled || pending || value.trim().length === 0}
          className="min-h-10 shrink-0 rounded-lg bg-sc-blue px-3 text-sm font-semibold text-white disabled:opacity-40"
        >
          {pending ? tr("ai.pending") : tr("ai.submit")}
        </button>
      </form>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {[addExample, recommendExample, explainExample].map((example) => (
          <button
            key={example}
            type="button"
            disabled={disabled || pending}
            onClick={() => onExample(example)}
            className="rounded-full border border-sc-blue/20 bg-sc-surface px-2.5 py-1 text-xs text-sc-blue disabled:opacity-40"
          >
            {example}
          </button>
        ))}
      </div>

      {pending && (
        <p className="mt-2 text-xs text-sc-blue" role="status" aria-live="polite">
          {tr("ai.pendingDetail")}
        </p>
      )}

      {disabled && <p className="mt-2 text-xs text-sc-muted">{tr(disabledMessage)}</p>}

      {feedback && (
        <div className="mt-3 rounded-lg border border-sc-blue/15 bg-sc-surface/90 p-3 text-sm" role="status" aria-live="polite">
          {source && (
            <p className={`text-xs font-medium ${source.warning ? "text-sc-orange-text" : "text-sc-blue"}`}>
              {source.text}
            </p>
          )}

          {feedback.kind === "error" && <p className="text-sc-red">{tr("ai.error")}</p>}

          {feedback.kind === "cancelled" && (
            <p className="text-sc-muted">{tr("ai.cancelled")}</p>
          )}

          {feedback.kind === "undone" && (
            <p className="text-sc-muted">{tr("ai.undone")}</p>
          )}

          {feedback.kind === "clarify" && (
            <p className="mt-1 text-sc-text">{clarificationText(feedback.clarification, placeName, tr)}</p>
          )}

          {feedback.kind === "explain" && (
            <p className="mt-1 text-sc-text">{diffExplanation(lastDiff, tr)}</p>
          )}

          {feedback.kind === "recommendations" && (
            <p className="mt-1 text-sc-text">
              {feedback.outcome.recommendations.length > 0
                ? withValues(tr(`ai.recommendReady.${
                  feedback.outcome.recommendations.length === 1 ? "one" : "other"
                }` as MessageKey), {
                  count: feedback.outcome.recommendations.length,
                  date: feedback.outcome.targetDate,
                })
                : tr("ai.recommendEmpty")}
            </p>
          )}

          {/* 추천은 적용 또는 취소로 결론나야 한다. 취소 경로가 없으면 카드를 고르지
              않으려는 사용자가 X·Esc·토글이 모두 막힌 채 갇힌다 (PR #152 리뷰 3번) */}
          {feedback.kind === "recommendations" && (
            <button
              type="button"
              onClick={onDismiss}
              className="mt-3 min-h-9 rounded-lg border px-3 py-1.5 text-xs font-medium"
            >
              {tr("ai.cancel")}
            </button>
          )}

          {feedback.kind === "proposal" && (
            <>
              {feedback.outcome.proposal.decision === "impossible" ? (
                <p className="mt-1 text-sc-orange-text">
                  {targetLabelOf(feedback.outcome.proposal, tr("ai.impossible"), tr("ai.impossibleDay"), tr("ai.impossibleDay"), placeName, tr("ai.impossibleOrder"))}
                </p>
              ) : feedback.applied ? (
                <>
                  <p className="mt-1 font-medium text-sc-blue">
                    {targetLabelOf(feedback.outcome.proposal, tr("ai.applied"), tr("ai.appliedDay"), tr("ai.appliedDayPartial"), placeName, tr("ai.appliedOrder"))}
                  </p>
                  {/* 부작용 없는 변경은 즉시 적용하되 한 번에 되돌릴 수 있어야 한다 (#145) */}
                  {canUndo && (
                    <button
                      type="button"
                      onClick={onUndo}
                      className="mt-2 min-h-9 rounded-lg border px-3 py-1.5 text-xs font-medium"
                    >
                      {tr("ai.undo")}
                    </button>
                  )}
                </>
              ) : (
                <>
                  <p className="mt-1 font-medium text-sc-text">{tr("ai.confirmTitle")}</p>
                  <ul className="mt-2 space-y-1 text-xs text-sc-text/75">
                    {/* 순서 조정 (#145). 혼합 권역에서 성립률이 63%라 자주 나오는
                        줄이다 — 왜 요청대로 안 됐는지 여기서 말하지 않으면 사용자는
                        기능이 안 먹은 것으로 읽는다 */}
                    {feedback.outcome.proposal.reasons.includes("order_adjusted") && (
                      <li>{tr("ai.confirmOrderAdjusted")}</li>
                    )}
                    {feedback.outcome.proposal.reasons.includes("date_adjusted") && (
                      /* 날짜를 말할 수 있을 때만 말한다. 통 이동에서 장소들이 흩어져 앉으면
                         한 날짜로 요약할 수 없는데, 이름 폴백을 쓰면 날짜 자리에
                         "이름을 불러오지 못했습니다"가 들어가 문장이 무너진다 */
                      <li>{feedback.outcome.proposal.scheduledDate
                        ? withValues(tr("ai.confirmAdjusted"), {
                          date: feedback.outcome.proposal.scheduledDate,
                        })
                        : tr("ai.confirmAdjustedScattered")}</li>
                    )}
                    {feedback.outcome.proposal.displaced.map(({ placeId }) => (
                      <li key={`displaced-${placeId}`}>
                        {withValues(tr("ai.confirmDisplaced"), { place: placeName(placeId) })}
                      </li>
                    ))}
                    {feedback.outcome.proposal.moved.map(({ placeId, fromDate, toDate }) => (
                      <li key={`moved-${placeId}`}>
                        {withValues(tr("ai.confirmMoved"), {
                          place: placeName(placeId), from: fromDate, to: toDate,
                        })}
                      </li>
                    ))}
                    {/* 이동시간·환승·출국 여유는 장소 목록이 아니라 일정 전체에 대한 한 줄이다.
                        사유와 문구 키의 매핑은 lib에 두고 테스트로 잠근다 (PR #148 리뷰 1번) */}
                    {impactLinesOf(feedback.outcome.proposal).map(({ reason, messageKey, value }) => (
                      <li key={`impact-${reason}`}>
                        {withValues(tr(messageKey), {
                          minutes: String(value), count: String(value),
                        })}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => onApply(feedback.outcome, feedback.submittedSequence)}
                      className="rounded-lg bg-sc-blue px-3 py-2 text-xs font-semibold text-white"
                    >
                      {tr("ai.apply")}
                    </button>
                    <button
                      type="button"
                      onClick={onDismiss}
                      className="rounded-lg border px-3 py-2 text-xs font-medium"
                    >
                      {tr("ai.cancel")}
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
