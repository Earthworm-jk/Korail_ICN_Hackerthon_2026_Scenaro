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

// #51 배우 선택 필터 — 표시 레벨에서만 동작하고 엔진·초기 선택(#43)은 건드리지 않는다.
// 운영시간(#43)·AI 점수(#48)는 검증된 관계 위의 부가 속성이라 미확인이어도 숨기지 않지만,
// 장면 배우는 배우 선택 모드의 추천 근거 그 자체이므로 미검증이면 기본 추천에서 내린다(A3의 연장).
export type ActorPresence = "confirmed" | "absent" | "unreviewed";

type PresenceInput = Pick<PlaceCandidate, "relation" | "relationDetails">;

/**
 * 배우 선택 모드에서 후보의 장면 등장 상태.
 * null = 필터 비대상(배우 미선택이거나 선택 작품 유래 후보 — 작품 선택은 장면 배우와 무관).
 *
 * relationDetails는 액션이 선택 작품 ∪ 선택 배우 출연작 관계만 내려준다는 전제이며(PR #65 리뷰 1),
 * 판정 순서는 confirmed → unreviewed → absent다: 미검토 관계가 하나라도 남아 있으면
 * 미등장(absent)을 단정하지 않는다.
 */
export function actorPresence(
  candidate: PresenceInput,
  selectedActorIds: ReadonlySet<string>,
): ActorPresence | null {
  if (selectedActorIds.size === 0 || candidate.relation === "selected_work") return null;
  const details = candidate.relationDetails;
  if (details.some((d) =>
    d.actorPresenceReviewed === true && d.featuredActorIds?.some((id) => selectedActorIds.has(id)),
  )) {
    return "confirmed";
  }
  if (details.length === 0 || details.some((d) => d.actorPresenceReviewed !== true)) {
    return "unreviewed";
  }
  return "absent";
}

/**
 * 등장 확정·필터 비대상은 기본 목록, 미등장 확정·미확인은 별도 구분 영역 (#51 합의 3).
 * 두 그룹 모두 선택 가능해야 한다 — 입력 순서(정렬 결과)를 보존한다.
 */
export function splitByActorPresence<T extends PresenceInput>(
  candidates: T[],
  selectedActorIds: ReadonlySet<string>,
): { primary: T[]; separated: { candidate: T; status: "absent" | "unreviewed" }[] } {
  const primary: T[] = [];
  const separated: { candidate: T; status: "absent" | "unreviewed" }[] = [];
  for (const candidate of candidates) {
    const status = actorPresence(candidate, selectedActorIds);
    if (status === "absent" || status === "unreviewed") separated.push({ candidate, status });
    else primary.push(candidate);
  }
  return { primary, separated };
}

/**
 * 최초 후보 로드의 초기 선택 — 배우 선택 모드에서 별도 구분(미등장·미확인)은 초기 미선택이다
 * (#51 합의 "기본 추천 제외", PR #65 리뷰 2). 사용자는 별도 영역에서 직접 선택할 수 있다.
 * 재열람 복원은 이 함수를 쓰지 않는다 — 저장 당시 선택은 excluded 목록이 단일 기준 (#35).
 */
export function initialSelectedIds<T extends PresenceInput & { id: string }>(
  candidates: T[],
  selectedActorIds: ReadonlySet<string>,
): string[] {
  return splitByActorPresence(candidates, selectedActorIds).primary.map((c) => c.id);
}
