"use server";
/**
 * 테마체험 권역 추천 (#80 · #14 v0.6 화면 계약) — API_SPEC 3.x
 *
 * 검토된 스냅샷만 결정적으로 읽는다. 실행 중 OpenAI 호출은 없으므로 키·네트워크 상태가
 * 결과를 바꾸지 않는다 (#48 런타임 예외 목록 무변경).
 *
 * 응답에는 원시 점수·검토 메타를 싣지 않는다 — 표시에 필요한 값만 내린다 (PR #70 리뷰 규율).
 * 상태는 화면 계약 3분기 그대로다: 표시 / 추천 없음 / 추천 불가.
 */
import { loadThemeZoneRankings, loadThemeZones } from "../theme-zones-snapshot";
import { pickThemeExperience } from "../theme-zones";

export type ThemeExperienceResult =
  | { status: "ok"; zoneName: { ko: string; en: string }; theme: { ko: string; en: string }; reason: { ko: string; en: string }; regionId: string }
  // 관련도 기준을 통과한 검증 권역이 없음 — 스냅샷은 정상
  | { status: "none" }
  // 권역 카탈로그나 검증 스냅샷 자체가 없음
  | { status: "unavailable" };

export async function getThemeExperience(input: {
  selectedWorkIds: string[];
  itineraryRegionIds: string[];
}): Promise<ThemeExperienceResult> {
  const zones = loadThemeZones();
  if (!zones) return { status: "unavailable" };
  const snapshot = loadThemeZoneRankings(zones);
  if (!snapshot) return { status: "unavailable" };

  const pick = pickThemeExperience({
    zones,
    snapshot,
    selectedWorkIds: input.selectedWorkIds,
    itineraryRegionIds: input.itineraryRegionIds,
  });
  if (!pick) return { status: "none" };

  return {
    status: "ok",
    zoneName: pick.zone.name,
    theme: pick.zone.theme,
    reason: pick.reason,
    regionId: pick.zone.regionId,
  };
}
