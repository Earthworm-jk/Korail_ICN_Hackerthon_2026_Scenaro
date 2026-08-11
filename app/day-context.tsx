"use client";

import { useState } from "react";
import { Luggage } from "lucide-react";
import type { StationFacilitiesSnapshotT } from "@/lib/station-facilities";
import type { MessageKey } from "@/lib/i18n/messages";
import { StationFacilityModal } from "./station-facility-modal";

/**
 * DAY 헤더의 그 날 맥락 (#146 2절)
 *
 * 지금 역 시설은 화면 맨 아래 접힌 패널 하나에 **일정 전체의 역이 뭉쳐** 있다.
 * `역 시설 2/3`만 보고는 어느 날 어느 역 이야기인지 알 수 없다.
 *
 * 날짜별로 그 날 거치는 역만 붙여 두면 "이 날 짐을 어디에 맡기지"가 그 자리에서 풀린다.
 * 스냅샷에 없는 역은 애초에 목록에 넣지 않는다 — 눌러 봐야 빈 화면이면 없느니만 못하다.
 */
export function DayStationFacilities({
  snapshot,
  stationIds,
  stationName,
  date,
  tr,
}: {
  snapshot: StationFacilitiesSnapshotT;
  stationIds: string[];
  stationName: (id: string) => string;
  date: string;
  tr: (key: MessageKey) => string;
}) {
  const facilityOf = new Map(snapshot.stations.map((s) => [s.stationId, s]));
  const covered = stationIds.filter((id) => facilityOf.has(id));
  const [openStationId, setOpenStationId] = useState<string | null>(null);
  const openFacility = openStationId ? facilityOf.get(openStationId) : undefined;

  // 그 날 수록된 역이 없으면 배지 자체를 두지 않는다
  if (covered.length === 0) return null;

  const popoverId = `day-facilities-${date}`;

  return (
    <>
      <button
        type="button"
        popoverTarget={popoverId}
        aria-haspopup="dialog"
        aria-controls={popoverId}
        aria-label={tr("step4.dayFacilities").replace("{n}", String(covered.length))}
        className="inline-flex min-h-7 items-center gap-1 rounded-full border border-sc-blue/25 px-2 text-xs text-sc-blue hover:bg-sc-blue-soft"
      >
        <Luggage aria-hidden="true" className="size-3.5" />
        {covered.length}
      </button>

      <div
        id={popoverId}
        popover="auto"
        role="dialog"
        className="m-auto w-[min(320px,calc(100vw-32px))] rounded-xl border bg-sc-surface p-3 text-left shadow-2xl backdrop:bg-black/20"
      >
        <p className="text-sm font-semibold text-sc-text">{tr("support.title")}</p>
        <ul className="mt-2 space-y-1">
          {covered.map((id) => (
            <li key={id}>
              <button
                type="button"
                onClick={() => setOpenStationId(id)}
                className="min-h-9 w-full rounded-lg border px-2 py-1.5 text-left text-sm hover:border-sc-blue"
              >
                {stationName(id)}
              </button>
            </li>
          ))}
        </ul>
      </div>

      {openFacility && (
        <StationFacilityModal
          facility={openFacility}
          stationName={stationName(openFacility.stationId)}
          fetchedAt={snapshot.fetchedAt}
          onClose={() => setOpenStationId(null)}
          tr={tr}
        />
      )}
    </>
  );
}
