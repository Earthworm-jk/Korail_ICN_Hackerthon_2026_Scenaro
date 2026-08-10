/**
 * 자연어 일정 조율 UI의 적용 경계 — React 상태와 분리한 순수 판단.
 *
 * 서버는 제안을 만들지만, 그 제안이 아직 현재 화면을 대상으로 하는지와 확인 창에서
 * 고지한 범위만 선택에서 제외하는지는 클라이언트 상태가 결정한다.
 */

export function commandResponseIsCurrent(submitted: number, current: number): boolean {
  return submitted === current;
}

export function commandPanelUnavailable(input: {
  hasCandidates: boolean;
  hasPlannedResult: boolean;
  reopened: boolean;
  alternativeSelected: boolean;
  requiresSelectionAdjustment: boolean;
}): boolean {
  return !input.hasCandidates
    || !input.hasPlannedResult
    || input.reopened
    || input.alternativeSelected
    || input.requiresSelectionAdjustment;
}

export function selectionAfterCommand(input: {
  candidatePlaceIds: readonly string[];
  currentSelectedPlaceIds: ReadonlySet<string>;
  scheduledPlaceIds: ReadonlySet<string>;
  displacedPlaceIds: ReadonlySet<string>;
}): Set<string> {
  return new Set(input.candidatePlaceIds.filter((placeId) => (
    input.scheduledPlaceIds.has(placeId)
    || (
      input.currentSelectedPlaceIds.has(placeId)
      && !input.displacedPlaceIds.has(placeId)
    )
  )));
}

export function stateAfterRouteRecommendation(input: {
  currentSelectedPlaceIds: ReadonlySet<string>;
  currentPreferredVisitDates: Readonly<Record<string, string>>;
  recommendation: {
    placeId: string;
    targetDate: string;
    displacedPlaceIds: readonly string[];
  };
}): { selectedPlaceIds: Set<string>; preferredVisitDates: Record<string, string> } {
  const selectedPlaceIds = new Set(input.currentSelectedPlaceIds);
  const preferredVisitDates = {
    ...input.currentPreferredVisitDates,
    [input.recommendation.placeId]: input.recommendation.targetDate,
  };
  for (const placeId of input.recommendation.displacedPlaceIds) {
    selectedPlaceIds.delete(placeId);
    delete preferredVisitDates[placeId];
  }
  selectedPlaceIds.add(input.recommendation.placeId);
  return { selectedPlaceIds, preferredVisitDates };
}

/**
 * 날짜 편집(버튼·드래그)을 지금 허용해도 되는가 (PR #150 리뷰 1번).
 *
 * 화면은 선택이 바뀐 순간부터 재계산이 끝날 때까지 **직전 일정을 계속 보여준다.**
 * 그 구간에 직전 일정의 장소를 편집하면, 이미 바뀐 선택 집합을 기준으로 요청이 나가
 * 서로 다른 기준 상태가 섞인다. 새 선택에서 빠진 장소가 직전 일정에 남아 있는 짧은
 * 순간에는 의도하지 않은 재추가가 된다.
 *
 * **표시 일정과 입력 상태가 일치할 때만** 허용한다. UI 비활성만으로는 서버 호출을 막지
 * 못하므로 핸들러도 같은 기준으로 한 번 더 본다.
 */
export function canEditVisitDate(input: {
  updating: boolean;
  commandDisabled: boolean;
  hasDisplayedDays: boolean;
  needsSelection: boolean;
  requiresAdjustment: boolean;
}): boolean {
  return !input.updating
    && !input.commandDisabled
    && input.hasDisplayedDays
    && !input.needsSelection
    && !input.requiresAdjustment;
}

/**
 * 조율 패널을 닫아도 되는가 (#151 · PR #152 리뷰).
 *
 * 세 경우에 막는다.
 *
 * - **요청 처리 중** — 닫아도 요청은 살아 있다. 늦게 `ready`가 오면 **닫힌 패널 뒤에서**
 *   일정이 바뀌고 설명도 실행 취소도 안 보인다
 * - **확인을 기다리는 제안** — 닫으면 무엇을 승인하려던 것인지 사라진다
 * - **추천 목록** — 적용 또는 취소로 결론나야 한다. 다만 **명시적 취소 경로가 반드시 있어야**
 *   사용자가 갇히지 않는다
 */
export function panelDismissable(
  feedback: { kind: string; applied?: boolean } | null,
  pending = false,
): boolean {
  if (pending) return false;
  if (!feedback) return true;
  if (feedback.kind === "recommendations") return false;
  return !(feedback.kind === "proposal" && feedback.applied === false);
}
