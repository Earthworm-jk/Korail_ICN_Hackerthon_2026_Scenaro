"use server";
/**
 * 배우·작품 통합 검색 (REQ-SRCH-003·004) — API_SPEC 3.2
 * 결과 0건은 예외가 아니라 빈 배열 (결과 없음 안내는 UI, REQ-SRCH-008)
 */
import { loadRepositories } from "../repositories/json";

export type ActorSummary = { id: string; name: { ko: string; en: string } };
export type WorkSummary = { id: string; title: { ko: string; en: string } };

export async function searchEntities(query: string): Promise<{
  actors: ActorSummary[];
  works: WorkSummary[];
}> {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return { actors: [], works: [] };

  const repos = loadRepositories();
  const matches = (ko: string, en: string) =>
    ko.toLowerCase().includes(q) || en.toLowerCase().includes(q);

  return {
    actors: repos.actors
      .filter((a) => matches(a.name.ko, a.name.en))
      .map(({ id, name }) => ({ id, name })),
    works: repos.works
      .filter((w) => matches(w.title.ko, w.title.en))
      .map(({ id, title }) => ({ id, title })),
  };
}
