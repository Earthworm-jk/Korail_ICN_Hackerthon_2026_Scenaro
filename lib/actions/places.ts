"use server";
/**
 * 촬영지 후보 목록 (REQ-SRCH-005·006·007) — API_SPEC 3.2
 * 관계 유형은 시드가 아니라 선택 조건에서 배타 파생한다 (ENGINE_SPEC §2).
 * 배우·작품 모두 복수 선택 (#14 확정): 후보 = 선택 배우 관련 ∪ 선택 작품 관련, 중복 제거.
 * #51: 카드 표시용 작품별 회차·장면·장면 배우는 관계(WorkPlaceRelation)에서 붙인다 —
 * 엔진 후보 분류는 Place.workIds, 표시는 관계라는 이원 구조 유지 (PR #52 리뷰).
 */
import { loadRepositories } from "../repositories/json";
import { deriveAiRelevance } from "../place-ranking";
import { loadPlaceRankings } from "../place-rankings-snapshot";
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
  // #48 서버 파생(PR #70 리뷰) — 원시 점수·검토 메타는 응답에 싣지 않는다
  aiRank?: number; // 선택 관련 작품 범위의 검토·배지 통과 점수 순위 (1=최고)
  aiReason?: { ko: string; en: string }; // 검토된 관련 이유
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

  // PR #65 리뷰 1 — 카드 표시·배우 필터 판정 모두 "선택한 배우·작품 관계"만 사용한다 (#51).
  // 무관 작품의 관계가 섞이면 미등장/미확인 판정이 오염되고 카드에도 계약 밖 정보가 노출된다.
  const relevantWorkIds = new Set([...selectedWorkIds, ...actorWorkIds]);

  const candidates: PlaceCandidate[] = [];
  for (const place of repos.places) {
    const relationDetails = (detailsByPlace.get(place.id) ?? []).filter((d) =>
      relevantWorkIds.has(d.workId),
    );
    if (place.workIds.some((id) => selectedWorkIds.has(id))) {
      candidates.push({ ...place, relation: "selected_work", relationDetails });
    } else if (place.workIds.some((id) => actorWorkIds.has(id))) {
      candidates.push({ ...place, relation: "actor_other_work", relationDetails });
    }
  }
  candidates.sort((a, b) => a.id.localeCompare(b.id, "en"));

  // #48 — 랭킹 스냅샷은 서버에서만 읽고 안전 파생값(순위·이유)만 후보에 붙인다
  const relevance = deriveAiRelevance(candidates, loadPlaceRankings());
  for (const candidate of candidates) {
    const derived = relevance.get(candidate.id);
    if (derived) {
      candidate.aiRank = derived.aiRank;
      candidate.aiReason = derived.aiReason;
    }
  }

  return {
    candidates,
    stations: repos.stations.map(({ id, name }) => ({ id, name })),
    works: repos.works.map(({ id, title }) => ({ id, title })),
  };
}
