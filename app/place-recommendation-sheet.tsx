"use client";

import Image from "next/image";
import { ArrowUpDown } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { MessageKey } from "@/lib/i18n/messages";
import type { PlacePhoto } from "@/lib/place-photos";
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
  routeRecommendations,
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
  routeRecommendations?: ReactNode;
  remainingCount: number;
  onShowMore: () => void;
  map: ReactNode;
  onBack: () => void;
  tr: Translator;
}) {
  const [expanded, setExpanded] = useState(true);
  const selectedCountLabel = tr("step3.selectedCount")
    .replace("{selected}", String(selectedCount))
    .replace("{total}", String(totalCount));
  const routeStatus = updating
    ? tr("step3.routeUpdating")
    : updated
      ? tr("step3.routeUpdated")
      : null;

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
            <span className="text-xs text-sc-muted">{selectedCountLabel}</span>
            {routeStatus && (
              <span className="text-xs text-sc-muted" role="status" aria-live="polite">
                {routeStatus}
              </span>
            )}
          </div>
        </div>
        <label className={styles.sortControl}>
          <ArrowUpDown aria-hidden="true" className="size-4 shrink-0" />
          <span className="sr-only">{tr("step3.sortLabel")}</span>
          <select
            aria-label={tr("step3.sortLabel")}
            value={sortBy}
            onPointerDown={(event) => {
              event.currentTarget.dataset.pointerFocus = "true";
            }}
            onKeyDown={(event) => {
              delete event.currentTarget.dataset.pointerFocus;
            }}
            onBlur={(event) => {
              delete event.currentTarget.dataset.pointerFocus;
            }}
            onChange={(event) => onSortChange(event.target.value as "relevance" | "official")}
          >
            <option value="relevance">{tr("step3.sortRelevance")}</option>
            <option value="official">{tr("step3.sortOfficial")}</option>
          </select>
        </label>
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
          {routeRecommendations && (
            <section
              className="mb-3 rounded-xl border border-sc-blue/30 bg-sc-blue-soft/70 p-3"
              aria-labelledby="route-recommendation-title"
              data-route-recommendations
            >
              <h4 id="route-recommendation-title" className="text-sm font-semibold text-sc-blue">
                {tr("ai.recommendSheetTitle")}
              </h4>
              <p className="mt-1 text-xs text-sc-muted">{tr("ai.recommendSheetSubtitle")}</p>
              <ul className="mt-2 space-y-2">{routeRecommendations}</ul>
            </section>
          )}
          <ul className={styles.list} data-place-sheet-list>
            {children}
            {remainingCount > 0 && (
              <li className={styles.moreItem} data-place-sheet-more>
                <button type="button" className={styles.more} onClick={onShowMore}>
                  {tr("step3.showMore").replace("{n}", String(remainingCount))}
                </button>
              </li>
            )}
          </ul>

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

export function PlaceThumbnail({
  label,
  children,
  photo,
  locale = "ko",
}: {
  label: string;
  children?: ReactNode;
  photo?: PlacePhoto | null;
  locale?: "ko" | "en";
}) {
  if (photo) {
    return (
      <figure className={styles.thumbnail} data-place-thumbnail data-place-photo>
        <Image
          src={photo.src}
          alt={photo.alt[locale]}
          fill
          sizes="82px"
          unoptimized
          className={styles.thumbnailImage}
        />
        <a
          href={photo.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className={styles.thumbnailAttribution}
          title={`${photo.provider} · ${photo.license}`}
          aria-label={
            locale === "ko"
              ? `${photo.sourcePlaceName} 사진 원본 · ${photo.provider} · ${photo.license}`
              : `Original ${photo.sourcePlaceName} photo · Korea Tourism Organization TourAPI · KOGL Type 1`
          }
        >
          KTO · KOGL 1
        </a>
      </figure>
    );
  }

  return (
    <div
      className={styles.thumbnail}
      data-place-thumbnail
      aria-label={label}
      role="img"
    >
      <span className={styles.thumbnailAdornment} aria-hidden>{children}</span>
    </div>
  );
}
