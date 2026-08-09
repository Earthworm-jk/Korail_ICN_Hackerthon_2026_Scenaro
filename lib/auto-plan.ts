/**
 * 장소 토글 → 자동 재계산 트리거 판단 (#85 기술항목 2) — 순수 함수
 *
 * 위저드 effect 안에 조건을 흩어 두면 "0곳인데 직전 일정이 남는다" 같은 전이를 테스트로
 * 고정할 수 없다. 무엇을 할지만 여기서 정하고, effect는 그 결정을 실행하기만 한다.
 */
export type AutoPlanDecision =
  /** 자동 계산 대상이 아니다 — 다른 단계이거나, 후보가 아직 없거나, 재열람 중 */
  | "skip"
  /** 고른 장소가 없다 — 직전 일정을 내린다. 남겨 두면 저장까지 가능해진다 */
  | "clear"
  /** 디바운스 후 재계산 */
  | "schedule";

export function autoPlanDecision(input: {
  onPlacesStep: boolean;
  hasCandidates: boolean;
  reopened: boolean;
  selectedCount: number;
}): AutoPlanDecision {
  if (!input.onPlacesStep || !input.hasCandidates) return "skip";
  // 재열람은 저장 당시 일정을 보여주는 중이다 — 자동 계산이 덮어쓰지 않는다
  if (input.reopened) return "skip";
  return input.selectedCount === 0 ? "clear" : "schedule";
}
