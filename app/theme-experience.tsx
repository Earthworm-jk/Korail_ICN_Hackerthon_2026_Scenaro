"use client";
/**
 * 테마체험 권역 카드 (#80 · #14 v0.6 계약)
 *
 * - 추천 단위는 특정 업체가 아니라 권역이다 (#38 결정 기록)
 * - 현재 일정에 자동으로 포함되지 않는 주변 제안이며, 업체·가격·운영시간을 보증하지 않는다
 * - 상태 3분기: 표시 / 추천 없음(관련도 미달) / 추천 불가(검증 스냅샷 누락)
 * - 지도 권역 토글은 앱에 지도가 합류한 뒤 붙인다 (#6 P1 항목 7 — 이번 범위 밖)
 */
import type { ThemeExperienceResult } from "@/lib/actions/theme-experience";
import type { MessageKey } from "@/lib/i18n/messages";

export function ThemeExperienceCard({ result, stationName, locale, tr }: {
  result: ThemeExperienceResult | null; // null = 아직 조회 전 (렌더하지 않음)
  stationName: string | null; // 추천 권역과 같은 권역의 일정 역 이름 — 없으면 연결 문구를 생략한다
  locale: "ko" | "en";
  tr: (key: MessageKey) => string;
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

      {/* A3 — 미보증·자동 미포함 고지는 카드에서 생략하지 않는다 */}
      <p className="mt-2 text-xs text-sc-muted/70">{tr("theme.notice")}</p>
    </section>
  );
}
