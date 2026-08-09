"use client";
/**
 * 테마체험 권역 카드 (#80 · #14 v0.6 계약)
 *
 * - 추천 단위는 특정 업체가 아니라 권역이다 (#38 결정 기록)
 * - 현재 일정에 자동으로 포함되지 않는 주변 제안이며, 업체·가격·운영시간을 보증하지 않는다
 * - 상태 3분기: 표시 / 추천 없음(관련도 미달) / 추천 불가(검증 스냅샷 누락)
 * - 지도 권역 토글은 기본이 숨김이다. 눌렀을 때만 권역 대표 지점을 표시한다 (#14 v0.6)
 */
import { project } from "@/lib/korea-map-projection";
import type { ThemeExperienceResult } from "@/lib/actions/theme-experience";
import type { MessageKey } from "@/lib/i18n/messages";

/**
 * 지도 오버레이 — KoreaMapPanel의 experienceOverlay 슬롯에 넣는 SVG 조각.
 *
 * 원은 권역의 검증된 경계가 아니라 "이 근처"를 가리키는 시각적 표현이다. 대표 지점은
 * 공식 관광정보가 그 권역 대표 관광지의 목적지로 제공하는 좌표이고, 좌표 근거가 없는
 * 권역은 아예 그리지 않는다 (없는 정밀도를 지어내지 않는다 — A3).
 */
export function ThemeExperienceMapOverlay({ result, visible }: {
  result: ThemeExperienceResult | null;
  visible: boolean;
}) {
  if (!visible || result?.status !== "ok" || !result.point) return null;
  const at = project(result.point.latitude, result.point.longitude);
  // 권역명은 지도에 적지 않는다 — 역 라벨과 겹쳐 둘 다 읽을 수 없게 된다(#83이 장소 라벨에서
  // 이미 겪은 문제). 이름은 바로 위 카드와 범례가 말하고, 지도는 위치만 가리킨다.
  return (
    <g aria-hidden="true">
      <circle
        cx={at.x}
        cy={at.y}
        r={9}
        className="fill-sc-blue/15 stroke-sc-blue"
        strokeWidth={1.2}
        strokeDasharray="3 2"
      />
    </g>
  );
}

export function ThemeExperienceCard({ result, stationName, locale, tr, mapVisible, onToggleMap }: {
  result: ThemeExperienceResult | null; // null = 아직 조회 전 (렌더하지 않음)
  stationName: string | null; // 추천 권역과 같은 권역의 일정 역 이름 — 없으면 연결 문구를 생략한다
  locale: "ko" | "en";
  tr: (key: MessageKey) => string;
  mapVisible: boolean;
  onToggleMap: () => void;
}) {
  if (!result) return null;

  if (result.status !== "ok") {
    return (
      <div
        role="status"
        className="rounded-lg border border-sc-orange/30 bg-sc-orange-soft p-4 text-sm text-sc-orange-text"
      >
        {tr(result.status === "none" ? "theme.statusNone" : "theme.statusUnavailable")}
      </div>
    );
  }

  return (
    <section aria-labelledby="theme-experience-title" className="rounded-lg border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 id="theme-experience-title" className="font-medium">
            {result.theme[locale]}
          </h3>
          <p className="text-sm text-sc-muted">{result.zoneName[locale]}</p>
        </div>
        <span className="shrink-0 rounded-full bg-sc-blue-soft px-2.5 py-1 text-xs text-sc-blue-text">
          {tr("theme.badge")}
        </span>
      </div>

      <p className="mt-2 text-sm text-sc-text/80">{result.reason[locale]}</p>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-sc-muted">
        {stationName && (
          <span>
            {tr("theme.routeBefore")}
            {stationName}
            {tr("theme.routeAfter")}
          </span>
        )}
        <span>{tr("theme.policy")}</span>
      </div>

      {/* 좌표 근거가 있는 권역만 지도에 그릴 수 있다 — 없으면 토글 자체를 내보내지 않는다 */}
      {result.point && (
        <button
          type="button"
          aria-pressed={mapVisible}
          onClick={onToggleMap}
          className="mt-3 rounded border px-2.5 py-1 text-xs text-sc-muted hover:border-sc-blue hover:text-sc-blue"
        >
          {tr(mapVisible ? "theme.hideOnMap" : "theme.showOnMap")}
        </button>
      )}

      {/* A3 — 미보증·자동 미포함 고지는 카드에서 생략하지 않는다 */}
      <p className="mt-2 text-xs text-sc-muted/70">{tr("theme.notice")}</p>
    </section>
  );
}
