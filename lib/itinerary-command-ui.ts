import type { PendingCommandSlots } from "./itinerary-command-slots";
/**
 * 자연어 일정 조율 UI의 적용 경계 — React 상태와 분리한 순수 판단.
 *
 * 서버는 제안을 만들지만, 그 제안이 아직 현재 화면을 대상으로 하는지와 확인 창에서
 * 고지한 범위만 선택에서 제외하는지는 클라이언트 상태가 결정한다.
 */

export function commandResponseIsCurrent(submitted: number, current: number): boolean {
  return submitted === current;
}

type PanelGate = {
  hasCandidates: boolean;
  hasPlannedResult: boolean;
  reopened: boolean;
  alternativeSelected: boolean;
  requiresSelectionAdjustment: boolean;
};

/**
 * 패널을 **열 수조차 없는가** (#171).
 *
 * 과선택은 여기서 빠졌다. 앞서는 이 조건에 묶여 있어서 패널을 여는 버튼까지 잠겼고,
 * 그래서 **왜 잠겼는지 설명하는 문구를 볼 방법이 없었다** — 사용자에게는 이유 없이
 * 회색인 버튼이었다. AI를 표방하는 화면에서 가장 도움이 필요한 순간에 그랬다.
 *
 * 지금은 연다. 열어서 지금 상황을 설명하고 정리를 제안한다.
 */
export function commandPanelUnavailable(input: PanelGate): boolean {
  return !input.hasCandidates
    || !input.hasPlannedResult
    || input.reopened
    || input.alternativeSelected;
}

/**
 * 자연어 **입력**을 받을 수 있는가.
 *
 * 과선택 상태에서는 막는다. 지금 일정은 최종 확정이 아니라 제외 판단용 미리보기라
 * (#84), 그 위에서 "둘째 날로 옮겨줘" 같은 편집을 받으면 확정되지 않은 것을 편집하게
 * 된다. 대신 패널이 정리 제안을 먼저 내놓는다.
 */
export function commandInputUnavailable(input: PanelGate): boolean {
  return commandPanelUnavailable(input) || input.requiresSelectionAdjustment;
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


/**
 * 지금 이어 붙일 수 있는 조각 (PR #175 리뷰).
 *
 * **조각은 재질문 피드백에만 산다.** 별도 상태로 두면 선택 변경·재계산 때 지우는 곳을
 * 빠뜨려 낡은 조각이 살아남고, 사용자가 말하지 않은 장소·날짜에 적용된다.
 *
 * 이 함수가 그 계약이다 — 재질문이 아닌 어떤 상태에서도 `null`이므로, 피드백을 비우는
 * 모든 경로(선택 토글·재계산·재열람·제안 적용·취소)가 곧 무효화 지점이 된다.
 */
export function pendingSlotsOf(
  feedback: {
    kind: string;
    pendingSlots?: PendingCommandSlots | null;
    /** 이 조각이 만들어진 시점의 일정 기준 */
    basisKey?: string;
  } | null,
  currentBasisKey: string,
): PendingCommandSlots | null {
  if (feedback === null) return null;
  if (feedback.kind !== "clarify") return null;
  /**
   * **기준이 바뀌었으면 조각을 쓰지 않는다** (PR #175 리뷰 2회차).
   *
   * 앞서는 "피드백을 비우는 곳이 곧 무효화 지점"이라고 했는데, 그건 비우는 걸 **잊지
   * 않았을 때만** 참이다. 실제로 `chooseAlternative`가 비우지 않아 대안을 골랐다
   * 되돌아오면 옛 조각이 되살아났다.
   *
   * 그래서 호출부의 성실함에 기대지 않는다. 조각에 만들어진 기준을 새겨 두고 지금 기준과
   * 다르면 쓰지 않는다 — 누가 어디서 비우는 걸 빠뜨려도 낡은 조각이 적용되지 않는다.
   */
  if (feedback.basisKey !== currentBasisKey) return null;
  return feedback.pendingSlots ?? null;
}

/**
 * 조각이 유효한 "일정 기준" 식별자.
 *
 * 이 값이 달라지면 같은 "둘째 날"이 **다른 일정의** 둘째 날을 가리킨다.
 *
 * **요청을 구조적으로 훑는다** (PR #175 리뷰 4회차). 앞서는 필드를 손으로 나열했는데,
 * 그러면 `PlanRequest`에 새 입력이 생겼을 때 조용히 빠진다 — 주석은 "자동으로 걸린다"고
 * 적혀 있었지만 실제로는 아니었다. 키를 훑으면 새 필드가 그냥 들어온다.
 *
 * 배열은 **목록만** 정규화하고 원소 안의 순서는 보존한다 (PR #175 리뷰 5회차). 앞서는
 * 재귀적으로 정렬해서 `preferredOrder`의 쌍 방향까지 뭉갰다 — `[["a","b"]]`와
 * `[["b","a"]]`가 같은 기준이 돼, 사용자가 순서 선호를 **반대로 바꿨는데도** 옛 조각을
 * 같은 일정 기준으로 판단했다.
 *
 * 바깥 목록은 집합 의미가 맞다(선택·제외·선호 쌍의 목록). 안쪽은 값의 일부이므로 그대로 둔다.
 *
 * ## 이 방어가 못 잡는 것
 *
 * **값이 같은 값으로 돌아오는 왕복**은 못 잡는다 — 대안을 골랐다 되돌리기, 시각을 바꿨다
 * 되돌리기. 지문은 값이고 왕복은 값을 되돌리는 일이기 때문이다. 그 경로는 사건 자체로
 * 끊는 명시적 폐기(`plan()`·`chooseAlternative`의 `setAiFeedback(null)`)가 맡는다.
 * **두 겹이고 각자 잡는 것이 다르며, 어느 한쪽도 혼자서는 충분하지 않다.**
 */
/** 값 그대로 — 배열 순서를 보존한다. 쌍처럼 **방향이 뜻을 갖는** 자리에 쓴다 */
function orderedValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return `[${value.map(orderedValue).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .map(([key, inner]) => `${key}:${orderedValue(inner)}`)
      .sort()
      .join(",")}}`;
  }
  return String(value);
}

function stableValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  // 목록만 정규화하고 원소는 그대로 — 안쪽까지 정렬하면 쌍의 방향이 사라진다
  if (Array.isArray(value)) return `[${value.map(orderedValue).sort().join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .map(([key, inner]) => `${key}:${stableValue(inner)}`)
      .sort()
      .join(",")}}`;
  }
  return String(value);
}

export function itineraryBasisKey(input: {
  request: Record<string, unknown>;
  selectedAltId: string | null;
  reopened: boolean;
}): string {
  return [
    stableValue(input.request),
    input.selectedAltId ?? "base",
    input.reopened ? "reopened" : "live",
  ].join("\u0000");
}

/**
 * 과선택 정리 제안을 지금 내놓아도 되는가 (#171 · PR #185 리뷰).
 *
 * **표시 중인 일정이 현재 선택으로 계산된 것일 때만** 낸다. 선택은 즉시 바뀌고 일정은
 * 응답 후에 바뀌므로, 그 사이에는 방금 고른 장소가 "이전 일정에 없다"는 이유만으로
 * 미배치로 찍힌다. 그 상태로 "이 N곳으로 정리하기"를 누르면 **방금 고른 장소까지
 * 버린다.** 재계산이 실패해 이전 결과가 남으면 그 오판이 계속된다.
 *
 * #156이 같은 이유로 `selectionResultIsCurrent`를 넣었는데 카드가 그 경계를 우회했다.
 *
 * 표시와 실행을 **한 값으로 묶는다.** 표시만 숨기고 핸들러를 열어 두면 이벤트 시점의
 * 오래된 closure나 상태 전이에서 다시 적용될 수 있다.
 */
export function overselectionProposalOf(input: {
  capacity: {
    requiresAdjustment: boolean;
    scheduledPlaceIds: readonly string[];
    minimumExclusionCount: number;
    selectedCount: number;
  } | null;
  selectionStateShown: boolean;
}): {
  keepPlaceIds: readonly string[];
  dropCount: number;
  selectedCount: number;
} | null {
  if (!input.selectionStateShown) return null;
  if (!input.capacity?.requiresAdjustment) return null;
  return {
    keepPlaceIds: input.capacity.scheduledPlaceIds,
    dropCount: input.capacity.minimumExclusionCount,
    selectedCount: input.capacity.selectedCount,
  };
}

/**
 * 과선택 정리를 되돌릴 수 있는가 (PR #185 리뷰).
 *
 * 이 되돌리기는 **정리 적용 직후에만 유효한 한 단계**다. 그 뒤에 사용자가 후보를 토글하거나
 * 다른 명령이 선택을 바꾸면, 옛 스냅샷을 복원하는 순간 **그 사이 작업이 통째로 덮인다.**
 *
 * 호출부마다 지우게 하지 않는다 — 그러면 새 경로가 생길 때마다 또 빠뜨린다(#175에서 같은
 * 실수를 두 번 했다). 대신 **적용 직후의 선택을 함께 저장하고, 지금 선택이 그것과 같을
 * 때만** 되돌리기를 연다. 선택을 바꾸는 경로가 무엇이든 자동으로 닫힌다.
 */
export function selectionUndoAvailable(
  undo: { appliedPlaceIds: readonly string[] } | null,
  currentSelection: Iterable<string>,
): boolean {
  if (undo === null) return false;
  const current = new Set(currentSelection);
  if (current.size !== undo.appliedPlaceIds.length) return false;
  return undo.appliedPlaceIds.every((placeId) => current.has(placeId));
}
