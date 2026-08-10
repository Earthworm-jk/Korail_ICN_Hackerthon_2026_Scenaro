"use client";
/**
 * 역 시설·짐 보관 — 결과 화면 하단 안내 (#24 A5 최소선 · #6 "코레일 실행 지원 정보 표시")
 * - 일정에 등장하는 역의 편의시설 (station-facilities.json 스냅샷, 수록 역만 표시)
 * - 역을 누르면 그 역의 시설과 짐 보관 안내를 팝업 탭으로 본다 (짐 보관은 전 일정 공통)
 */
import { useState } from "react";
import type { StationFacilitiesSnapshotT } from "@/lib/station-facilities";
import type { MessageKey } from "@/lib/i18n/messages";
import { FacilitySummaryIcons, StationFacilityModal } from "./station-facility-modal";

export function ExecutionSupport({ snapshot, stationIds, stationName, tr }: {
  snapshot: StationFacilitiesSnapshotT;
  stationIds: string[];
  stationName: (id: string) => string;
  tr: (key: MessageKey) => string;
}) {
  const facilityOf = new Map(snapshot.stations.map((s) => [s.stationId, s]));
  const covered = stationIds.filter((id) => facilityOf.has(id));
  const hasMissing = covered.length < stationIds.length;

  const [openStationId, setOpenStationId] = useState<string | null>(null);
  const openFacility = openStationId ? facilityOf.get(openStationId) : undefined;

  return (
    <>
      <details className="group rounded-lg border bg-sc-surface">
        <summary className="flex min-h-11 list-none items-center justify-between gap-3 px-3 py-2.5 marker:content-none">
          <span className="min-w-0">
            <strong className="block truncate text-sm font-medium">{tr("support.title")}</strong>
            <span className="block truncate text-xs text-sc-muted">
              {covered.length > 0 ? `${covered.length}/${stationIds.length}` : tr("support.subtitle")}
            </span>
          </span>
          <span aria-hidden className="shrink-0 text-sc-muted transition-transform group-open:rotate-180">⌄</span>
        </summary>

        <div className="border-t px-3 pb-3 pt-2">
          <p className="text-xs text-sc-muted">{tr("support.subtitle")}</p>

          {covered.length === 0 && (
            <div className="mt-2 rounded border bg-sc-subtle/60 p-2.5">
              <h4 className="text-sm font-medium">🧳 {tr("support.luggageTitle")}</h4>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-sc-text/80">
                <li>{tr("support.luggageInTrain")}</li>
                <li>{tr("support.luggageLocker")}</li>
              </ul>
              <p className="mt-1.5 text-[11px] text-sc-muted/70">{tr("support.luggageSource")}</p>
            </div>
          )}

          {stationIds.length > 0 && (
            <div className="mt-2">
              {covered.length > 0 && (
                <ul className="space-y-1">
                  {covered.map((id) => {
                    const f = facilityOf.get(id)!;
                    return (
                      <li key={id}>
                        <button
                          type="button"
                          className="flex w-full items-center justify-between gap-3 rounded border border-sc-line bg-sc-surface px-2.5 py-2 text-left text-sm hover:border-sc-blue"
                          onClick={() => setOpenStationId(id)}
                        >
                          <span className="truncate font-medium">{stationName(id)}</span>
                          <FacilitySummaryIcons facility={f} tr={tr} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {hasMissing && (
                <p className="mt-1.5 text-[11px] text-sc-muted">{tr("support.facilitiesMissing")}</p>
              )}
              {covered.length > 0 && (
                <p className="mt-1.5 text-[11px] text-sc-muted/70">
                  {tr("support.facilitiesSource")} · {snapshot.fetchedAt}
                </p>
              )}
            </div>
          )}
        </div>
      </details>

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
