/**
 * 후보 일정 비교 — 사전식 (docs/ENGINE_SPEC.md §6, 이슈 #3 최종 결정)
 * 가중치 없음. 앞 키에서 갈리면 뒤 키는 보지 않는다.
 * 동점은 결정적 타이브레이커로 고정한다(동일 입력 → 동일 출력).
 */
import type { ComparisonKeys } from "./types";

export type Candidate = {
  keys: ComparisonKeys;
  // 타이브레이커용 지표
  transferCount: number;
  totalRailMinutes: number;
  departureSlackMinutes: number; // 출국 전 여유 — 클수록 우선
  stableId: string; // 장소 ID·열차번호 결합 등 사전순 최종 기준
};

/** a가 b보다 우선이면 음수. Array.prototype.sort 규약. */
export function compareCandidates(a: Candidate, b: Candidate): number {
  // 1. 사전식 키 (서열: 관련성 → 방문 장소 수 → 이동시간 → 환승 → 여유 충족)
  if (a.keys.relevanceScore !== b.keys.relevanceScore)
    return b.keys.relevanceScore - a.keys.relevanceScore;
  if (a.keys.visitablePlaceCount !== b.keys.visitablePlaceCount)
    return b.keys.visitablePlaceCount - a.keys.visitablePlaceCount;
  if (a.keys.totalRailMinutes !== b.keys.totalRailMinutes)
    return a.keys.totalRailMinutes - b.keys.totalRailMinutes;
  if (a.keys.transferCount !== b.keys.transferCount)
    return a.keys.transferCount - b.keys.transferCount;
  if (a.keys.slackSatisfied !== b.keys.slackSatisfied)
    return a.keys.slackSatisfied ? -1 : 1;

  // 2. 결정적 타이브레이커: 환승 적음 → 이동시간 짧음 → 출국 여유 큼 → 사전순
  if (a.transferCount !== b.transferCount) return a.transferCount - b.transferCount;
  if (a.totalRailMinutes !== b.totalRailMinutes) return a.totalRailMinutes - b.totalRailMinutes;
  if (a.departureSlackMinutes !== b.departureSlackMinutes)
    return b.departureSlackMinutes - a.departureSlackMinutes;
  return a.stableId.localeCompare(b.stableId, "en");
}
