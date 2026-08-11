"use client";

import { useRef, useState } from "react";
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
 *
 * 거치는 역의 기준은 `stationIdsOf`가 단독으로 정한다. 실행 지원 패널과 같은 함수라
 * 같은 날에 대해 두 화면이 다른 역을 말할 수 없다.
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
  const popoverRef = useRef<HTMLDivElement>(null);
  const openFacility = openStationId ? facilityOf.get(openStationId) : undefined;

  // 그 날 수록된 역이 없으면 배지 자체를 두지 않는다
  if (covered.length === 0) return null;

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
        <ul className="mt-2 space-y-1">
          {covered.map((id) => (
            <li key={id}>
              <button
                type="button"
                onClick={() => openFacilityModal(id)}
                className="min-h-11 w-full rounded-lg border px-3 text-left text-sm hover:border-sc-blue"
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
