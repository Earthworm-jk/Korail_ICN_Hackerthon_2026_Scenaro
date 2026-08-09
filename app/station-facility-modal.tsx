"use client";
/**
 * 역 편의시설 팝업 (#24 A5 실행 지원 개편)
 * - 역을 눌렀을 때 그 역의 시설만 아이콘으로 보여준다 (한 줄 나열 → 역별 상세)
 * - 짐 보관은 역별 데이터가 아니라 전 일정 공통 안내이므로, 같은 팝업의 별도 탭에 두고
 *   "이 역의 보관함 현황"으로 읽히지 않게 문구로 구분한다 (A3)
 * - 스냅샷에 없는 역은 호출부에서 이미 제외한다. 여기서 추정값을 만들지 않는다
 * - 아이콘은 외부 라이브러리 없이 인라인 SVG. 색은 --sc-* 토큰만 사용
 */
import { useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { StationFacilityT } from "@/lib/station-facilities";
import type { MessageKey } from "@/lib/i18n/messages";
import { facilityEntries, type FacilityEntryId } from "@/lib/station-facility-entries";
import { useModalDismiss } from "./use-modal-dismiss";

const ICON_PROPS = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

const ICONS: Record<FacilityEntryId, ReactNode> = {
  elevator: (
    <svg {...ICON_PROPS}><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M12 3v18M8.5 9l-1.5-2-1.5 2M7 15l1.5 2 1.5-2" /></svg>
  ),
  escalator: (
    <svg {...ICON_PROPS}><path d="M4 18h3l8-9h5" /><circle cx="17" cy="6" r="1.6" /><path d="M4 18v-2h3v-3h3v-3h3" /></svg>
  ),
  toilet: (
    <svg {...ICON_PROPS}><circle cx="8" cy="4.5" r="1.8" /><path d="M8 7.5c-1.4 0-2.2.9-2.2 2.2L5 14h1.4l.3 6h2.6l.3-6H11l-.8-4.3C10.2 8.4 9.4 7.5 8 7.5Z" /><circle cx="16.5" cy="4.5" r="1.8" /><path d="M16.5 7.5c-1.5 0-2.4 1-2.4 2.2L13 14.5h1.6l.4 5.5h3l.4-5.5H20l-1.1-4.8c0-1.2-.9-2.2-2.4-2.2Z" /></svg>
  ),
  nursing: (
    <svg {...ICON_PROPS}><path d="M9 3h6l-1 3H10L9 3Z" /><path d="M10 6h4a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3h-4a3 3 0 0 1-3-3V9a3 3 0 0 1 3-3Z" /><path d="M8 12h8M8 15.5h8" /></svg>
  ),
  info: (
    <svg {...ICON_PROPS}><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><circle cx="12" cy="7.8" r="0.9" fill="currentColor" stroke="none" /></svg>
  ),
};

/** 목록 버튼 안 요약 — 있는 시설만 아이콘으로 (한눈에 비교하는 용도) */
export function FacilitySummaryIcons({ facility, tr }: {
  facility: StationFacilityT;
  tr: (key: MessageKey) => string;
}) {
  const available = facilityEntries(facility).filter((entry) => entry.available);
  return (
    <span className="flex items-center gap-1.5">
      {available.map((entry) => (
        // 접근 이름은 아래 sr-only 텍스트가 담당하므로 아이콘 자체는 장식 처리
        <span key={entry.id} className="h-4 w-4 text-sc-blue" title={tr(entry.labelKey)}>{ICONS[entry.id]}</span>
      ))}
      <span className="sr-only">{available.map((entry) => tr(entry.labelKey)).join(", ")}</span>
    </span>
  );
}

type TabId = "facilities" | "luggage";

export function StationFacilityModal({ facility, stationName, fetchedAt, onClose, tr }: {
  facility: StationFacilityT;
  stationName: string;
  fetchedAt: string;
  onClose: () => void;
  tr: (key: MessageKey) => string;
}) {
  const titleId = useId();
  const tabBaseId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<TabId>("facilities");

  // PR #93 리뷰 차단: aria-modal 선언과 실제 동작을 일치시킨다 (구현은 useModalDismiss 공유)
  useModalDismiss(dialogRef, onClose);

  const entries = facilityEntries(facility);
  const tabButton = (id: TabId, labelKey: MessageKey) => (
    <button
      type="button"
      role="tab"
      id={`${tabBaseId}-${id}`}
      aria-selected={tab === id}
      aria-controls={`${tabBaseId}-${id}-panel`}
      className={`rounded px-3 py-1.5 text-sm ${
        tab === id ? "bg-sc-blue text-white" : "border border-sc-line text-sc-text"
      }`}
      onClick={() => setTab(id)}
    >
      {tr(labelKey)}
    </button>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[85vh] w-full max-w-sm overflow-auto rounded-lg bg-sc-surface p-5 shadow-xl"
      >
        <div className="flex items-start justify-between gap-2">
          <h3 id={titleId} className="font-semibold">{stationName}</h3>
          <button
            type="button"
            className="rounded border px-2 py-1 text-sm"
            onClick={onClose}
            aria-label={tr("support.close")}
          >
            ×
          </button>
        </div>

        <div role="tablist" className="mt-3 flex gap-2">
          {tabButton("facilities", "support.facilitiesTab")}
          {tabButton("luggage", "support.luggageTitle")}
        </div>

        {tab === "facilities" ? (
          <div role="tabpanel" id={`${tabBaseId}-facilities-panel`} aria-labelledby={`${tabBaseId}-facilities`}>
            <ul className="mt-3 space-y-2">
              {entries.map((entry) => (
                <li
                  key={entry.id}
                  className={`flex items-center gap-3 rounded border p-2.5 ${
                    entry.available ? "border-sc-line bg-sc-subtle/60" : "border-sc-line/60 opacity-55"
                  }`}
                >
                  <span className={`h-6 w-6 shrink-0 ${entry.available ? "text-sc-blue" : "text-sc-muted"}`}>
                    {ICONS[entry.id]}
                  </span>
                  <span className="flex-1 text-sm">{tr(entry.labelKey)}</span>
                  <span className={`text-sm ${entry.available ? "font-medium text-sc-text" : "text-sc-muted"}`}>
                    {entry.count === null
                      ? tr(entry.available ? "support.facilitiesAvailable" : "support.facilitiesUnavailable")
                      : entry.count}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-sc-muted/70">
              {tr("support.facilitiesSource")} · {fetchedAt}
            </p>
          </div>
        ) : (
          <div role="tabpanel" id={`${tabBaseId}-luggage-panel`} aria-labelledby={`${tabBaseId}-luggage`}>
            {/* 역별 보관함 현황 데이터는 없다 — 전 일정 공통 안내임을 문구로 못 박는다 */}
            <p className="mt-3 rounded border border-sc-line bg-sc-subtle/60 p-2.5 text-xs text-sc-muted">
              {tr("support.luggageCommonNotice")}
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-sc-text/80">
              <li>{tr("support.luggageInTrain")}</li>
              <li>{tr("support.luggageLocker")}</li>
            </ul>
            <p className="mt-3 text-xs text-sc-muted/70">{tr("support.luggageSource")}</p>
          </div>
        )}
      </div>
    </div>
  );
}
