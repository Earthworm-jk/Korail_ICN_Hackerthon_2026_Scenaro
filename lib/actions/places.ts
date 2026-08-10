"use server";
/**
 * 촬영지 후보 목록 (REQ-SRCH-005·006·007) — API_SPEC 3.2
 * 관계 유형은 시드가 아니라 선택 조건에서 배타 파생한다 (ENGINE_SPEC §2).
 * 배우·작품 모두 복수 선택 (#14 확정): 후보 = 선택 배우 관련 ∪ 선택 작품 관련, 중복 제거.
 * #51: 카드 표시용 작품별 회차·장면·장면 배우는 관계(WorkPlaceRelation)에서 붙인다 —
 * 엔진 후보 분류는 Place.workIds, 표시는 관계라는 이원 구조 유지 (PR #52 리뷰).
 */
import { loadRepositories } from "../repositories/json";
import { roundTripStationIds } from "../timetable-coverage";
import { deriveAiRelevance } from "../place-ranking";
import { loadPlaceRankings } from "../place-rankings-snapshot";
import {
  deriveStrictSelectionMemberships,
  selectionGroupsOf,
  type SelectionGroup,
} from "../selection-candidates";
import type { PlaceT, StationT, WorkPlaceRelationT, WorkT } from "../types/schema";

export type Relation = "selected_work" | "actor_other_work";

/** 작품별 회차·장면·장면 배우 — 검증된 관계 값 그대로, 추측 없음 (#51) */
export type RelationDetail = Pick<
  WorkPlaceRelationT,
  "workId" | "episodeLabel" | "sceneNote" | "featuredActorIds" | "actorPresenceReviewed"
>;

export type PlaceCandidate = PlaceT & {
  relation: Relation;
  /** #51 엄격 후보 집합 소속. 한 장소가 배우·작품 두 그룹을 동시에 충족할 수 있다. */
  selectionGroups: SelectionGroup[];
  relationDetails: RelationDetail[];
  // #48 서버 파생(PR #70 리뷰) — 원시 점수·검토 메타는 응답에 싣지 않는다
  aiRank?: number; // 선택 관련 작품 범위의 활성 점수 순위 (1=최고, 배지 하한과 무관)
  aiReason?: { ko: string; en: string }; // 검증된 장면 근거
};

export type CandidateResponse = {
  candidates: PlaceCandidate[];
  // isAirport는 v0.6 지도가 공항 점을 역과 다른 색으로 찍는 데 쓴다 (#14) — 표시 전용
  // hasTimetable은 #61 문구 분기용: 시간표 범위 밖이라 못 가는 것과 일정 안에 열차가
  // 없는 것을 구분해 표시한다. 공개 사유 코드는 늘리지 않는다.
  // 판정 기준은 #61 수록 기준 5의 **왕복** 확보다 (단방향만으로는 커버로 치지 않는다).
  stations: (Pick<StationT, "id" | "name" | "isAirport"> & { hasTimetable: boolean })[];
  works: Pick<WorkT, "id" | "title">[];
};

export async function getCandidatePlaces(selection: {
  selectedActorIds: string[];
  selectedWorkIds: string[];
}): Promise<CandidateResponse> {
  const repos = loadRepositories();
  // #61 수록 기준 5 — 왕복 시간표가 확보된 역만 커버로 본다.
  // 한 방향만 있으면 돌아올 수 없어 일정이 성립하지 않으므로 "범위 밖"이 맞다 (PR #91 리뷰).
  const timetableStationIds = roundTripStationIds(repos.trainLegs);
  const selectedWorkIds = new Set(selection.selectedWorkIds);
  const actorIds = new Set(selection.selectedActorIds);
  const memberships = deriveStrictSelectionMemberships(
    repos.workPlaceRelations,
    actorIds,
    selectedWorkIds,
  );

  const candidates: PlaceCandidate[] = [];
  for (const place of repos.places) {
    const membership = memberships.get(place.id);
    if (!membership) continue;
    const relationDetails: RelationDetail[] = membership.relations.map((r) => ({
      workId: r.workId,
      episodeLabel: r.episodeLabel,
      sceneNote: r.sceneNote,
      featuredActorIds: r.featuredActorIds,
      actorPresenceReviewed: r.actorPresenceReviewed,
    }));
    candidates.push({
      ...place,
      // 기존 표시·랭킹 호환 필드. 두 그룹 소속 여부의 진실은 selectionGroups다.
      relation: membership.work ? "selected_work" : "actor_other_work",
      selectionGroups: selectionGroupsOf(membership),
      relationDetails,
    });
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
    stations: repos.stations.map(({ id, name, isAirport }) => ({
      id,
      name,
      isAirport,
      hasTimetable: timetableStationIds.has(id),
    })),
    works: repos.works.map(({ id, title }) => ({ id, title })),
  };
}
