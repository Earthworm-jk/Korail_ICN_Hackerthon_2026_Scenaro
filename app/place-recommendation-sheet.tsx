"use client";

import { useState, type ReactNode } from "react";
import type { MessageKey } from "@/lib/i18n/messages";
import styles from "./place-recommendation-sheet.module.css";

type Translator = (key: MessageKey) => string;

export function PlaceRecommendationSheet({
  selectedCount,
  totalCount,
  updating,
  updated,
  sortBy,
  onSortChange,
  children,
  remainingCount,
  onShowMore,
  map,
  onBack,
  tr,
}: {
  selectedCount: number;
  totalCount: number;
  updating: boolean;
  updated: boolean;
  sortBy: "relevance" | "official";
  onSortChange: (sort: "relevance" | "official") => void;
  children?: ReactNode;
  remainingCount: number;
  onShowMore: () => void;
  map: ReactNode;
  onBack: () => void;
  tr: Translator;
}) {
  const [expanded, setExpanded] = useState(true);
  const status = updating
    ? tr("step3.routeUpdating")
    : updated
      ? tr("step3.routeUpdated")
      : tr("step3.selectedCount")
          .replace("{selected}", String(selectedCount))
          .replace("{total}", String(totalCount));

  return (
    <div
      className={styles.sheet}
      id="place-picker"
      data-place-sheet
      data-sheet-expanded={expanded ? "true" : "false"}
    >
      <div className={styles.header} data-place-sheet-header>
        <span className={styles.handle} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <h3 className="font-semibold">{tr("step3.sheetTitle")}</h3>
            <span className="text-xs text-sc-muted" role="status" aria-live="polite">
              {status}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-sc-muted">{tr("step3.sheetSubtitle")}</p>
        </div>
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={expanded}
          aria-controls="place-sheet-body"
          onClick={() => setExpanded((open) => !open)}
        >
          {tr(expanded ? "step3.sheetCollapse" : "step3.sheetExpand")}
        </button>
      </div>

      {expanded && (
        <div className={styles.body} id="place-sheet-body" data-place-sheet-body>
          <div className={styles.controls} data-place-sheet-controls>
            {(["relevance", "official"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                className={sortBy === mode ? styles.activeSort : styles.sort}
                aria-pressed={sortBy === mode}
                onClick={() => onSortChange(mode)}
              >
                {tr(mode === "relevance" ? "step3.sortRelevance" : "step3.sortOfficial")}
              </button>
            ))}
          </div>

          <ul className={styles.list} data-place-sheet-list>
            {children}
          </ul>

          {remainingCount > 0 && (
            <button type="button" className={styles.more} onClick={onShowMore}>
              {tr("step3.showMore").replace("{n}", String(remainingCount))}
            </button>
          )}

          <details className={styles.fallbackMap}>
            <summary>{tr("map.placesTitle")}</summary>
            <div>{map}</div>
          </details>
        </div>
      )}

      <div className="mt-4" data-place-sheet-back>
        <button type="button" className="rounded border px-4 py-2 text-sm" onClick={onBack}>
          {tr("common.back")}
        </button>
      </div>
    </div>
  );
}

export function PlaceThumbnail({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <div
      className={styles.thumbnail}
      data-place-thumbnail
      aria-label={label}
      role="img"
    >
      <span className={styles.thumbnailAdornment} aria-hidden>{children}</span>
      <span className={styles.thumbnailLabel}>{label}</span>
    </div>
  );
}
