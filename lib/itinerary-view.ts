/**
 * 결과 화면 상태 전이 — 순수 reducer (PR #35 리뷰 3)
 *
 * 재열람·대안 선택·계산 오류·empty가 컴포넌트 곳곳의 useState 조합으로 흩어지면
 * "empty 패널 + 재열람 일정 동시 렌더" 같은 조합 노출을 막을 수 없다. 렌더 분기가
 * 이 모듈의 파생 함수만 보게 해서 상태 전이를 한곳에서 고정하고 테스트한다.
 *
 * 규칙:
 * - 계산 실패(invalid/unexpected)는 기존 결과·재열람 화면을 유지한다 (REQ-EDIT-005)
 * - 재계산 성공 = 추천 기준 복귀 (대안 선택·재열람 해제)
 * - 재열람은 저장 시점 일정 그대로 — 대안·empty·오류와 동시 노출 금지
 */
import type { DayPlan, ItineraryResult } from "./engine/types";
import type { MockAlternative } from "./alternatives-mock";
import type { SavedItineraryStub } from "./saved-itineraries-stub";

export type ItineraryView = {
  planning: boolean;
  planError: "invalid" | "unexpected" | null;
  result: ItineraryResult | null; // 마지막 계산 결과 — 실패 시에도 유지
  reopened: SavedItineraryStub | null;
  selectedAlt: MockAlternative | null; // 전체 교체 — 동시에 하나만 (#14 §7)
};

export const initialItineraryView: ItineraryView = {
  planning: false,
  planError: null,
  result: null,
  reopened: null,
  selectedAlt: null,
};

export type ItineraryViewEvent =
  | { type: "PLAN_START" }
  | { type: "PLAN_SUCCESS"; result: ItineraryResult }
  | { type: "PLAN_INVALID" }
  | { type: "PLAN_FAILED" }
  | { type: "SELECT_ALT"; alt: MockAlternative | null }
  | { type: "REOPEN"; record: SavedItineraryStub };

export function reduceItineraryView(view: ItineraryView, event: ItineraryViewEvent): ItineraryView {
  switch (event.type) {
    case "PLAN_START":
      return { ...view, planning: true, planError: null };
    case "PLAN_SUCCESS":
      return { planning: false, planError: null, result: event.result, reopened: null, selectedAlt: null };
    case "PLAN_INVALID":
      return { ...view, planning: false, planError: "invalid" };
    case "PLAN_FAILED":
      return { ...view, planning: false, planError: "unexpected" };
    case "SELECT_ALT":
      return { ...view, selectedAlt: event.alt, reopened: null };
    case "REOPEN":
      return { ...view, reopened: event.record, selectedAlt: null, planError: null, planning: false };
  }
}

/** 추천(엔진) 일정 — mock 대안 생성과 대안 옵션 표시 기준 */
export function recommendedDays(view: ItineraryView): DayPlan[] | null {
  return view.result?.status === "planned" ? view.result.days : null;
}

/** 화면에 보이는 일정 — 재열람 > 대안 선택 > 추천 */
export function displayedDays(view: ItineraryView): DayPlan[] | null {
  if (view.planning) return null;
  if (view.reopened) return view.reopened.days;
  if (view.selectedAlt) return view.selectedAlt.days;
  return recommendedDays(view);
}

/** empty 패널 — 재열람·로딩 중에는 노출하지 않는다 */
export function showEmpty(view: ItineraryView): boolean {
  return !view.planning && !view.reopened && view.result?.status === "empty";
}

/** 배치 제외 사유 목록 — 추천 결과 화면에서만 */
export function rejectedPlaces(view: ItineraryView) {
  if (view.planning || view.reopened || view.result?.status !== "planned") return [];
  return view.result.rejectedPlaces;
}

/** 운영시간 경고 목록 (#43 결정 1) — 재열람 시에도 저장된 경고를 복원한다 (경고 누락 0건, PR #44 리뷰 2) */
export function itineraryWarnings(view: ItineraryView) {
  if (view.planning) return [];
  if (view.reopened) return view.reopened.warnings ?? [];
  if (view.result?.status !== "planned") return [];
  return view.result.warnings;
}

export function banner(view: ItineraryView): "reopened" | "swapped" | null {
  if (view.planning) return null;
  if (view.reopened) return "reopened";
  if (view.selectedAlt) return "swapped";
  return null;
}
