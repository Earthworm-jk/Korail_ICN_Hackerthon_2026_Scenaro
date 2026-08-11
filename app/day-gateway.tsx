"use client";

import { useRef } from "react";
import { Plane } from "lucide-react";
import type { AirportLeg } from "@/lib/itinerary-rows";
import type { GatewayAlternative } from "@/lib/engine/types";
import { withValues, type Locale, type MessageKey } from "@/lib/i18n/messages";

/**
 * DAY 헤더의 공항 진입 조회 (#146)
 *
 * 지금 공항 진입 정보는 화면 맨 아래 독 카드 하나에 여행 전체가 뭉쳐 있다. `서울역 경유`만
 * 보고는 그게 며칠째 이야기인지 알 수 없다. 역 시설과 같은 이유로 날짜 옆에 붙인다.
 *
 * **선택기가 아니다.** 공항철도↔버스를 고르는 것은 독의 `gateway` 카드가 계속 맡는다
 * (`c52f612`에서 그리로 옮긴 배치다). 여기는 "이 날 공항을 어떻게 드나드는가"만 보여준다.
 * 같은 상태를 고치는 컨트롤이 둘이면 어느 쪽이 참인지 알 수 없다.
 *
 * 공항 진입은 여행 전체에 걸리는 정보라 매일 있지 않다 — 왕복이면 첫날과 마지막날에만
 * 나온다. 구간이 없는 날에는 아이콘을 두지 않는다.
 */
export function DayGatewayInfo({
  legs,
  alternatives,
  selectedId,
  onSelect,
  stationName,
  date,
  locale,
  formatTime,
  tr,
}: {
  legs: AirportLeg[];
  /** 고를 수 있는 버스 대안. 비어 있으면 선택할 것이 없어 조회만 남는다 */
  alternatives: GatewayAlternative[];
  selectedId: string | null;
  onSelect: (alternative: GatewayAlternative | null) => void;
  stationName: (id: string) => string;
  date: string;
  /** 역 이름이 이미 locale을 따른다 — 노선명만 한국어로 굳으면 한 팝오버에서 언어가 섞인다 */
  locale: Locale;
  formatTime: (iso: string) => string;
  tr: (key: MessageKey) => string;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);

  // 그 날 공항 구간이 없으면 아이콘 자체를 두지 않는다
  if (legs.length === 0) return null;

  const popoverId = `day-gateway-${date}`;
  const titleId = `${popoverId}-title`;

  return (
    <>
      <button
        type="button"
        popoverTarget={popoverId}
        aria-haspopup="dialog"
        aria-controls={popoverId}
        aria-label={withValues(tr("step4.dayGateway"), { n: String(legs.length) })}
        className="inline-flex min-h-10 items-center gap-1 rounded-full border border-sc-blue/25 px-3 text-xs text-sc-blue hover:bg-sc-blue-soft"
      >
        <Plane aria-hidden="true" className="size-4" />
        {legs.length}
      </button>

      <div
        ref={popoverRef}
        id={popoverId}
        popover="auto"
        role="dialog"
        aria-labelledby={titleId}
        className="m-auto w-[min(340px,calc(100vw-32px))] rounded-xl border bg-sc-surface p-3 text-left shadow-2xl backdrop:bg-black/20"
      >
        <p id={titleId} className="text-sm font-semibold text-sc-text">{tr("gateway.dockTitle")}</p>
        <ul className="mt-2 space-y-2">
          {legs.map((leg) => (
            <li key={`${leg.serviceName.ko}-${leg.departAt}`} className="rounded-lg border px-3 py-2">
              <p className="flex items-center gap-1.5 text-sm font-medium text-sc-text">
                {tr(leg.direction === "to_airport" ? "step4.gatewayToAirport" : "step4.gatewayFromAirport")}
              </p>
              <p className="mt-0.5 text-sm text-sc-text/80">
                {stationName(leg.fromStationId)} → {stationName(leg.toStationId)}
              </p>
              <p className="mt-0.5 text-xs text-sc-muted">
                {formatTime(leg.departAt)} – {formatTime(leg.arriveAt)}
                {" · "}
                {tr(leg.kind === "rail" ? "step4.gatewayRail" : "step4.gatewayBus")}
                {" "}{leg.serviceName[locale]}
              </p>
            </li>
          ))}
        </ul>
        {/*
          선택도 여기서 한다 (#146).
          공항 진입 정보는 이 아이콘 하나로 모은다 — 조회와 선택이 갈라져 있으면
          "왜 여기선 못 바꾸지"를 찾아 헤매게 된다. 고를 대안이 없으면 이 절은 없다.
        */}
        {alternatives.length > 0 && (
          <div className="mt-3 border-t pt-2">
            <p className="text-xs font-medium text-sc-text">{tr("gateway.title")}</p>
            <p className="mt-0.5 text-[11px] text-sc-muted">{tr("gateway.subtitle")}</p>
            <div className="mt-2 space-y-1.5">
              <button
                type="button"
                aria-pressed={selectedId === null}
                onClick={() => { popoverRef.current?.hidePopover(); onSelect(null); }}
                className={`min-h-11 w-full rounded-lg border px-3 py-1.5 text-left text-sm ${
                  selectedId === null ? "border-sc-blue bg-sc-blue-soft" : "hover:border-sc-blue"
                }`}
              >
                {tr("gateway.railTitle")}
              </button>
              {alternatives.map((alternative) => (
                <button
                  key={alternative.id}
                  type="button"
                  aria-pressed={selectedId === alternative.id}
                  onClick={() => { popoverRef.current?.hidePopover(); onSelect(alternative); }}
                  className={`min-h-11 w-full rounded-lg border px-3 py-1.5 text-left text-sm ${
                    selectedId === alternative.id ? "border-sc-blue bg-sc-blue-soft" : "hover:border-sc-blue"
                  }`}
                >
                  <span className="block">{alternative.serviceName[locale]}</span>
                  <span className="mt-0.5 block text-[11px] text-sc-muted">
                    {tr("gateway.localUse")} {alternative.effects.localUseDeltaMinutes >= 0 ? "+" : ""}
                    {alternative.effects.localUseDeltaMinutes}{tr("step1.minutes")}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
