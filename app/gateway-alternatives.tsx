"use client";

import { BusFront, TrainFront } from "lucide-react";
import type { GatewayAlternative } from "@/lib/engine/types";
import type { Locale, MessageKey } from "@/lib/i18n/messages";
import { useRef } from "react";

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
  const popoverRef = useRef<HTMLDivElement>(null);
  if (alternatives.length === 0) return null;
  const selected = selectedId === null
    ? tr("gateway.railTitle")
    : alternatives.find((alternative) => alternative.id === selectedId)?.serviceName[locale] ?? tr("gateway.title");
  const SelectedIcon = selectedId === null ? TrainFront : BusFront;

  return (
    <>
      {/*
        시트 헤더의 칩 (#146 — 바닥 고정 독 제거).
        헤더는 이미 여행 전체 단위 상태(선택·일정 반영·미배치, 분류)를 모으는 자리다.
        공항 진입도 여행 전체 단위 선택이라 같은 줄에 선다. 테마체험 칩과 같은 모양이라
        세 컨트롤을 하나로 읽을 수 있다.
      */}
      <button
        type="button"
        popoverTarget="gateway-picker"
        aria-haspopup="dialog"
        aria-controls="gateway-picker"
        className="inline-flex items-center gap-1.5 rounded-full border border-sc-blue/30 px-2 py-0.5 text-sc-blue hover:bg-sc-blue-soft"
      >
        <SelectedIcon aria-hidden="true" className="size-3.5 shrink-0" />
        {selected}
      </button>

      <div
        ref={popoverRef}
        id="gateway-picker"
        popover="auto"
        role="dialog"
        aria-labelledby="gateway-picker-title"
        className="m-auto w-[min(560px,calc(100vw-32px))] rounded-xl border bg-sc-surface p-3 text-left shadow-2xl backdrop:bg-black/20"
      >
        <p id="gateway-picker-title" className="flex items-center gap-1.5 text-sm font-semibold">
          <BusFront aria-hidden="true" className="size-4 shrink-0" />
          {tr("gateway.dockTitle")}
        </p>
        <div className="pt-2">
          <p className="text-xs text-sc-muted">{tr("gateway.subtitle")}</p>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            <button
              className={`rounded border p-2.5 text-left text-sm ${selectedId === null ? "border-sc-blue bg-white" : "bg-white/70"}`}
              aria-pressed={selectedId === null}
              onClick={() => { popoverRef.current?.hidePopover(); onSelect(null); }}
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
                  onClick={() => { popoverRef.current?.hidePopover(); onSelect(alternative); }}
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
      </div>
    </>
  );
}
