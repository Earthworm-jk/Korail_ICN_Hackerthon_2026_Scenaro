"use client";

import Image from "next/image";
import { ArrowUpDown, ChevronDown, ChevronUp } from "lucide-react";
import { useState, type ReactNode } from "react";
import { withValues, type MessageKey } from "@/lib/i18n/messages";
import { photoCredit, type PlacePhoto } from "@/lib/place-photos";
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
  routeRecommendations,
  onBrowseAll,
  initialExpanded = true,
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
  /**
   * 이전 호출부 호환용. 추천 미리보기는 #207에서 제거했으므로 렌더링하지 않는다.
   * 호출부가 정리되면 이 prop도 함께 제거할 수 있다.
   */
  children?: ReactNode;
  routeRecommendations?: ReactNode;
  /** 후보 수와 무관하게 항상 같은 자리에 둔다 (#146 ①) */
  onBrowseAll: () => void;
  /** 펼친 채 시작할지. 5개 미리보기와 무관하게 하단 독 자체의 표시 상태만 정한다. */
  initialExpanded?: boolean;
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
      data-sheet-mode="browser-entry"
      data-sheet-expanded={expanded ? "true" : "false"}
    >
      {!expanded ? (
        <button
          type="button"
          className={`${styles.collapsedToggle} min-h-11`}
          aria-expanded="false"
          aria-controls="place-sheet-panel"
          onClick={() => setExpanded(true)}
        >
          <ChevronUp aria-hidden="true" className="size-4" />
          {tr("step3.sheetExpand")}
        </button>
      ) : (
        <>
        <div id="place-sheet-panel" className={styles.header} data-place-sheet-header>
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
          {/* 상태와 분류를 한 줄에 나란히 둔다 (#146 9번). compact 바는 62-90px 안에
              들어가야 하는데 두 줄로 쌓으면 97px가 되어 칩이 잘린다. 자리는 여전히
              다르다 — 성격이 다른 숫자를 같은 묶음으로 읽히게 하지 않는다 */}
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
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

            {/* 분류 - K-컬처는 선택 수, 테마체험은 아직 선택할 수 없어 추천 유무만 말한다 */}
            <span className="flex flex-wrap items-center gap-1.5" data-category-chips>
              <span className="rounded-full border border-sc-blue/30 px-2 py-0.5 text-sc-blue">
                {withValues(tr("step3.chipKCulture"), { n: String(selectedCount) })}
              </span>
              {themeChip ?? (themeState !== "unknown" && (
                <span className="rounded-full border px-2 py-0.5 text-sc-muted">
                  {tr(themeState === "available" ? "step3.chipThemeAvailable" : "step3.chipThemeNone")}
                </span>
              ))}
            </span>
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
            className={`${styles.openBrowser} min-h-11`}
            aria-haspopup="dialog"
            aria-controls="place-browser-dialog"
            onClick={onBrowseAll}
            data-place-browser-toggle
          >
            {tr("step3.openBrowser")}
          </button>
          <button
            type="button"
            className={`${styles.collapseToggle} min-h-11`}
            aria-expanded="true"
            aria-controls="place-sheet-panel"
            aria-label={tr("step3.sheetCollapse")}
            title={tr("step3.sheetCollapse")}
            onClick={() => setExpanded(false)}
            data-place-sheet-toggle
          >
            <ChevronDown aria-hidden="true" className="size-4" />
          </button>
        {/*
          독 오른쪽 끝의 주 액션 자리 (#146).

          시트가 바닥 독이 되면서 최종 일정·다시 계산이 여기로 온다. 버튼을 prop으로
          받지 않고 **포털 호스트만 두는** 이유는, 그 버튼들이 모바일에서는 화면 아래
          제자리에 남아야 하기 때문이다. 같은 버튼을 양쪽에 렌더하면 접근성 트리에
          같은 조작이 두 벌 생긴다.
        */}
          <div id="stage-sheet-actions" className="flex shrink-0 items-center gap-2" />
        </div>

        {routeRecommendations && (
          <section
            className={styles.recommendations}
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
        </>
      )}
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
    // 장면 캡처는 링크할 원본이 없다 — 크레딧만 남기고 앵커를 걷는다
    const credit = photoCredit(photo, locale);
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
        {credit.badge === null ? (
          // 장면 캡처는 사진 위에 아무것도 얹지 않는다 — 크레딧은 스크린리더에만 남는다
          <span className="sr-only">{credit.label}</span>
        ) : credit.href ? (
          <a
            href={credit.href}
            target="_blank"
            rel="noreferrer"
            className={styles.thumbnailAttribution}
            title={credit.label}
            aria-label={credit.label}
          >
            {credit.badge}
          </a>
        ) : (
          <span
            className={styles.thumbnailAttribution}
            title={credit.label}
            aria-label={credit.label}
          >
            {credit.badge}
          </span>
        )}
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
