/**
 * 자연어 일정 조율 UI의 적용 경계 — React 상태와 분리한 순수 판단.
 *
 * 서버는 제안을 만들지만, 그 제안이 아직 현재 화면을 대상으로 하는지와 확인 창에서
 * 고지한 범위만 선택에서 제외하는지는 클라이언트 상태가 결정한다.
 */

export function commandResponseIsCurrent(submitted: number, current: number): boolean {
  return submitted === current;
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
