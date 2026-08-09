"use client";
/**
 * 역 편의시설 팝업 (#24 A5 실행 지원 개편)
 * - 역을 눌렀을 때 그 역의 시설만 아이콘으로 보여준다 (한 줄 나열 → 역별 상세)
 * - 스냅샷에 없는 역은 호출부에서 이미 제외한다. 여기서 추정값을 만들지 않는다 (A3)
 * - 아이콘은 외부 라이브러리 없이 인라인 SVG. 색은 --sc-* 토큰만 사용
 */
import { useEffect, useId } from "react";
import type { ReactNode } from "react";
import type { StationFacilityT } from "@/lib/station-facilities";
import type { MessageKey } from "@/lib/i18n/messages";

const ICON_PROPS = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

const ElevatorIcon = () => (
  <svg {...ICON_PROPS}><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M12 3v18M8.5 9l-1.5-2-1.5 2M7 15l1.5 2 1.5-2" /></svg>
);
const EscalatorIcon = () => (
  <svg {...ICON_PROPS}><path d="M4 18h3l8-9h5" /><circle cx="17" cy="6" r="1.6" /><path d="M4 18v-2h3v-3h3v-3h3" /></svg>
);
const ToiletIcon = () => (
  <svg {...ICON_PROPS}><circle cx="8" cy="4.5" r="1.8" /><path d="M8 7.5c-1.4 0-2.2.9-2.2 2.2L5 14h1.4l.3 6h2.6l.3-6H11l-.8-4.3C10.2 8.4 9.4 7.5 8 7.5Z" /><circle cx="16.5" cy="4.5" r="1.8" /><path d="M16.5 7.5c-1.5 0-2.4 1-2.4 2.2L13 14.5h1.6l.4 5.5h3l.4-5.5H20l-1.1-4.8c0-1.2-.9-2.2-2.4-2.2Z" /></svg>
);
const NursingIcon = () => (
  <svg {...ICON_PROPS}><path d="M9 3h6l-1 3H10L9 3Z" /><path d="M10 6h4a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3h-4a3 3 0 0 1-3-3V9a3 3 0 0 1 3-3Z" /><path d="M8 12h8M8 15.5h8" /></svg>
);
const InfoIcon = () => (
  <svg {...ICON_PROPS}><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><circle cx="12" cy="7.8" r="0.9" fill="currentColor" stroke="none" /></svg>
);

type FacilityEntry = {
  id: string;
  labelKey: MessageKey;
  icon: ReactNode;
  available: boolean;
  count: number | null; // 수량이 있는 시설만 숫자, 나머지는 null
};

/**
 * 표시 순서 고정 — 수량형 2종 뒤 유무형 3종.
 * 수량 0은 원천이 "설치 없음"으로 준 값이므로 없음으로 취급하고 0을 그대로 보여준다.
 */
export function facilityEntries(facility: StationFacilityT): FacilityEntry[] {
  return [
    {
      id: "elevator",
      labelKey: "support.facilitiesElevator",
      icon: <ElevatorIcon />,
      available: facility.elevatorCount > 0,
      count: facility.elevatorCount,
    },
    {
      id: "escalator",
      labelKey: "support.facilitiesEscalator",
      icon: <EscalatorIcon />,
      available: facility.escalatorCount > 0,
      count: facility.escalatorCount,
    },
    { id: "toilet", labelKey: "support.facilitiesToilet", icon: <ToiletIcon />, available: facility.hasToilet, count: null },
    { id: "nursing", labelKey: "support.facilitiesNursing", icon: <NursingIcon />, available: facility.hasNursingRoom, count: null },
    { id: "info", labelKey: "support.facilitiesInfo", icon: <InfoIcon />, available: facility.hasInfoCenter, count: null },
  ];
}

/** 목록 버튼 안 요약 — 있는 시설만 아이콘으로 (한눈에 비교하는 용도) */
export function FacilitySummaryIcons({ facility, tr }: {
  facility: StationFacilityT;
  tr: (key: MessageKey) => string;
}) {
  const available = facilityEntries(facility).filter((entry) => entry.available);
  return (
    <span className="flex items-center gap-1.5">
      {available.map((entry) => (
        // 버튼 접근 이름은 역 이름 + 아래 sr-only 텍스트로 충분하므로 아이콘 자체는 장식 처리
        <span key={entry.id} className="h-4 w-4 text-sc-blue" title={tr(entry.labelKey)}>{entry.icon}</span>
      ))}
      <span className="sr-only">
        {available.map((entry) => tr(entry.labelKey)).join(", ")}
      </span>
    </span>
  );
}

export function StationFacilityModal({ facility, stationName, fetchedAt, onClose, tr }: {
  facility: StationFacilityT;
  stationName: string;
  fetchedAt: string;
  onClose: () => void;
  tr: (key: MessageKey) => string;
}) {
  const titleId = useId();
  // 키보드만 쓰는 사용자도 닫을 수 있어야 한다 (기존 모달에는 없던 처리 — PR 본문 참고)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const entries = facilityEntries(facility);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[85vh] w-full max-w-sm overflow-auto rounded-lg bg-sc-surface p-5 shadow-xl"
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 id={titleId} className="font-semibold">{stationName}</h3>
            <p className="mt-0.5 text-sm text-sc-muted">{tr("support.facilitiesTitle")}</p>
          </div>
          <button
            type="button"
            className="rounded border px-2 py-1 text-sm"
            onClick={onClose}
            aria-label={tr("support.close")}
          >
            ×
          </button>
        </div>

        <ul className="mt-4 space-y-2">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className={`flex items-center gap-3 rounded border p-2.5 ${
                entry.available ? "border-sc-line bg-sc-subtle/60" : "border-sc-line/60 opacity-55"
              }`}
            >
              <span className={`h-6 w-6 shrink-0 ${entry.available ? "text-sc-blue" : "text-sc-muted"}`}>
                {entry.icon}
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
    </div>
  );
}
