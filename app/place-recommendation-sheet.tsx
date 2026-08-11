"use client";

import Image from "next/image";
import { ArrowUpDown } from "lucide-react";
import { useState, type ReactNode } from "react";
import { withValues, type MessageKey } from "@/lib/i18n/messages";
import type { PlacePhoto } from "@/lib/place-photos";
import styles from "./place-recommendation-sheet.module.css";

type Translator = (key: MessageKey) => string;

export function PlaceRecommendationSheet({
  selectedCount,
  totalCount,
  placedCount,
  unplacedCount,
  themeState,
  themeChip,
  updating,
  updated,
  sortBy,
  onSortChange,
  children,
  routeRecommendations,
  onBrowseAll,
  initialExpanded = true,
  map,
  onBack,
  tr,
}: {
  selectedCount: number;
  totalCount: number;
  /** 선택 후보 중 엔진이 실제 배치한 수. 아직 계산 전이면 null */
  placedCount: number | null;
  /** 선택했지만 들어가지 못한 수. `placedCount + unplacedCount = selectedCount` */
  unplacedCount: number | null;
  /**
   * 테마체험은 아직 선택할 수 없다 — 숫자 대신 추천 유무를 말한다.
   * `unknown`은 조회 전이거나 스냅샷이 없는 상태다. 그때는 **아무 말도 하지 않는다** —
   * 모르는 것을 "추천 없음"이라고 하면 사용자가 없는 사실을 믿는다.
   */
  themeState: "available" | "none" | "unknown";
  /**
   * 테마체험 칩을 호출부가 직접 준다 (#146 — 하단 독 제거).
   *
   * 없으면 `themeState`로 글자만 만든다. 상세(권역·근거·지도 표시)까지 붙이려면
   * 데이터가 필요한데, 그건 시트가 아니라 호출부가 갖고 있다.
   */
  themeChip?: ReactNode;
  updating: boolean;
  updated: boolean;
  sortBy: "relevance" | "official";
  onSortChange: (sort: "relevance" | "official") => void;
  children?: ReactNode;
  routeRecommendations?: ReactNode;
  /** 후보 수와 무관하게 항상 같은 자리에 둔다 (#146 ①) */
  onBrowseAll: () => void;
  /**
   * 펼친 채로 시작할지 (#146 9번).
   *
   * 기본은 펼침이다 — 후보 선택이 이 단계의 주 작업이라 처음부터 숨기지 않는다.
   * `false`면 compact 바로 시작해 지도를 가리지 않는다. 지금 펼친 시트는 지도 338px 중
   * 270px을 덮어 **실제로 보이는 지도가 68px**뿐인데, 접힌 바는 62px만 덮는다.
   *
   * **하드코딩하지 않고 호출부가 정한다.** 데모와 P1 실험이 같은 컴포넌트를 쓰면서
   * 시작 상태만 달리할 수 있어야 한다.
   */
  initialExpanded?: boolean;
  map: ReactNode;
  onBack: () => void;
  tr: Translator;
}) {
  const [expanded, setExpanded] = useState(initialExpanded);
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
            {routeStatus && (
              <span className="text-xs text-sc-muted" role="status" aria-live="polite">
                {routeStatus}
              </span>
            )}
          </div>

          {/*
            상태 요약 (#146 ①).

            **여행 기간과 무관하게 같은 구조를 쓴다.** 2박 3일이든 9박 10일이든 라벨과
            배치는 그대로고 숫자만 커진다. `일정 반영 + 미배치 = 선택` 관계가 유지되므로
            "왜 8곳을 골랐는데 7곳만 있지"가 화면에서 바로 풀린다.

            분류 칩은 이 요약과 **다른 자리에 둔다.** 성격이 다른 숫자를 같은 줄에 섞으면
            둘 다 무슨 뜻인지 흐려진다.
          */}
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <span className="text-sc-muted" data-selection-state>
              {placedCount === null || unplacedCount === null
                ? selectedCountLabel
                : withValues(tr("step3.selectionState"), {
                  selected: String(selectedCount),
                  placed: String(placedCount),
                  unplaced: String(unplacedCount),
                })}
            </span>
            {unplacedCount !== null && unplacedCount > 0 && (
              <span className="rounded bg-sc-orange-soft px-1.5 py-0.5 text-sc-orange-text">
                {tr("step3.unplacedHint")}
              </span>
            )}
          </div>

          {/* 분류 - K-컬처는 선택 수, 테마체험은 아직 선택할 수 없어 추천 유무만 말한다 */}
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs" data-category-chips>
            <span className="rounded-full border border-sc-blue/30 px-2 py-0.5 text-sc-blue">
              {withValues(tr("step3.chipKCulture"), { n: String(selectedCount) })}
            </span>
            {themeChip ?? (themeState !== "unknown" && (
              <span className="rounded-full border px-2 py-0.5 text-sc-muted">
                {tr(themeState === "available" ? "step3.chipThemeAvailable" : "step3.chipThemeNone")}
              </span>
            ))}
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
            {/* 후보가 몇 개든 마지막 자리는 늘 전체 보기다 — 고르는 방법이
                데이터 양에 따라 달라지면 사용자가 매번 화면을 다시 배운다 */}
            <li className={styles.moreItem} data-place-sheet-more>
              <button type="button" className={styles.more} onClick={onBrowseAll}>
                {tr("step3.browseAll")}
              </button>
            </li>
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
  /** `cover`는 카드를 가득 채운다 — 사진이 카드인 추천 카드용 (#146 1절) */
  variant = "inline",
  sizes = "82px",
}: {
  label: string;
  children?: ReactNode;
  photo?: PlacePhoto | null;
  locale?: "ko" | "en";
  variant?: "inline" | "cover";
  sizes?: string;
}) {
  const frameClass = variant === "cover"
    ? `${styles.thumbnail} ${styles.thumbnailCover}`
    : styles.thumbnail;
  if (photo) {
    return (
      <figure className={frameClass} data-place-thumbnail data-place-photo>
        <Image
          src={photo.src}
          alt={photo.alt[locale]}
          fill
          sizes={sizes}
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
      className={frameClass}
      data-place-thumbnail
      aria-label={label}
      role="img"
    >
      <span className={styles.thumbnailAdornment} aria-hidden>{children}</span>
    </div>
  );
}
