"use client";

import { useRef, useState } from "react";
import { Luggage } from "lucide-react";
import type { StationFacilitiesSnapshotT } from "@/lib/station-facilities";
import type { MessageKey } from "@/lib/i18n/messages";
import { FacilitySummaryIcons, StationFacilityModal } from "./station-facility-modal";

/**
 * DAY 헤더의 그 날 맥락 (#146 2절)
 *
 * 지금 역 시설은 화면 맨 아래 접힌 패널 하나에 **일정 전체의 역이 뭉쳐** 있다.
 * `역 시설 2/3`만 보고는 어느 날 어느 역 이야기인지 알 수 없다.
 *
 * 날짜별로 그 날 거치는 역만 붙여 두면 "이 날 짐을 어디에 맡기지"가 그 자리에서 풀린다.
 * 스냅샷에 없는 역은 목록에 넣지 않되 **몇 곳이 빠졌는지는 밝힌다** — 조용히 빼면
 * 사용자는 그 역에 시설이 없다고 읽는다. 확보되지 않은 것과 없는 것은 다르다.
 *
 * 하단 독의 `support` 카드를 대체한다(#146). 그 카드가 갖고 있던 미수록 고지·출처
 * 표기·짐 보관 안내를 여기로 옮겼다. #155에서는 "수록된 역이 없으면 배지를 두지
 * 않는다"였는데, 이제는 그 자리에 짐 보관 안내가 들어가므로 빈 화면이 아니다.
 *
 * 거치는 역의 기준은 `stationIdsOf`가 단독으로 정한다.
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
  const missingCount = stationIds.length - covered.length;
  const [openStationId, setOpenStationId] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const openFacility = openStationId ? facilityOf.get(openStationId) : undefined;

  // 그 날 거치는 역이 아예 없으면 할 말이 없다
  if (stationIds.length === 0) return null;

  const popoverId = `day-facilities-${date}`;
  const titleId = `${popoverId}-title`;

  /**
   * 목록을 먼저 닫고 모달을 연다 (PR #155 리뷰 2).
   *
   * `popover="auto"`는 **내부 클릭으로는 닫히지 않고** top layer에 남는다. 반면
   * `StationFacilityModal`은 네이티브 `<dialog>`가 아니라 문서 안의 `fixed`라, 목록이
   * z-index와 무관하게 모달 위에 계속 그려진다. 레이어가 다르니 z-index로는 못 이긴다.
   */
  function openFacilityModal(id: string) {
    popoverRef.current?.hidePopover();
    setOpenStationId(id);
  }

  return (
    <>
      <button
        type="button"
        popoverTarget={popoverId}
        aria-haspopup="dialog"
        aria-controls={popoverId}
        aria-label={tr("step4.dayFacilities").replace("{n}", String(covered.length))}
        className="inline-flex min-h-10 items-center gap-1 rounded-full border border-sc-blue/25 px-3 text-xs text-sc-blue hover:bg-sc-blue-soft"
      >
        <Luggage aria-hidden="true" className="size-4" />
        {covered.length}
      </button>

      <div
        ref={popoverRef}
        id={popoverId}
        popover="auto"
        role="dialog"
        aria-labelledby={titleId}
        className="m-auto w-[min(320px,calc(100vw-32px))] rounded-xl border bg-sc-surface p-3 text-left shadow-2xl backdrop:bg-black/20"
      >
        <p id={titleId} className="text-sm font-semibold text-sc-text">{tr("support.title")}</p>

        {covered.length > 0 ? (
          <>
            <ul className="mt-2 space-y-1">
              {covered.map((id) => (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => openFacilityModal(id)}
                    className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border px-3 text-left text-sm hover:border-sc-blue"
                  >
                    <span className="truncate">{stationName(id)}</span>
                    <FacilitySummaryIcons facility={facilityOf.get(id)!} tr={tr} />
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-sc-muted/70">
              {tr("support.facilitiesSource")} · {snapshot.fetchedAt}
            </p>
          </>
        ) : (
          /* 수록된 역이 하나도 없어도 할 수 있는 일은 있다 — 독 카드에 있던 안내다 */
          <div className="mt-2 rounded-lg border bg-sc-subtle/60 p-2.5">
            <h4 className="text-sm font-medium">{tr("support.luggageTitle")}</h4>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-sc-text/80">
              <li>{tr("support.luggageInTrain")}</li>
              <li>{tr("support.luggageLocker")}</li>
            </ul>
            <p className="mt-1.5 text-[11px] text-sc-muted/70">{tr("support.luggageSource")}</p>
          </div>
        )}

        {/* 조용히 빼면 "시설이 없다"로 읽힌다 — 확보되지 않은 것과 없는 것은 다르다 */}
        {missingCount > 0 && (
          <p className="mt-2 text-[11px] text-sc-muted">{tr("support.facilitiesMissing")}</p>
        )}
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
