"use client";

import { useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { withValues, type MessageKey } from "@/lib/i18n/messages";
import { useModalDismiss } from "./use-modal-dismiss";

/**
 * 전체 후보 보기 (#146 ①)
 *
 * 미리보기 목록을 거치지 않고 **`전체 촬영지 보기`를 항상 같은 자리에 둔다.**
 * 여행 기간이 2박 3일이든 9박 10일이든,
 * 후보가 8개든 40개든 위치와 라벨이 바뀌지 않는다. 고르는 방법이 데이터 양에 따라
 * 달라지면 사용자는 매번 화면을 다시 배워야 한다.
 *
 * 좁히기는 여기 안에서 한다 — 밖에 필터를 늘어놓으면 시트가 다시 무거워진다.
 */
export function PlaceBrowser({
  open,
  onClose,
  count,
  stations,
  station,
  onStationChange,
  children,
  tr,
}: {
  open: boolean;
  onClose: () => void;
  /** 필터를 통과한 후보 수 */
  count: number;
  stations: { id: string; label: string }[];
  station: string | null;
  onStationChange: (id: string | null) => void;
  children?: ReactNode;
  tr: (key: MessageKey) => string;
}) {
  if (!open) return null;
  return <OpenBrowser {...{
    onClose, count, stations, station, onStationChange, children, tr,
  }} />;
}

/**
 * 열린 상태만 따로 둔다 — 훅은 조건부로 부를 수 없고, `useModalDismiss`는 마운트/언마운트에
 * 포커스 진입과 복귀를 건다. `open` 분기를 훅 안에서 처리하면 닫힌 동안에도 리스너가 산다.
 */
function OpenBrowser({
  onClose,
  count,
  stations,
  station,
  onStationChange,
  children,
  tr,
}: Omit<Parameters<typeof PlaceBrowser>[0], "open">) {
  const dialogRef = useRef<HTMLDivElement>(null);

  /**
   * 포커스 트랩·Esc·닫은 뒤 복귀를 저장소 공통 훅에 맡긴다 (PR #156 리뷰 2).
   * 직접 만들면 Esc만 걸리고 Tab이 뒤 목록으로 새어 나가, `aria-modal="true"`가 거짓말이 된다.
   */
  useModalDismiss(dialogRef, onClose);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      data-place-browser
    >
      <div
        id="place-browser-dialog"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="place-browser-title"
        className="flex max-h-[min(86vh,720px)] w-full max-w-3xl flex-col rounded-2xl border bg-sc-surface shadow-2xl"
      >
        <div className="flex items-start gap-3 border-b px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 id="place-browser-title" className="font-semibold">{tr("step3.browserTitle")}</h2>
            <p className="mt-0.5 text-xs text-sc-muted">
              {withValues(tr("step3.browserCount"), { n: String(count) })}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-sm font-semibold hover:border-sc-blue hover:text-sc-blue"
            data-place-browser-toggle
          >
            <X aria-hidden="true" className="size-4" />
            {tr("step3.closeBrowser")}
          </button>
        </div>

        <div className="flex flex-wrap gap-2 border-b px-4 py-2.5" data-place-browser-filters>
          <FilterSelect
            label={tr("step3.filterRegion")}
            value={station}
            options={stations}
            allLabel={tr("step3.filterAll")}
            onChange={onStationChange}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {count === 0
            ? <p className="text-sm text-sc-muted">{tr("step3.browserEmpty")}</p>
            : (
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
                {children}
              </ul>
            )}
        </div>
      </div>
    </div>
  );
}

function FilterSelect({ label, value, options, allLabel, onChange }: {
  label: string;
  value: string | null;
  options: { id: string; label: string }[];
  allLabel: string;
  onChange: (id: string | null) => void;
}) {
  return (
    <label className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border px-2.5 text-xs">
      <span className="shrink-0 text-sc-muted">{label}</span>
      <select
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value || null)}
        className="min-w-0 max-w-40 border-0 bg-transparent text-sc-text outline-0"
      >
        <option value="">{allLabel}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}
