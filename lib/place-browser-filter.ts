/** 전체 촬영지 모달은 한 작품 선택에서는 지역만, 여러 작품 선택에서는 작품도 좁힌다. */
export function showsPlaceBrowserWorkFilter(workCount: number): boolean {
  return workCount >= 2;
}

export function filterPlaceBrowserCandidates<
  T extends { nearestStationId: string; workIds: readonly string[] },
>(
  candidates: readonly T[],
  stationId: string | null,
  workId: string | null,
): T[] {
  return candidates.filter((candidate) =>
    (stationId === null || candidate.nearestStationId === stationId)
    && (workId === null || candidate.workIds.includes(workId)));
}
