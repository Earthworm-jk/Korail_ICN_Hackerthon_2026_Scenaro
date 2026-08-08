"use server";
/**
 * 촬영지 후보 목록 (REQ-SRCH-005·006·007) — API_SPEC 3.2
 * 관계 유형은 시드가 아니라 선택 조건에서 배타 파생한다 (ENGINE_SPEC §2).
 * 배우·작품 모두 복수 선택 (#14 확정): 후보 = 선택 배우 관련 ∪ 선택 작품 관련, 중복 제거.
 */
import { loadRepositories } from "../repositories/json";
import type { PlaceT, StationT, WorkT } from "../types/schema";

export type Relation = "selected_work" | "actor_other_work";
export type PlaceCandidate = PlaceT & { relation: Relation };

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

  const candidates: PlaceCandidate[] = [];
  for (const place of repos.places) {
    if (place.workIds.some((id) => selectedWorkIds.has(id))) {
      candidates.push({ ...place, relation: "selected_work" });
    } else if (place.workIds.some((id) => actorWorkIds.has(id))) {
      candidates.push({ ...place, relation: "actor_other_work" });
    }
  }
  candidates.sort((a, b) => a.id.localeCompare(b.id, "en"));

  return {
    candidates,
    stations: repos.stations.map(({ id, name }) => ({ id, name })),
    works: repos.works.map(({ id, title }) => ({ id, title })),
  };
}
