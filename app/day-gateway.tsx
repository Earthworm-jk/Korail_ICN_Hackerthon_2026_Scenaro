"use client";

import { Plane } from "lucide-react";
import type { AirportLeg } from "@/lib/itinerary-rows";
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
  stationName,
  date,
  locale,
  formatTime,
  tr,
}: {
  legs: AirportLeg[];
  stationName: (id: string) => string;
  date: string;
  /** 역 이름이 이미 locale을 따른다 — 노선명만 한국어로 굳으면 한 팝오버에서 언어가 섞인다 */
  locale: Locale;
  formatTime: (iso: string) => string;
  tr: (key: MessageKey) => string;
}) {
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
        {/* 고르는 곳은 여기가 아니라는 것을 밝힌다 — 아니면 왜 못 바꾸는지 찾게 된다 */}
        <p className="mt-2 text-[11px] text-sc-muted/80">{tr("step4.gatewayPickerHint")}</p>
      </div>
    </>
  );
}
