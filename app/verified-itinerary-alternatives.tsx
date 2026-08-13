"use client";

import { Clock3, GitCompareArrows, Route } from "lucide-react";
import type { ItineraryMetrics, VerifiedItineraryAlternative } from "@/lib/engine/types";
import type { MessageKey } from "@/lib/i18n/messages";
import { StageUtilityPortal } from "./stage-utility-portal";

function values(message: string, entries: Record<string, string | number>): string {
  return Object.entries(entries).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
    message,
  );
}

export function VerifiedItineraryAlternatives({
  alternatives,
  recommendedMetrics,
  placeName,
  selectedId,
  onSelect,
  tr,
}: {
  alternatives: VerifiedItineraryAlternative[];
  recommendedMetrics: ItineraryMetrics;
  placeName: (placeId: string) => string;
  selectedId: string | null;
  onSelect: (alternative: VerifiedItineraryAlternative | null) => void;
  tr: (key: MessageKey) => string;
}) {
  if (alternatives.length === 0) return null;

  return (
    <StageUtilityPortal>
      <details data-stage-utility="verified-alternatives" className="group w-fit rounded-lg border border-sc-blue/25 bg-sc-surface">
        <summary className="inline-flex min-h-11 w-max list-none items-center gap-2 px-3 py-2 text-sm marker:content-none">
          <span className="inline-flex items-center gap-2 whitespace-nowrap">
            <strong className="inline-flex items-center gap-1.5 font-medium text-sc-text">
              <GitCompareArrows aria-hidden="true" className="size-4 shrink-0" />
              <span>{tr("verifiedAlt.title")}</span>
            </strong>
            <span className="text-xs text-sc-muted" data-verified-alternative-selection>
              {selectedId === null ? tr("verifiedAlt.recommended") : tr("verifiedAlt.selected")}
            </span>
          </span>
          <span aria-hidden className="shrink-0 text-sc-muted transition-transform group-open:rotate-180">⌄</span>
        </summary>
        <div className="border-t border-sc-blue/15 px-3 pb-3 pt-2">
          <p className="text-xs text-sc-muted">{tr("verifiedAlt.subtitle")}</p>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            <button
              type="button"
              className={`rounded border p-2.5 text-left text-sm ${selectedId === null ? "border-sc-blue bg-sc-blue-soft" : "bg-white/70"}`}
              aria-pressed={selectedId === null}
              onClick={() => onSelect(null)}
            >
              <span className="font-medium">{tr("verifiedAlt.recommended")}</span>
              <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-sc-muted">
                <span className="inline-flex items-center gap-1">
                  <Clock3 aria-hidden="true" className="size-3.5" />
                  {values(tr("verifiedAlt.travelTotal"), { n: recommendedMetrics.totalTravelMinutes })}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Route aria-hidden="true" className="size-3.5" />
                  {values(tr("verifiedAlt.transferTotal"), { n: recommendedMetrics.transferCount })}
                </span>
              </span>
            </button>
            {alternatives.map((alternative) => (
              <button
                key={alternative.id}
                type="button"
                className={`rounded border p-2.5 text-left text-sm ${selectedId === alternative.id ? "border-sc-blue bg-sc-blue-soft" : "bg-white/70"}`}
                aria-pressed={selectedId === alternative.id}
                onClick={() => onSelect(alternative)}
              >
                <span className="flex flex-wrap gap-1">
                  {alternative.improvements.includes("faster") && (
                    <span className="rounded bg-sc-blue-soft px-1.5 py-0.5 text-xs font-medium text-sc-blue">
                      {tr("verifiedAlt.faster")}
                    </span>
                  )}
                  {alternative.improvements.includes("fewer_transfers") && (
                    <span className="rounded bg-sc-orange-soft px-1.5 py-0.5 text-xs font-medium text-sc-orange-text">
                      {tr("verifiedAlt.fewerTransfers")}
                    </span>
                  )}
                </span>
                <span className="mt-1 block text-xs text-sc-text/80">
                  {alternative.deltas.totalTravelMinutes < 0
                    ? values(tr("verifiedAlt.travelLess"), { n: Math.abs(alternative.deltas.totalTravelMinutes) })
                    : alternative.deltas.totalTravelMinutes > 0
                      ? values(tr("verifiedAlt.travelMore"), { n: alternative.deltas.totalTravelMinutes })
                      : tr("verifiedAlt.travelSame")}
                  {" · "}
                  {alternative.deltas.transferCount < 0
                    ? values(tr("verifiedAlt.transfersLess"), { n: Math.abs(alternative.deltas.transferCount) })
                    : alternative.deltas.transferCount > 0
                      ? values(tr("verifiedAlt.transfersMore"), { n: alternative.deltas.transferCount })
                    : tr("verifiedAlt.transfersSame")}
                </span>
                {(alternative.changes.removedPlaceIds.length > 0
                  || alternative.changes.addedPlaceIds.length > 0
                  || alternative.deltas.verifiedHoursMismatchCount > 0
                  || alternative.deltas.preferredDateMismatchCount > 0
                  || alternative.deltas.preferredOrderMismatchCount > 0
                  || alternative.deltas.warningCount > 0) && (
                  <span className="mt-2 block rounded bg-sc-orange-soft/70 px-2 py-1.5 text-xs text-sc-orange-text">
                    <strong className="block font-medium">{tr("verifiedAlt.tradeoffs")}</strong>
                    {alternative.changes.removedPlaceIds.length > 0 && (
                      <span className="mt-0.5 block">
                        {values(tr("verifiedAlt.removedPlaces"), {
                          places: alternative.changes.removedPlaceIds.map(placeName).join(", "),
                        })}
                      </span>
                    )}
                    {alternative.changes.addedPlaceIds.length > 0 && (
                      <span className="mt-0.5 block">
                        {values(tr("verifiedAlt.addedPlaces"), {
                          places: alternative.changes.addedPlaceIds.map(placeName).join(", "),
                        })}
                      </span>
                    )}
                    {alternative.deltas.verifiedHoursMismatchCount > 0 && (
                      <span className="mt-0.5 block">
                        {values(tr("verifiedAlt.verifiedHoursMore"), {
                          n: alternative.deltas.verifiedHoursMismatchCount,
                        })}
                      </span>
                    )}
                    {alternative.deltas.preferredDateMismatchCount > 0 && (
                      <span className="mt-0.5 block">
                        {values(tr("verifiedAlt.preferredDateMore"), {
                          n: alternative.deltas.preferredDateMismatchCount,
                        })}
                      </span>
                    )}
                    {alternative.deltas.preferredOrderMismatchCount > 0 && (
                      <span className="mt-0.5 block">
                        {values(tr("verifiedAlt.preferredOrderMore"), {
                          n: alternative.deltas.preferredOrderMismatchCount,
                        })}
                      </span>
                    )}
                    {alternative.deltas.warningCount > 0 && (
                      <span className="mt-0.5 block">
                        {values(tr("verifiedAlt.warningsMore"), {
                          n: alternative.deltas.warningCount,
                        })}
                      </span>
                    )}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </details>
    </StageUtilityPortal>
  );
}
