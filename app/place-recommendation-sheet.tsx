"use client";

import Image from "next/image";
import { type ReactNode } from "react";
import { withValues, type MessageKey } from "@/lib/i18n/messages";
import { photoCredit, type PlacePhoto } from "@/lib/place-photos";
import styles from "./place-recommendation-sheet.module.css";

type Translator = (key: MessageKey) => string;

export function PlaceRecommendationSheet({
  selectedCount,
  totalCount,
  placedCount,
  unplacedCount,
  updating,
  updated,
  routeRecommendations,
  warnings,
  children,
  tr,
}: {
  selectedCount: number;
  totalCount: number;
  /** 선택 후보 중 엔진이 실제 배치한 수. 아직 계산 전이면 null */
  placedCount: number | null;
  /** 선택했지만 들어가지 못한 수. `placedCount + unplacedCount = selectedCount` */
  unplacedCount: number | null;
  updating: boolean;
  updated: boolean;
  routeRecommendations?: ReactNode;
  /**
   * 일정 경고 아이콘 — 경고의 대상이 장소라서 일정 머리글이 아니라 이 목록 옆에 둔다.
   * 어느 장소가 왜 걸리는지 보고 곧바로 그 장소를 빼거나 바꿀 수 있는 자리다.
   */
  warnings?: ReactNode;
  /**
   * 후보 장소 목록 — 접었다 펴지 않고 늘 보인다 (#146 후속).
   *
   * 전에는 `전체 촬영지 보기` 버튼이 같은 목록을 모달로 열었다. 목록이 늘 화면에 있으면
   * 그 버튼과 접기 토글이 둘 다 할 일이 없어져 함께 걷었다.
   */
  children?: ReactNode;
  tr: Translator;
}) {
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
    >
      {/*
        머리글은 제목 → 상태 → 다음 행동이다 (#146 후속 — 독 없애기).

        정렬은 좁히기(지역·콘텐츠)와 같은 줄로 내려갔다 — 둘 다 "목록 다루기"라
        떨어뜨려 놓을 이유가 없다.

        붙어 있는 이 줄이 아래로 흐르는 목록의 머리글이 된다 — 카드를 내려도 무엇을
        보고 있는지가 화면에 남는다. `전체 촬영지 보기`와 접기 토글은 목록이 늘 보이게
        되면서 열 것도 접을 것도 없어져 걷었다.
      */}
      <div id="place-sheet-panel" className={styles.header} data-place-sheet-header>
        <h3 className="shrink-0 text-sm font-semibold">{tr("step3.placeListTitle")}</h3>
        {warnings}
        <span className="text-xs text-sc-muted" data-selection-state>
          {placedCount === null || unplacedCount === null
            ? tr("step3.selectedCount")
              .replace("{selected}", String(selectedCount))
              .replace("{total}", String(totalCount))
            : withValues(tr("step3.selectionState"), {
              placed: String(placedCount),
              unplaced: String(unplacedCount),
            })}
        </span>
        {unplacedCount !== null && unplacedCount > 0 && (
          <span className="rounded bg-sc-orange-soft px-1.5 py-0.5 text-xs text-sc-orange-text">
            {tr("step3.unplacedHint")}
          </span>
        )}
        {routeStatus && (
          <span className="text-xs text-sc-muted" role="status" aria-live="polite">
            {routeStatus}
          </span>
        )}
        {/*
          주 액션 자리 (#146). 버튼을 prop으로 받지 않고 **포털 호스트만 두는** 이유는,
          그 버튼들이 모바일에서는 화면 아래 제자리에 남아야 하기 때문이다. 같은 버튼을
          양쪽에 렌더하면 접근성 트리에 같은 조작이 두 벌 생긴다.
        */}
        <div id="stage-sheet-actions" className="flex shrink-0 items-center gap-2" />
      </div>

      {children}

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
