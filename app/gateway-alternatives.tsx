"use client";

import { BusFront, TrainFront } from "lucide-react";
import type { GatewayAlternative } from "@/lib/engine/types";
import type { Locale, MessageKey } from "@/lib/i18n/messages";
import { StageUtilityPortal } from "./stage-utility-portal";

const KST = "Asia/Seoul";

function fmt(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", {
    timeZone: KST,
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

export function GatewayAlternatives({ alternatives, selectedId, locale, onSelect, tr }: {
  alternatives: GatewayAlternative[];
  selectedId: string | null;
  locale: Locale;
  onSelect: (alternative: GatewayAlternative | null) => void;
  tr: (key: MessageKey) => string;
}) {
  if (alternatives.length === 0) return null;
  const selected = selectedId === null
    ? tr("gateway.railTitle")
    : alternatives.find((alternative) => alternative.id === selectedId)?.serviceName[locale] ?? tr("gateway.title");
  const SelectedIcon = selectedId === null ? TrainFront : BusFront;

  return (
    <StageUtilityPortal>
      <details data-stage-utility="gateway" className="group rounded-lg border border-sc-blue/25 bg-sc-surface">
        <summary className="flex min-h-11 list-none items-center justify-between gap-3 px-3 py-2.5 text-sm marker:content-none">
          <span className="min-w-0">
            <strong className="flex items-center gap-1.5 font-medium text-sc-text">
              <BusFront aria-hidden="true" className="size-4 shrink-0" />
              <span>{tr("gateway.dockTitle")}</span>
            </strong>
            <span className="flex items-center gap-1.5 text-xs text-sc-muted">
              <SelectedIcon aria-hidden="true" className="size-3.5 shrink-0" />
              <span>{selected}</span>
            </span>
          </span>
          <span aria-hidden className="shrink-0 text-sc-muted transition-transform group-open:rotate-180">⌄</span>
        </summary>
        <div className="border-t border-sc-blue/15 px-3 pb-3 pt-2">
          <p className="text-xs text-sc-muted">{tr("gateway.subtitle")}</p>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            <button
              className={`rounded border p-2.5 text-left text-sm ${selectedId === null ? "border-sc-blue bg-white" : "bg-white/70"}`}
              aria-pressed={selectedId === null}
              onClick={() => onSelect(null)}
            >
              <span className="flex items-center gap-1.5 font-medium">
                <TrainFront aria-hidden="true" className="size-4 shrink-0" />
                {tr("gateway.railTitle")}
              </span>
              <span className="mt-0.5 block text-xs text-sc-muted">{tr("gateway.railDesc")}</span>
            </button>
            {alternatives.map((alternative) => {
              const legs = alternative.days.flatMap((day) => day.gatewayLegs ?? []);
              const outbound = legs.find((leg) => leg.direction === "outbound");
              const inbound = legs.find((leg) => leg.direction === "inbound");
              return (
                <button
                  key={alternative.id}
                  className={`rounded border p-2.5 text-left text-sm ${selectedId === alternative.id ? "border-sc-blue bg-white" : "bg-white/70"}`}
                  aria-pressed={selectedId === alternative.id}
                  onClick={() => onSelect(alternative)}
                >
                  <span className="inline-flex items-center gap-1.5 font-medium">
                    <BusFront aria-hidden="true" className="size-4 shrink-0" />
                    {alternative.serviceName[locale]}
                  </span>
                  <span className="ml-2 rounded bg-sc-orange-soft px-1.5 py-0.5 text-xs text-sc-orange-text">
                    {tr("gateway.direct")}
                  </span>
                  {outbound && inbound && (
                    <span className="mt-1 block text-xs text-sc-text/80">
                      {fmt(outbound.departAt, locale)} {outbound.fromName[locale]} → {outbound.toName[locale]}<br />
                      {fmt(inbound.departAt, locale)} {inbound.fromName[locale]} → {inbound.toName[locale]}
                    </span>
                  )}
                  <span className="mt-1 block text-xs text-sc-muted">
                    {tr("gateway.localUse")} {alternative.effects.localUseDeltaMinutes >= 0 ? "+" : ""}{alternative.effects.localUseDeltaMinutes}{tr("step1.minutes")}
                  </span>
                  <span className="mt-1.5 block text-[11px] text-sc-orange-text">
                    {tr("gateway.verifiedAt")} {alternative.schedule.verifiedAt} · {tr("gateway.recheck")}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </details>
    </StageUtilityPortal>
  );
}
