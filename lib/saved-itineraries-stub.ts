/**
 * 저장 일정 스텁 — Supabase 연결(#25 확정: Auth + PostgreSQL + RLS) 전의 in-memory 표현.
 * 필드는 saved_itineraries 최소 스키마(#25 PRD §6)와 이름을 맞춰 두어 실제 저장 액션으로
 * 교체할 때 UI 변경이 없게 한다. 세션이 끝나면 사라지는 것이 정상이며 UI는 스텁 배지를 단다.
 */
import type { DayPlan } from "./engine/types";

export type SavedItineraryStub = {
  id: string;
  title: string; // 앱이 기본 제목 자동 생성 (#25 §6)
  savedAt: string; // ISO
  days: DayPlan[];
  snapshotVersion: string; // 열차·항공 스냅샷 기준 — 재열람 시 버전 불일치 안내 근거
};

const KST = "Asia/Seoul";

function kstDayNumber(iso: string): number {
  const kst = new Date(Date.parse(iso) + 9 * 60 * 60 * 1000);
  return Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) / 86_400_000;
}

function shortDate(iso: string, locale: "ko" | "en"): string {
  return new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", {
    timeZone: KST,
    month: locale === "ko" ? "numeric" : "short",
    day: "numeric",
  }).format(new Date(iso));
}

/**
 * 기본 저장 제목 — 기간·박수·대표 콘텐츠 조합 (#25 §6 "강릉 3박 4일 · 김고은" 규칙의 스텁 버전.
 * 권역명은 엔진 출력에 권역 식별자가 실리는 #33 이후 합류).
 */
export function defaultSavedTitle(
  arrivalAt: string,
  departureAt: string,
  primaryContentName: string | null,
  locale: "ko" | "en",
): string {
  const nights = Math.max(0, kstDayNumber(departureAt) - kstDayNumber(arrivalAt));
  const range = `${shortDate(arrivalAt, locale)}-${shortDate(departureAt, locale)}`;
  const duration = locale === "ko" ? `${nights}박 ${nights + 1}일` : `${nights + 1} days`;
  const base = `${range} · ${duration}`;
  return primaryContentName ? `${base} · ${primaryContentName}` : base;
}
