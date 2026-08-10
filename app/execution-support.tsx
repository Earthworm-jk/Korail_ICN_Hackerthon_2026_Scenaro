"use client";
/**
 * 역 시설·짐 보관 — 일정에 등장하는 역의 시설 요약 + 상세 팝업.
 */
import { useState } from "react";
import { Luggage } from "lucide-react";
import type { StationFacilitiesSnapshotT } from "@/lib/station-facilities";
import type { MessageKey } from "@/lib/i18n/messages";
import { FacilitySummaryIcons, StationFacilityModal } from "./station-facility-modal";
import { StageUtilityPortal } from "./stage-utility-portal";

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
      <StageUtilityPortal>
        <details data-stage-utility="support" className="group rounded-lg border bg-sc-surface">
          <summary className="flex min-h-11 list-none items-center justify-between gap-3 px-3 py-2.5 marker:content-none">
            <span className="min-w-0">
              <strong className="flex items-center gap-1.5 text-sm font-medium">
                <Luggage aria-hidden="true" className="size-4 shrink-0" />
                <span className="truncate">{tr("support.title")}</span>
              </strong>
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
                <h4 className="flex items-center gap-1.5 text-sm font-medium">
                  <Luggage aria-hidden="true" className="size-4 shrink-0" />
                  {tr("support.luggageTitle")}
                </h4>
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
      </StageUtilityPortal>

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
