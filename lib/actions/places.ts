"use server";
/**
 * 촬영지 후보 목록 (REQ-SRCH-005·006·007) — API_SPEC 3.2
 * 관계 유형은 시드가 아니라 선택 조건에서 배타 파생한다 (ENGINE_SPEC §2).
 * 배우·작품 모두 복수 선택 (#14 확정): 후보 = 선택 배우 관련 ∪ 선택 작품 관련, 중복 제거.
 * #51: 카드 표시용 작품별 회차·장면·장면 배우는 관계(WorkPlaceRelation)에서 붙인다 —
 * 엔진 후보 분류는 Place.workIds, 표시는 관계라는 이원 구조 유지 (PR #52 리뷰).
 */
import { loadRepositories } from "../repositories/json";
import type { PlaceT, StationT, WorkPlaceRelationT, WorkT } from "../types/schema";

export type Relation = "selected_work" | "actor_other_work";

/** 작품별 회차·장면·장면 배우 — 검증된 관계 값 그대로, 추측 없음 (#51) */
export type RelationDetail = Pick<
  WorkPlaceRelationT,
  "workId" | "episodeLabel" | "sceneNote" | "featuredActorIds" | "actorPresenceReviewed"
>;

export type PlaceCandidate = PlaceT & {
  relation: Relation;
  relationDetails: RelationDetail[];
};

export type CandidateResponse = {
  candidates: PlaceCandidate[];
  stations: Pick<StationT, "id" | "name">[];
  works: Pick<WorkT, "id" | "title">[];
};

export async function getCandidatePlaces(selection: {
  selectedActorIds: string[];
  selectedWorkIds: string[];
}): Promise<CandidateResponse> {
  const repos = loadRepositories();
  const selectedWorkIds = new Set(selection.selectedWorkIds);
  const actorIds = new Set(selection.selectedActorIds);
  const actorWorkIds = new Set(
    repos.actors.filter((a) => actorIds.has(a.id)).flatMap((a) => a.workIds),
  );

  const detailsByPlace = new Map<string, RelationDetail[]>();
  for (const r of repos.workPlaceRelations) {
    const detail: RelationDetail = {
      workId: r.workId,
      episodeLabel: r.episodeLabel,
      sceneNote: r.sceneNote,
      featuredActorIds: r.featuredActorIds,
      actorPresenceReviewed: r.actorPresenceReviewed,
    };
    const list = detailsByPlace.get(r.placeId);
    if (list) list.push(detail);
    else detailsByPlace.set(r.placeId, [detail]);
  }

  const candidates: PlaceCandidate[] = [];
  for (const place of repos.places) {
    const relationDetails = detailsByPlace.get(place.id) ?? [];
    if (place.workIds.some((id) => selectedWorkIds.has(id))) {
      candidates.push({ ...place, relation: "selected_work", relationDetails });
    } else if (place.workIds.some((id) => actorWorkIds.has(id))) {
      candidates.push({ ...place, relation: "actor_other_work", relationDetails });
    }
  }
  candidates.sort((a, b) => a.id.localeCompare(b.id, "en"));

  return {
    candidates,
    stations: repos.stations.map(({ id, name }) => ({ id, name })),
    works: repos.works.map(({ id, title }) => ({ id, title })),
  };
}
