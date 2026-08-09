"use client";
/**
 * 역 시설·짐 보관 — 결과 화면 하단 안내 (#24 A5 최소선 · #6 "코레일 실행 지원 정보 표시")
 * - 일정에 등장하는 역의 편의시설 (station-facilities.json 스냅샷, 수록 역만 표시)
 * - 역을 누르면 그 역의 시설과 짐 보관 안내를 팝업 탭으로 본다 (짐 보관은 전 일정 공통)
 *
 * 공항 진입·귀국 이동 안내는 이 카드에 없다. 전부 옮긴 것이 아니라 셋으로 갈렸다.
 * - 중복이던 소요시간·출처: 일정의 열차 줄 팝업(TrainLegModal)으로 **이동**
 * - 탑승 위치·3단계 상세 안내: 결과 화면에 필요한 정보가 아니라 **제거** (요구사항 3)
 * - 서울역 환승 동선: **#101**의 환승 대기 표시가 담당
 * 카드 이름도 남은 내용에 맞춰 바꿨다("실행 지원"이 무엇을 하는 곳인지 말하지 않았다).
 */
import { useState } from "react";
import type { StationFacilitiesSnapshotT } from "@/lib/station-facilities";
import type { MessageKey } from "@/lib/i18n/messages";
import { FacilitySummaryIcons, StationFacilityModal } from "./station-facility-modal";

export function ExecutionSupport({ snapshot, stationIds, stationName, tr }: {
  snapshot: StationFacilitiesSnapshotT;
  stationIds: string[]; // 표시 중인 일정에 등장하는 역 (등장 순서 유지·중복 제거는 호출부)
  stationName: (id: string) => string;
  tr: (key: MessageKey) => string;
}) {
  const facilityOf = new Map(snapshot.stations.map((s) => [s.stationId, s]));
  const covered = stationIds.filter((id) => facilityOf.has(id));
  const hasMissing = covered.length < stationIds.length;

  // 역별 상세는 팝업으로만 — 목록에는 있는 시설 아이콘 요약만 둔다
  const [openStationId, setOpenStationId] = useState<string | null>(null);
  const openFacility = openStationId ? facilityOf.get(openStationId) : undefined;

  return (
    <div className="rounded-lg border p-4">
      <h3 className="font-medium">{tr("support.title")}</h3>
      <p className="mt-0.5 text-xs text-sc-muted">{tr("support.subtitle")}</p>

      {/* 짐 보관은 역 팝업의 탭으로 옮겼다. 수록 역이 하나도 없어 팝업 경로가 없을 때만
          여기에 그대로 남겨 안내가 사라지지 않게 한다. */}
      {covered.length === 0 && (
        <div className="mt-3 rounded border bg-sc-subtle/60 p-3">
          <h4 className="text-sm font-medium">🧳 {tr("support.luggageTitle")}</h4>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-sc-text/80">
            <li>{tr("support.luggageInTrain")}</li>
            <li>{tr("support.luggageLocker")}</li>
          </ul>
          <p className="mt-1.5 text-xs text-sc-muted/70">{tr("support.luggageSource")}</p>
        </div>
      )}

      {/* PR #59 리뷰 비차단 — 전부 미수록이어도 블록을 유지해 '미확보' 상태를 명시한다 */}
      {stationIds.length > 0 && (
        <div className="mt-3 rounded border bg-sc-subtle/60 p-3">
          <h4 className="text-sm font-medium">🛗 {tr("support.facilitiesTitle")}</h4>
          {covered.length > 0 && (
            <>
              <p className="mt-1 text-xs text-sc-muted">{tr("support.facilitiesHint")}</p>
              <ul className="mt-1.5 space-y-1">
                {covered.map((id) => {
                  const f = facilityOf.get(id)!;
                  return (
                    <li key={id}>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-3 rounded border border-sc-line bg-sc-surface px-3 py-2 text-left text-sm hover:border-sc-blue"
                        onClick={() => setOpenStationId(id)}
                      >
                        <span className="font-medium">{stationName(id)}</span>
                        <FacilitySummaryIcons facility={f} tr={tr} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {hasMissing && (
            <p className="mt-1.5 text-xs text-sc-muted">{tr("support.facilitiesMissing")}</p>
          )}
          {covered.length > 0 && (
            <p className="mt-1.5 text-xs text-sc-muted/70">
              {tr("support.facilitiesSource")} · {snapshot.fetchedAt}
            </p>
          )}
        </div>
      )}

      {openFacility && (
        <StationFacilityModal
          facility={openFacility}
          stationName={stationName(openFacility.stationId)}
          fetchedAt={snapshot.fetchedAt}
          onClose={() => setOpenStationId(null)}
          tr={tr}
        />
      )}
    </div>
  );
}
