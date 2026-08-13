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
 * - **계산 중에도 직전 화면을 그대로 유지한다** (#85). 장소를 하나 끌 때마다 일정과 지도가
 *   사라졌다 나타나면 무엇이 어떻게 달라졌는지 비교할 수 없다. `planning`은 "지금 갱신
 *   중"이라는 표시일 뿐이고, 무엇을 보여줄지는 마지막으로 확정된 상태가 정한다.
 *   경고·제외 사유·배너도 같이 유지한다 — 일정만 남고 경고가 사라지면 더 위험하다.
 * - 선택이 0곳이 되면 직전 일정을 남기지 않는다 (SELECTION_CLEARED). 고를 게 없는데
 *   이전 선택의 결과가 남아 있으면 그걸 저장할 수 있게 된다.
 */
import type { DayPlan, GatewayAlternative, ItineraryResult } from "./engine/types";
import type { MockAlternative } from "./alternatives-mock";
import type { SavedItineraryStub } from "./saved-itineraries-stub";
import { summarizeSelectionCapacity } from "./selection-capacity";

export type ItineraryView = {
  planning: boolean;
  planError: "invalid" | "unexpected" | null;
  result: ItineraryResult | null; // 마지막 계산 결과 — 실패 시에도 유지
  reopened: SavedItineraryStub | null;
  selectedAlt: SelectableAlternative | null; // 전체 교체 — 동시에 하나만 (#14 §7)
};

export type SelectableAlternative = MockAlternative | GatewayAlternative;

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
  | { type: "GATEWAY_ALTERNATIVES_SUCCESS"; alternatives: GatewayAlternative[] }
  | { type: "PLAN_INVALID" }
  | { type: "PLAN_FAILED" }
  | { type: "SELECT_ALT"; alt: SelectableAlternative | null }
  | { type: "REOPEN"; record: SavedItineraryStub }
  | { type: "SELECTION_CLEARED" };

export function reduceItineraryView(view: ItineraryView, event: ItineraryViewEvent): ItineraryView {
  switch (event.type) {
    case "PLAN_START":
      return { ...view, planning: true, planError: null };
    case "PLAN_SUCCESS":
      return { planning: false, planError: null, result: event.result, reopened: null, selectedAlt: null };
    case "GATEWAY_ALTERNATIVES_SUCCESS":
      if (view.result?.status !== "planned") return view;
      return {
        ...view,
        result: {
          ...view.result,
          gatewayAlternatives: event.alternatives.length > 0 ? event.alternatives : undefined,
        },
      };
    case "PLAN_INVALID":
      return { ...view, planning: false, planError: "invalid" };
    case "PLAN_FAILED":
      return { ...view, planning: false, planError: "unexpected" };
    case "SELECT_ALT":
      return { ...view, selectedAlt: event.alt, reopened: null };
    case "REOPEN":
      return { ...view, reopened: event.record, selectedAlt: null, planError: null, planning: false };
    case "SELECTION_CLEARED":
      // 진행 중이던 계산까지 함께 내린다 — 응답은 호출부의 sequence 검사에서 버려진다
      return initialItineraryView;
  }
}

/** 추천(엔진) 일정 — mock 대안 생성과 대안 옵션 표시 기준 */
export function recommendedDays(view: ItineraryView): DayPlan[] | null {
  return view.result?.status === "planned" ? view.result.days : null;
}

/**
 * 화면에 보이는 일정 — 재열람 > 대안 선택 > 추천.
 * 계산 중에도 직전 일정을 그대로 돌려준다 (#85) — 갱신 표시는 렌더가 따로 얹는다.
 */
export function displayedDays(view: ItineraryView): DayPlan[] | null {
  if (view.reopened) return view.reopened.days;
  if (view.selectedAlt) return view.selectedAlt.days;
  return recommendedDays(view);
}

/**
 * 화면 일정에 대응하는 엔진 측정값.
 *
 * 저장 레코드는 아직 metrics를 보존하지 않으므로 재열람에서 값을 재구성하지 않는다. 특히
 * 환승 횟수는 DayPlan만으로 원래 route 경계를 정확히 복원할 수 없어 추정하면 사실과 달라진다.
 * mock 대안은 검증 지표를 만들지 않으므로 추천 원본의 값을 그 대안의 값처럼 표시하지 않는다.
 */
export type ItineraryDisplayMetrics = {
  totalTravelMinutes: number;
  /** 공항 이동편을 포함한 환승 계약이 없으면 표시하지 않는다. */
  transferCount: number | null;
};

export function displayedMetrics(view: ItineraryView): ItineraryDisplayMetrics | null {
  if (view.reopened || view.result?.status !== "planned") return null;
  if (view.selectedAlt?.kind === "mock") return null;
  if (view.selectedAlt?.kind === "gateway_bus") {
    return {
      totalTravelMinutes: view.selectedAlt.metrics.totalTravelMinutes,
      // 엔진 transferCount는 열차↔열차만 세므로 버스↔열차가 있는 대안에는 쓸 수 없다.
      transferCount: null,
    };
  }
  return {
    totalTravelMinutes: view.result.metrics.totalTravelMinutes,
    transferCount: view.result.metrics.transferCount,
  };
}

/**
 * #84 과선택 수치는 추천 원본이 아니라 현재 화면의 전체 교체 일정 기준이다.
 * empty에는 미리볼 일정이 없고, 재열람은 이미 저장된 레코드라 현재 확정 차단에서 제외한다.
 */
export function displayedSelectionCapacity(
  view: ItineraryView,
  selectedPlaceIds: Iterable<string>,
) {
  if (view.reopened) return null;
  const days = displayedDays(view);
  return days ? summarizeSelectionCapacity(selectedPlaceIds, days) : null;
}

/** empty 패널 — 재열람 중에는 노출하지 않는다. 재계산 중에는 직전 판정을 그대로 남긴다 */
export function showEmpty(view: ItineraryView): boolean {
  return !view.reopened && view.result?.status === "empty";
}

/** 배치 제외 사유 목록 — 추천 결과 화면에서만. 일정을 유지하면 사유도 같이 유지한다 */
export function rejectedPlaces(view: ItineraryView) {
  if (view.reopened || view.result?.status !== "planned") return [];
  if (view.selectedAlt?.kind === "gateway_bus") return view.selectedAlt.rejectedPlaces;
  return view.result.rejectedPlaces;
}

/** 운영시간 경고 목록 (#43 결정 1) — 재열람 시에도 저장된 경고를 복원한다 (경고 누락 0건, PR #44 리뷰 2) */
export function itineraryWarnings(view: ItineraryView) {
  // 계산 중에도 유지한다 — 일정만 남고 경고가 사라지면 없는 안전성을 보여주는 셈이다
  if (view.reopened) return view.reopened.warnings ?? [];
  if (view.result?.status !== "planned") return [];
  if (view.selectedAlt?.kind === "gateway_bus") return view.selectedAlt.warnings;
  return view.result.warnings;
}

export function banner(view: ItineraryView): "reopened" | "swapped" | "gateway" | null {
  if (view.reopened) return "reopened";
  if (view.selectedAlt?.kind === "gateway_bus") return "gateway";
  if (view.selectedAlt) return "swapped";
  return null;
}

/**
 * 테마체험 칩이 말할 수 있는 것 (PR #156 리뷰 4)
 *
 * 미조회(`null`)와 스냅샷 부재(`unavailable`)를 "추천 없음"으로 합치면 **모르는 것을
 * 안다고 말하게 된다.** 재계산마다 `null`로 초기화되므로 매번 "추천 없음"이 먼저 떴다가
 * 뒤집히기도 한다.
 *
 * `status: "ok"`면 추천이 있는 것이다 — `point`는 지도용 좌표라 없어도 추천은 있다.
 */
export function themeChipState(
  result: { status: "ok" | "none" | "unavailable" } | null,
): "available" | "none" | "unknown" {
  if (result === null) return "unknown";
  if (result.status === "unavailable") return "unknown";
  return result.status === "ok" ? "available" : "none";
}
