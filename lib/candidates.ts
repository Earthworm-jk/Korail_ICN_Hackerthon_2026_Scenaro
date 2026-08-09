/**
 * 후보 선택 규칙 — 순수 함수 (#14 개정·#43)
 * "use server" 모듈은 async 함수만 내보낼 수 있어 UI·테스트 공용 순수 로직은 여기에 둔다.
 */
import type { PlaceCandidate } from "./actions/places";

/** #43 확정: 미확인 후보도 선택 가능(경고 배지) — 초기 선택은 전체 후보. 엔진이 경고와 함께 배치한다. */
export function initialCandidateIds(candidates: Pick<PlaceCandidate, "id">[]): string[] {
  return candidates.map((c) => c.id);
}

/** 재계산 제외 목록 — 선택되지 않은 모든 후보(미확인 포함)가 제외된다 (#2 무상태 재계산) */
export function excludedPlaceIdsFrom(
  candidates: Pick<PlaceCandidate, "id">[],
  selectedIds: ReadonlySet<string>,
): string[] {
  return candidates.filter((c) => !selectedIds.has(c.id)).map((c) => c.id);
}

/** #51 최종 계약: 액션이 이미 엄격한 합집합만 반환하므로 최초 선택은 후보 전체다. */
export const initialSelectedIds = initialCandidateIds;
