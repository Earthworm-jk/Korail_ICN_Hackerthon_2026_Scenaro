/**
 * 후보 선택 규칙 — 순수 함수 (#14, PR #30 리뷰 ①)
 * "use server" 모듈은 async 함수만 내보낼 수 있어 UI·테스트 공용 순수 로직은 여기에 둔다.
 */
import type { PlaceCandidate } from "./actions/places";

/** 미확인 후보는 표시 전용 — 초기 선택·일정 요청 대상은 검증 후보뿐. 전부 미확인이면 빈 배열(생성 CTA 비활성). */
export function selectableCandidateIds(
  candidates: Pick<PlaceCandidate, "id" | "openingHours">[],
): string[] {
  return candidates.filter((c) => c.openingHours.type !== "unverified").map((c) => c.id);
}

/** 재계산 제외 목록 — 선택되지 않은 모든 후보(미확인 포함)가 제외된다 (#2 무상태 재계산) */
export function excludedPlaceIdsFrom(
  candidates: Pick<PlaceCandidate, "id">[],
  selectedIds: ReadonlySet<string>,
): string[] {
  return candidates.filter((c) => !selectedIds.has(c.id)).map((c) => c.id);
}
