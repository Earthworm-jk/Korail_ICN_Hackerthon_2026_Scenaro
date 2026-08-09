"use client";

import type { GatewayAlternative } from "@/lib/engine/types";
import type { Locale, MessageKey } from "@/lib/i18n/messages";

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
  return (
    <section aria-labelledby="gateway-alternatives-title" className="rounded-lg border border-sc-blue/30 bg-sc-blue-soft/40 p-4">
      <h3 id="gateway-alternatives-title" className="font-medium">{tr("gateway.title")}</h3>
      <p className="mt-0.5 text-xs text-sc-muted">{tr("gateway.subtitle")}</p>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        <button
          className={`rounded border p-3 text-left text-sm ${selectedId === null ? "border-sc-blue bg-white" : "bg-white/70"}`}
          aria-pressed={selectedId === null}
          onClick={() => onSelect(null)}
        >
          <span className="font-medium">🚆 {tr("gateway.railTitle")}</span>
          <span className="mt-1 block text-xs text-sc-muted">{tr("gateway.railDesc")}</span>
        </button>
        {alternatives.map((alternative) => {
          const legs = alternative.days.flatMap((day) => day.gatewayLegs ?? []);
          const outbound = legs.find((leg) => leg.direction === "outbound");
          const inbound = legs.find((leg) => leg.direction === "inbound");
          return (
            <button
              key={alternative.id}
              className={`rounded border p-3 text-left text-sm ${selectedId === alternative.id ? "border-sc-blue bg-white" : "bg-white/70"}`}
              aria-pressed={selectedId === alternative.id}
              onClick={() => onSelect(alternative)}
            >
              <span className="font-medium">🚌 {alternative.serviceName[locale]}</span>
              <span className="ml-2 rounded bg-sc-orange-soft px-1.5 py-0.5 text-xs text-sc-orange-text">
                {tr("gateway.direct")}
              </span>
              <span className="mt-1 block text-xs text-sc-muted">{alternative.operator[locale]}</span>
              {outbound && inbound && (
                <span className="mt-1 block text-xs text-sc-text/80">
                  {fmt(outbound.departAt, locale)} {outbound.fromName[locale]} → {outbound.toName[locale]} ·{" "}
                  {fmt(inbound.departAt, locale)} {inbound.fromName[locale]} → {inbound.toName[locale]}
                </span>
              )}
              <span className="mt-1 block text-xs text-sc-muted">
                {tr("gateway.localUse")} {alternative.effects.localUseDeltaMinutes >= 0 ? "+" : ""}{alternative.effects.localUseDeltaMinutes}{tr("step1.minutes")}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
