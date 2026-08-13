/**
 * 후보 일정 비교 — 사전식 (docs/ENGINE_SPEC.md §6, 이슈 #3 최종 결정)
 * 가중치 없음. 앞 키에서 갈리면 뒤 키는 보지 않는다.
 * 동점은 결정적 타이브레이커로 고정한다(동일 입력 → 동일 출력).
 */
import type { ComparisonKeys } from "./types";

export type Candidate = {
  keys: ComparisonKeys;
  // 타이브레이커용 지표 — 비교 키에 포함된 환승·이동시간은 동점 시점에 이미 같으므로
  // 반복하지 않는다 (정의서 v0.5 REQ-ITIN-008)
  departureSlackMinutes: number; // 출국 전 여유 — 클수록 우선
  stableId: string; // 장소 ID·열차번호 결합 등 사전순 최종 기준
};

/** a가 b보다 우선이면 음수. Array.prototype.sort 규약. */
export function compareCandidates(a: Candidate, b: Candidate): number {
  // 1. 사전식 키 (서열: 선택 그룹 충족 → 엄격 합집합 고유 장소 → 검증 충돌 → 선호 날짜 → 이동 → 환승 → 여유)
  //    검증 충돌은 #198: 방문 수 뒤(사용자 선택 의도 우선)·이동시간 앞(신뢰 서사 우선)
  if (a.keys.selectionGroupCoverageCount !== b.keys.selectionGroupCoverageCount)
    return b.keys.selectionGroupCoverageCount - a.keys.selectionGroupCoverageCount;
  if (a.keys.selectedUnionPlaceCount !== b.keys.selectedUnionPlaceCount)
    return b.keys.selectedUnionPlaceCount - a.keys.selectedUnionPlaceCount;
  if (a.keys.verifiedHoursMismatchCount !== b.keys.verifiedHoursMismatchCount)
    return a.keys.verifiedHoursMismatchCount - b.keys.verifiedHoursMismatchCount;
  // 선호 날짜 불일치는 경고 뒤·이동시간 앞 (#139 5절 2번, 지영님 동의)
  if (a.keys.preferredDateMismatchCount !== b.keys.preferredDateMismatchCount)
    return a.keys.preferredDateMismatchCount - b.keys.preferredDateMismatchCount;
  // #145 — 순서는 방문일 뒤·이동시간 앞. 방문일과 합치지 않는다: 하나로 합치면 엔진이
  // 방문일 하나를 어기고 순서 하나를 지키는 식으로 맞바꿀 수 있는데 둘은 같은 무게가 아니다
  if (a.keys.preferredOrderMismatchCount !== b.keys.preferredOrderMismatchCount)
    return a.keys.preferredOrderMismatchCount - b.keys.preferredOrderMismatchCount;
  if (a.keys.totalTravelMinutes !== b.keys.totalTravelMinutes)
    return a.keys.totalTravelMinutes - b.keys.totalTravelMinutes;
  if (a.keys.transferCount !== b.keys.transferCount)
    return a.keys.transferCount - b.keys.transferCount;
  if (a.keys.slackSatisfied !== b.keys.slackSatisfied)
    return a.keys.slackSatisfied ? -1 : 1;

  // 2. 결정적 타이브레이커: 출국 여유 큼 → 사전순
  if (a.departureSlackMinutes !== b.departureSlackMinutes)
    return b.departureSlackMinutes - a.departureSlackMinutes;
  return a.stableId.localeCompare(b.stableId, "en");
}
