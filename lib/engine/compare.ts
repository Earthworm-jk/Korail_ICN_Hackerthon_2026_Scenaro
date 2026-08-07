/**
 * 후보 일정 비교 — 사전식 (docs/ENGINE_SPEC.md §6, 이슈 #3 최종 결정)
 * 가중치 없음. 앞 키에서 갈리면 뒤 키는 보지 않는다.
 * 동점은 결정적 타이브레이커로 고정한다(동일 입력 → 동일 출력).
 */
import type { ComparisonKeys } from "./types";

export type Candidate = {
  keys: ComparisonKeys;
  // 타이브레이커용 지표 — 비교 키에 포함된 환승·이동시간은 동점 시점에 이미 같으므로
  // 반복하지 않는다 (정의서 v0.4 REQ-ITIN-008)
  departureSlackMinutes: number; // 출국 전 여유 — 클수록 우선
  stableId: string; // 장소 ID·열차번호 결합 등 사전순 최종 기준
};

/** a가 b보다 우선이면 음수. Array.prototype.sort 규약. */
export function compareCandidates(a: Candidate, b: Candidate): number {
  // 1. 사전식 키 (서열: 관련성[개수 벡터] → 방문 장소 수 → 이동시간 → 환승 → 여유 충족)
  if (a.keys.relevanceKey.selectedWorkPlaceCount !== b.keys.relevanceKey.selectedWorkPlaceCount)
    return b.keys.relevanceKey.selectedWorkPlaceCount - a.keys.relevanceKey.selectedWorkPlaceCount;
  if (a.keys.relevanceKey.actorOtherWorkPlaceCount !== b.keys.relevanceKey.actorOtherWorkPlaceCount)
    return b.keys.relevanceKey.actorOtherWorkPlaceCount - a.keys.relevanceKey.actorOtherWorkPlaceCount;
  if (a.keys.visitablePlaceCount !== b.keys.visitablePlaceCount)
    return b.keys.visitablePlaceCount - a.keys.visitablePlaceCount;
  if (a.keys.totalRailMinutes !== b.keys.totalRailMinutes)
    return a.keys.totalRailMinutes - b.keys.totalRailMinutes;
  if (a.keys.transferCount !== b.keys.transferCount)
    return a.keys.transferCount - b.keys.transferCount;
  if (a.keys.slackSatisfied !== b.keys.slackSatisfied)
    return a.keys.slackSatisfied ? -1 : 1;

  // 2. 결정적 타이브레이커: 출국 여유 큼 → 사전순
  if (a.departureSlackMinutes !== b.departureSlackMinutes)
    return b.departureSlackMinutes - a.departureSlackMinutes;
  return a.stableId.localeCompare(b.stableId, "en");
}
