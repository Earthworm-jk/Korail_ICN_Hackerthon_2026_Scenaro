"use client";

import { useRef, useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import { withValues, type MessageKey } from "@/lib/i18n/messages";

/**
 * 전체 후보 보기 (#146 ①)
 *
 * 시트의 가로 줄에는 상위 몇 개만 세운다. 후보가 20-30개인데 한 줄에 다 늘어놓으면
 * 가로로 한참 밀어야 하고, 그건 목록이 아니라 미로다.
 *
 * 대신 **`전체 보기`를 항상 같은 자리에 둔다.** 여행 기간이 2박 3일이든 9박 10일이든,
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
  works,
  station,
  work,
  onStationChange,
  onWorkChange,
  children,
  tr,
}: {
  open: boolean;
  onClose: () => void;
  /** 필터를 통과한 후보 수 */
  count: number;
  stations: { id: string; label: string }[];
  works: { id: string; label: string }[];
  station: string | null;
  work: string | null;
  onStationChange: (id: string | null) => void;
  onWorkChange: (id: string | null) => void;
  children: ReactNode;
  tr: (key: MessageKey) => string;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // 열릴 때 포커스를 안으로 들인다 — 안 그러면 키보드 사용자는 뒤 목록에 갇힌다
  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      data-place-browser
    >
      <div
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
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={tr("common.close")}
            className="grid size-10 shrink-0 place-items-center rounded-full border hover:border-sc-blue"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>

        <div className="flex flex-wrap gap-2 border-b px-4 py-2.5">
          <FilterSelect
            label={tr("step3.filterRegion")}
            value={station}
            options={stations}
            allLabel={tr("step3.filterAll")}
            onChange={onStationChange}
          />
          <FilterSelect
            label={tr("step3.filterContent")}
            value={work}
            options={works}
            allLabel={tr("step3.filterAll")}
            onChange={onWorkChange}
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
