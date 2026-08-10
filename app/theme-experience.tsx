"use client";
/**
 * 테마체험 권역 카드 (#80 · #14 v0.6 계약)
 */
import { Sparkles } from "lucide-react";
import { project } from "@/lib/korea-map-projection";
import { useMapOverlayEntry, useMapView } from "./korea-map";
import type { ThemeExperienceResult } from "@/lib/actions/theme-experience";
import type { MessageKey } from "@/lib/i18n/messages";
import { StageUtilityPortal } from "./stage-utility-portal";

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

export function ThemeExperienceCard({ result, stationName, locale, tr, mapVisible, onToggleMap }: {
  result: ThemeExperienceResult | null;
  stationName: string | null;
  locale: "ko" | "en";
  tr: (key: MessageKey) => string;
  mapVisible: boolean;
  onToggleMap: () => void;
}) {
  if (!result) return null;

  if (result.status !== "ok") {
    return (
      <StageUtilityPortal>
        <div data-stage-utility="theme" role="status" className="flex items-center gap-1.5 rounded-lg border bg-sc-surface px-3 py-2.5 text-xs text-sc-muted">
          <Sparkles aria-hidden="true" className="size-4 shrink-0" />
          {tr(result.status === "none" ? "theme.statusNone" : "theme.statusUnavailable")}
        </div>
      </StageUtilityPortal>
    );
  }

  return (
    <StageUtilityPortal>
      <details data-stage-utility="theme" className="group rounded-lg border bg-sc-surface">
        <summary className="flex min-h-11 list-none items-center justify-between gap-3 px-3 py-2.5 marker:content-none">
          <span className="min-w-0">
            <span className="flex items-center gap-2">
              <strong className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
                <Sparkles aria-hidden="true" className="size-4 shrink-0" />
                <span className="truncate">{result.theme[locale]}</span>
              </strong>
              <span className="shrink-0 rounded-full bg-sc-blue-soft px-2 py-0.5 text-[11px] text-sc-blue">
                {tr("theme.badge")}
              </span>
            </span>
            <span className="block truncate text-xs text-sc-muted">{result.zoneName[locale]}</span>
          </span>
          <span aria-hidden className="shrink-0 text-sc-muted transition-transform group-open:rotate-180">⌄</span>
        </summary>

        <div className="border-t px-3 pb-3 pt-2">
          <p className="text-xs text-sc-text/80">{result.reason[locale]}</p>

          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-sc-muted">
            {stationName && (
              <span>
                {tr("theme.routeBefore")}
                {stationName}
                {tr("theme.routeAfter")}
              </span>
            )}
            <span>{tr("theme.policy")}</span>
          </div>

          {result.point && (
            <button
              type="button"
              aria-pressed={mapVisible}
              onClick={onToggleMap}
              className="mt-2 rounded border px-2.5 py-1 text-xs text-sc-muted hover:border-sc-blue hover:text-sc-blue"
            >
              {tr(mapVisible ? "theme.hideOnMap" : "theme.showOnMap")}
            </button>
          )}

          <p className="mt-2 text-[11px] text-sc-muted/70">{tr("theme.notice")}</p>
        </div>
      </details>
    </StageUtilityPortal>
  );
}
