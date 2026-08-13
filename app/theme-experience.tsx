"use client";
/**
 * 테마체험 권역 카드 (#80 · #14 v0.6 계약)
 */
import { Sparkles } from "lucide-react";
import Image from "next/image";
import { useRef } from "react";
import { project } from "@/lib/korea-map-projection";
import { useMapOverlayEntry, useMapView } from "./korea-map";
import type { ThemeExperienceResult } from "@/lib/actions/theme-experience";
import type { MessageKey } from "@/lib/i18n/messages";

export function ThemeExperienceMapOverlay({ result, visible }: {
  result: ThemeExperienceResult | null;
  visible: boolean;
}) {
  const shown = visible && result?.status === "ok" && result.point ? result : null;
  const point = shown?.status === "ok" ? shown.point : null;
  const at = point ? project(point.latitude, point.longitude) : null;
  const { unit, locale } = useMapView();
  useMapOverlayEntry(
    "theme-experience",
    at && shown?.status === "ok" ? { point: at, label: shown.zoneName[locale] } : null,
  );

  if (!at) return null;
  return (
    <g aria-hidden="true">
      <circle
        cx={at.x}
        cy={at.y}
        r={10 * unit}
        className="fill-sc-blue/15 stroke-sc-blue"
        strokeWidth={1.2 * unit}
        strokeDasharray={`${3 * unit} ${2 * unit}`}
      />
    </g>
  );
}

/**
 * 테마체험 칩 (#146 — 하단 독 제거)
 *
 * 독 카드는 시트 칩과 **같은 말을 두 번** 했다. `추천 없음`이 양쪽에 있었고, 독 쪽은
 * 버튼도 없는 순수 정보였다. 칩 하나로 합치고 상세(권역·근거·지도 표시)는 눌렀을 때
 * 팝오버로 준다.
 *
 * 추천이 없거나 확인 전이면 누를 것이 없으므로 칩은 글자로만 남는다.
 */
export function ThemeExperienceChip({ result, stationName, locale, tr, mapVisible, onToggleMap }: {
  result: ThemeExperienceResult | null;
  stationName: string | null;
  locale: "ko" | "en";
  tr: (key: MessageKey) => string;
  mapVisible: boolean;
  onToggleMap: () => void;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);
  // 조회 전·스냅샷 부재는 아는 게 없다 — 아무 말도 하지 않는다.
  // 추천이 없을 때도 마찬가지다 — 고를 수도 없는 것의 부재를 칩으로 알리지 않는다.
  if (result === null || result.status !== "ok") return null;

  const label = tr("step3.chipThemeAvailable");
  const chipClass = "rounded-full border px-2 py-0.5 text-sc-muted";

  const popoverId = "theme-experience-detail";
  return (
    <>
      <button
        type="button"
        popoverTarget={popoverId}
        aria-haspopup="dialog"
        aria-controls={popoverId}
        className={`${chipClass} hover:border-sc-blue hover:text-sc-blue`}
      >
        {label}
      </button>
      <div
        ref={popoverRef}
        id={popoverId}
        popover="auto"
        role="dialog"
        aria-labelledby="theme-experience-detail-title"
        className="m-auto w-[min(320px,calc(100vw-32px))] rounded-xl border bg-sc-surface p-3 text-left shadow-2xl backdrop:bg-black/20"
      >
        {result.photo && (
          <Image
            src={result.photo.src}
            alt={result.photo.alt[locale]}
            width={640}
            height={409}
            unoptimized
            className="mb-2 h-24 w-full rounded-lg object-cover"
          />
        )}
        <p id="theme-experience-detail-title" className="flex items-center gap-1.5 text-sm font-semibold">
          <Sparkles aria-hidden="true" className="size-4 shrink-0" />
          {result.theme[locale]}
        </p>
        <p className="mt-0.5 text-xs text-sc-muted">{result.zoneName[locale]}</p>
        <p className="mt-2 text-xs text-sc-text/80">{result.reason[locale]}</p>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-sc-muted">
          {stationName && (
            <span>{tr("theme.routeBefore")}{stationName}{tr("theme.routeAfter")}</span>
          )}
          <span>{tr("theme.policy")}</span>
        </div>
        {result.point && (
          <button
            type="button"
            aria-pressed={mapVisible}
            onClick={() => { popoverRef.current?.hidePopover(); onToggleMap(); }}
            className="mt-2 min-h-10 rounded-lg border px-3 text-xs text-sc-muted hover:border-sc-blue hover:text-sc-blue"
          >
            {tr(mapVisible ? "theme.hideOnMap" : "theme.showOnMap")}
          </button>
        )}
        <p className="mt-2 text-[11px] text-sc-muted/70">{tr("theme.notice")}</p>
      </div>
    </>
  );
}
