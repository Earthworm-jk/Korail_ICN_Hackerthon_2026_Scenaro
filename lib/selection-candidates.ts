import type { WorkPlaceRelationT } from "./types/schema";

export type SelectionGroup = "actor" | "work";

export type StrictSelectionMembership = {
  actor: boolean;
  work: boolean;
  /** 선택 배우의 등장 확정 관계 ∪ 선택 작품의 검토 관계. 같은 관계는 한 번만 유지한다. */
  relations: WorkPlaceRelationT[];
};

/**
 * #51 최종 후보 계약의 단일 구현.
 *
 * - 배우 집합: 검토된 작품–장소 관계 중 장면 배우 검토가 끝났고 선택 배우가 실제 등장한 관계
 * - 작품 집합: 사람이 검토한 선택 작품–장소 관계
 * - 최종 후보: 두 집합의 합집합(장소 ID 중복 제거)
 *
 * Place.workIds나 Actor.workIds는 넓은 작품 연결 정보라 배우의 장면 등장을 증명하지 못한다.
 * 따라서 후보 포함 여부에는 사용하지 않는다.
 */
export function deriveStrictSelectionMemberships(
  relations: readonly WorkPlaceRelationT[],
  selectedActorIds: ReadonlySet<string>,
  selectedWorkIds: ReadonlySet<string>,
): ReadonlyMap<string, StrictSelectionMembership> {
  const byPlace = new Map<string, StrictSelectionMembership>();

  for (const relation of relations) {
    if (!relation.reviewed) continue;

    const matchesActor = relation.actorPresenceReviewed === true
      && relation.featuredActorIds?.some((id) => selectedActorIds.has(id)) === true;
    const matchesWork = selectedWorkIds.has(relation.workId);
    if (!matchesActor && !matchesWork) continue;

    const existing = byPlace.get(relation.placeId);
    if (existing) {
      existing.actor ||= matchesActor;
      existing.work ||= matchesWork;
      existing.relations.push(relation);
    } else {
      byPlace.set(relation.placeId, {
        actor: matchesActor,
        work: matchesWork,
        relations: [relation],
      });
    }
  }

  return byPlace;
}

export function selectionGroupsOf(
  membership: Pick<StrictSelectionMembership, "actor" | "work">,
): SelectionGroup[] {
  const groups: SelectionGroup[] = [];
  if (membership.actor) groups.push("actor");
  if (membership.work) groups.push("work");
  return groups;
}
