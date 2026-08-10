"use client";

import { Sparkles } from "lucide-react";
import type {
  CommandActionInterpretation,
  CommandActionResult,
} from "@/lib/actions/itinerary-command";
import type { MessageKey } from "@/lib/i18n/messages";
import type { ItineraryDiff } from "@/lib/itinerary-diff";
import type { Clarification } from "@/lib/itinerary-command-resolver";
import { impactLinesOf } from "@/lib/itinerary-command-messages";

type SuccessfulResult = Extract<CommandActionResult, { ok: true }>;
export type ProposalOutcome = Extract<SuccessfulResult["outcome"], { kind: "proposal" }>;

export type CommandFeedback =
  | { kind: "clarify"; interpretation: CommandActionInterpretation; clarification: Clarification }
  | {
      kind: "proposal";
      interpretation: CommandActionInterpretation;
      outcome: ProposalOutcome;
      applied: boolean;
      submittedSequence: number;
    }
  | { kind: "explain"; interpretation: CommandActionInterpretation }
  | { kind: "cancelled" }
  | { kind: "error" };

type Props = {
  value: string;
  pending: boolean;
  disabled: boolean;
  feedback: CommandFeedback | null;
  lastDiff: ItineraryDiff | null;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onExample: (value: string) => void;
  onApply: (outcome: ProposalOutcome, submittedSequence: number) => void;
  onDismiss: () => void;
  placeName: (placeId: string) => string;
  tr: (key: MessageKey) => string;
};

function withValues(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
    template,
  );
}

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

export function ItineraryCommandPanel({
  value,
  pending,
  disabled,
  feedback,
  lastDiff,
  onChange,
  onSubmit,
  onExample,
  onApply,
  onDismiss,
  placeName,
  tr,
}: Props) {
  const interpretation = feedback && (
    feedback.kind === "clarify"
    || feedback.kind === "proposal"
    || feedback.kind === "explain"
  ) ? feedback.interpretation : null;
  const source = interpretation ? sourceLabel(interpretation, tr) : null;
  const addExample = tr("ai.exampleAdd");
  const explainExample = tr("ai.exampleExplain");

  return (
    <section
      className="mt-3 rounded-xl border border-sc-blue/25 bg-gradient-to-br from-sc-blue-soft to-sc-surface p-3"
      aria-labelledby="itinerary-ai-title"
      data-itinerary-command-panel
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
        {[addExample, explainExample].map((example) => (
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

      {disabled && <p className="mt-2 text-xs text-sc-muted">{tr("ai.disabled")}</p>}

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

          {feedback.kind === "clarify" && (
            <p className="mt-1 text-sc-text">{clarificationText(feedback.clarification, placeName, tr)}</p>
          )}

          {feedback.kind === "explain" && (
            <p className="mt-1 text-sc-text">{diffExplanation(lastDiff, tr)}</p>
          )}

          {feedback.kind === "proposal" && (
            <>
              {feedback.outcome.proposal.decision === "impossible" ? (
                <p className="mt-1 text-sc-orange-text">
                  {withValues(tr("ai.impossible"), {
                    place: placeName(feedback.outcome.proposal.placeId),
                  })}
                </p>
              ) : feedback.applied ? (
                <p className="mt-1 font-medium text-sc-blue">
                  {withValues(tr("ai.applied"), {
                    place: placeName(feedback.outcome.proposal.placeId),
                    date: feedback.outcome.proposal.scheduledDate ?? feedback.outcome.proposal.requestedDate,
                  })}
                </p>
              ) : (
                <>
                  <p className="mt-1 font-medium text-sc-text">{tr("ai.confirmTitle")}</p>
                  <ul className="mt-2 space-y-1 text-xs text-sc-text/75">
                    {feedback.outcome.proposal.reasons.includes("date_adjusted") && (
                      <li>{withValues(tr("ai.confirmAdjusted"), {
                        date: feedback.outcome.proposal.scheduledDate ?? tr("common.nameUnavailable"),
                      })}</li>
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
