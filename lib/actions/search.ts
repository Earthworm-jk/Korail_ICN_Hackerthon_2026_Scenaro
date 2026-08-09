"use server";
/**
 * 배우·작품 통합 검색 (REQ-SRCH-003·004) — API_SPEC 3.2
 * 결과 0건은 예외가 아니라 빈 배열 (결과 없음 안내는 UI, REQ-SRCH-008)
 */
import { searchEntitiesCore } from "../search/entities";
import type { ActorSummary, WorkSummary } from "../search/entities";
export type { ActorSummary, WorkSummary } from "../search/entities";

export async function searchEntities(query: string): Promise<{
  actors: ActorSummary[];
  works: WorkSummary[];
}> {
  return searchEntitiesCore(query);
}
