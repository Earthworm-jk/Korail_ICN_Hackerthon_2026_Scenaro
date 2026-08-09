import "server-only";

import { interpretSearchQuery, type SearchCatalog, type SearchInterpretation } from "../adapters/search-interpretation";
import { env } from "../env";
import { loadRepositories } from "../repositories/json";

export type ActorSummary = { id: string; name: { ko: string; en: string } };
export type WorkSummary = { id: string; title: { ko: string; en: string } };
export type EntitySearchResult = {
  actors: ActorSummary[];
  works: WorkSummary[];
  /** 원시 모델 응답·확신도 없이, UI가 실제 LLM 보조 사용 여부만 설명하는 안전 파생값. */
  interpretedByAi?: true;
};

type Interpreter = (
  query: string,
  catalog: SearchCatalog,
  dependencies: { apiKey: string },
) => Promise<SearchInterpretation>;

type SearchDependencies = {
  apiKey?: string;
  interpret?: Interpreter;
};

const EMPTY: EntitySearchResult = { actors: [], works: [] };
const MIN_LLM_QUERY_LENGTH = 3;
const MAX_LLM_QUERY_LENGTH = 80;

function deterministicSearch(query: string): EntitySearchResult {
  const repos = loadRepositories();
  const matches = (ko: string, en: string) =>
    ko.toLowerCase().includes(query) || en.toLowerCase().includes(query);
  return {
    actors: repos.actors
      .filter((actor) => matches(actor.name.ko, actor.name.en))
      .map(({ id, name }) => ({ id, name })),
    works: repos.works
      .filter((work) => matches(work.title.ko, work.title.en))
      .map(({ id, title }) => ({ id, title })),
  };
}

/** 기존 검색 우선 → 0건일 때만 LLM → confidence/allowlist 검증 → 실패 시 빈 결과. */
export async function searchEntitiesCore(
  rawQuery: string,
  dependencies: SearchDependencies = {},
): Promise<EntitySearchResult> {
  const query = rawQuery.trim().toLowerCase();
  if (query.length === 0) return EMPTY;

  const direct = deterministicSearch(query);
  if (direct.actors.length > 0 || direct.works.length > 0) return direct;

  const apiKey = dependencies.apiKey ?? env.OPENAI_API_KEY;
  if (!apiKey || query.length < MIN_LLM_QUERY_LENGTH || query.length > MAX_LLM_QUERY_LENGTH) return EMPTY;

  const repos = loadRepositories();
  const catalog: SearchCatalog = {
    actors: repos.actors.map(({ id, name }) => ({ id, ko: name.ko, en: name.en })),
    works: repos.works.map(({ id, title }) => ({ id, ko: title.ko, en: title.en })),
  };

  try {
    const interpreted = await (dependencies.interpret ?? interpretSearchQuery)(query, catalog, { apiKey });
    if (interpreted.confidence !== "high") return EMPTY;

    const allowedActorIds = new Set(catalog.actors.map(({ id }) => id));
    const allowedWorkIds = new Set(catalog.works.map(({ id }) => id));
    const actorId = interpreted.entityType === "actor" && allowedActorIds.has(interpreted.entityId)
      ? interpreted.entityId
      : undefined;
    const workId = interpreted.entityType === "work" && allowedWorkIds.has(interpreted.entityId)
      ? interpreted.entityId
      : undefined;

    const matched = {
      actors: repos.actors
        .filter(({ id }) => id === actorId)
        .map(({ id, name }) => ({ id, name })),
      works: repos.works
        .filter(({ id }) => id === workId)
        .map(({ id, title }) => ({ id, title })),
    };
    if (matched.actors.length === 0 && matched.works.length === 0) return EMPTY;
    return { ...matched, interpretedByAi: true };
  } catch {
    return EMPTY;
  }
}
