"use client";
/**
 * 실행 지원 — 결과 화면 하단 안내 (#24 A5 최소선 · #6 "코레일 실행 지원 정보 표시")
 * - 검증된 공항 진입·귀국 이동 안내 각 1개 (공항철도 직통, SOURCES.md 철도 절 근거)
 * - 정적 짐 보관 안내 (KTX 차내 휴대물품보관소 — 실시간·좌석 보장 없음)
 * - 일정에 등장하는 역의 편의시설 (station-facilities.json 스냅샷, 수록 역만 표시)
 */
import type { StationFacilitiesSnapshotT } from "@/lib/station-facilities";
import type { MessageKey } from "@/lib/i18n/messages";

export function ExecutionSupport({ snapshot, stationIds, stationName, tr }: {
  snapshot: StationFacilitiesSnapshotT;
  stationIds: string[]; // 표시 중인 일정에 등장하는 역 (등장 순서 유지·중복 제거는 호출부)
  stationName: (id: string) => string;
  tr: (key: MessageKey) => string;
}) {
  const facilityOf = new Map(snapshot.stations.map((s) => [s.stationId, s]));
  const covered = stationIds.filter((id) => facilityOf.has(id));
  const hasMissing = covered.length < stationIds.length;

  const boolLabel = (has: boolean, key: MessageKey) =>
    `${tr(key)} ${has ? "○" : "—"}`;

  return (
    <div className="rounded-lg border p-4">
      <h3 className="font-medium">{tr("support.title")}</h3>
      <p className="mt-0.5 text-xs text-gray-500">{tr("support.subtitle")}</p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded border bg-gray-50/50 p-3">
          <h4 className="text-sm font-medium">✈️ {tr("support.arrivalTitle")}</h4>
          <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-sm text-gray-700">
            <li>{tr("support.arrivalStep1")}</li>
            <li>{tr("support.arrivalStep2")}</li>
            <li>{tr("support.arrivalStep3")}</li>
          </ol>
          <p className="mt-1.5 text-xs text-gray-400">{tr("support.arexSource")}</p>
        </div>

        <div className="rounded border bg-gray-50/50 p-3">
          <h4 className="text-sm font-medium">🛫 {tr("support.returnTitle")}</h4>
          <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-sm text-gray-700">
            <li>{tr("support.returnStep1")}</li>
            <li>{tr("support.returnStep2")}</li>
            <li>{tr("support.returnStep3")}</li>
          </ol>
          <p className="mt-1.5 text-xs text-gray-400">{tr("support.arexSource")}</p>
        </div>
      </div>

      <div className="mt-3 rounded border bg-gray-50/50 p-3">
        <h4 className="text-sm font-medium">🧳 {tr("support.luggageTitle")}</h4>
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-gray-700">
          <li>{tr("support.luggageInTrain")}</li>
          <li>{tr("support.luggageLocker")}</li>
        </ul>
        <p className="mt-1.5 text-xs text-gray-400">{tr("support.luggageSource")}</p>
      </div>

      {covered.length > 0 && (
        <div className="mt-3 rounded border bg-gray-50/50 p-3">
          <h4 className="text-sm font-medium">🛗 {tr("support.facilitiesTitle")}</h4>
          <ul className="mt-1 space-y-1 text-sm text-gray-700">
            {covered.map((id) => {
              const f = facilityOf.get(id)!;
              return (
                <li key={id}>
                  <span className="font-medium">{stationName(id)}</span>
                  <span className="ml-2 text-gray-600">
                    {tr("support.facilitiesElevator")} {f.elevatorCount} ·{" "}
                    {tr("support.facilitiesEscalator")} {f.escalatorCount} ·{" "}
                    {boolLabel(f.hasToilet, "support.facilitiesToilet")} ·{" "}
                    {boolLabel(f.hasNursingRoom, "support.facilitiesNursing")} ·{" "}
                    {boolLabel(f.hasInfoCenter, "support.facilitiesInfo")}
                  </span>
                </li>
              );
            })}
          </ul>
          {hasMissing && (
            <p className="mt-1.5 text-xs text-gray-500">{tr("support.facilitiesMissing")}</p>
          )}
          <p className="mt-1.5 text-xs text-gray-400">
            {tr("support.facilitiesSource")} · {snapshot.fetchedAt}
          </p>
        </div>
      )}
    </div>
  );
}
