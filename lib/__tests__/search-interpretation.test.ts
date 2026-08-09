import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearSearchInterpretationCache,
  interpretSearchQuery,
} from "../adapters/search-interpretation";
import { searchEntitiesCore } from "../search/entities";

describe("P1 검색 입력 해석", () => {
  beforeEach(() => clearSearchInterpretationCache());

  it.each([
    ["Kim Goeun", "actor-kim-go-eun", "actor"],
    ["goblin kdrama", "work-goblin", "work"],
    ["쓸쓸하고 찬란하신 도깨비", "work-goblin", "work"],
    ["도께비", "work-goblin", "work"],
  ] as const)("별칭·오탈자 %s를 허용 ID %s로 연결한다", async (query, id, kind) => {
    const interpret = vi.fn(async () => ({
      confidence: "high" as const,
      entityType: kind,
      entityId: id,
    }));
    const result = await searchEntitiesCore(query, { apiKey: "test-key", interpret });
    expect(kind === "actor" ? result.actors.map((item) => item.id) : result.works.map((item) => item.id)).toEqual([id]);
    expect(result.interpretedByAi).toBe(true);
    expect(interpret).toHaveBeenCalledOnce();
  });

  it("기존 ko/en 부분 일치가 있으면 LLM을 호출하지 않는다", async () => {
    const interpret = vi.fn();
    const result = await searchEntitiesCore("kim go", { apiKey: "test-key", interpret });
    expect(result.actors.map((item) => item.id)).toContain("actor-kim-go-eun");
    expect(result.interpretedByAi).toBeUndefined();
    expect(interpret).not.toHaveBeenCalled();
  });

  it("낮은 확신·키 없음·호출 실패는 기존 빈 결과로 폴백한다", async () => {
    expect(await searchEntitiesCore("도께비")).toEqual({ actors: [], works: [] });
    expect(await searchEntitiesCore("도께비", {
      apiKey: "test-key",
      interpret: async () => ({ confidence: "low", entityType: "work", entityId: "work-goblin" }),
    })).toEqual({ actors: [], works: [] });
    expect(await searchEntitiesCore("도께비", {
      apiKey: "test-key",
      interpret: async () => { throw new Error("timeout"); },
    })).toEqual({ actors: [], works: [] });
  });

  it("모델이 allowlist 밖 ID를 반환해도 폐기한다", async () => {
    const result = await searchEntitiesCore("gobln", {
      apiKey: "test-key",
      interpret: async () => ({
        confidence: "high",
        entityType: "work",
        entityId: "work-invented",
      }),
    });
    expect(result.actors).toEqual([]);
    expect(result.works).toEqual([]);
    expect(result.interpretedByAi).toBeUndefined();
  });

  it("장소·장면 검색 제외 계약은 LLM 프롬프트에도 유지한다", async () => {
    const result = await searchEntitiesCore("영진해변", {
      apiKey: "test-key",
      interpret: async () => ({ confidence: "low", entityType: "none", entityId: "" }),
    });
    expect(result).toEqual({ actors: [], works: [] });
  });

  it("Responses API strict 구조화 출력을 파싱한다", async () => {
    const fetchImpl = vi.fn(async (_url: string, init: { body: string }) => {
      const request = JSON.parse(init.body);
      expect(request.store).toBe(false);
      expect(request.text.format).toMatchObject({ type: "json_schema", strict: true });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          output: [{
            type: "message",
            content: [{ type: "output_text", text: JSON.stringify({
              confidence: "high",
              entityType: "actor",
              entityId: "actor-kim-go-eun",
            }) }],
          }],
        }),
      };
    });
    await expect(interpretSearchQuery("Kim Goeun", { actors: [], works: [] }, {
      apiKey: "test-key",
      fetchImpl: fetchImpl as never,
    })).resolves.toEqual({ confidence: "high", entityType: "actor", entityId: "actor-kim-go-eun" });
  });

  it("성공한 구조화 응답은 정규화 질의별 5분 캐시를 사용한다", async () => {
    let now = 1_000;
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        output: [{
          type: "message",
          content: [{ type: "output_text", text: JSON.stringify({
            confidence: "high",
            entityType: "work",
            entityId: "work-goblin",
          }) }],
        }],
      }),
    }));
    const dependencies = {
      apiKey: "test-key",
      fetchImpl: fetchImpl as never,
      now: () => now,
    };

    await interpretSearchQuery("goblin kdrama", { actors: [], works: [] }, dependencies);
    now += 299_999;
    await interpretSearchQuery("goblin kdrama", { actors: [], works: [] }, dependencies);
    expect(fetchImpl).toHaveBeenCalledOnce();

    now += 1;
    await interpretSearchQuery("goblin kdrama", { actors: [], works: [] }, dependencies);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("HTTP·타임아웃 등 실패 응답은 캐시하지 않는다", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    }));
    const dependencies = { apiKey: "test-key", fetchImpl: fetchImpl as never };

    await expect(interpretSearchQuery("gobln", { actors: [], works: [] }, dependencies)).rejects.toThrow();
    await expect(interpretSearchQuery("gobln", { actors: [], works: [] }, dependencies)).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("캐시는 100개를 넘기지 않고 가장 오래된 질의를 제거한다", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        output: [{
          type: "message",
          content: [{ type: "output_text", text: JSON.stringify({
            confidence: "low",
            entityType: "none",
            entityId: "",
          }) }],
        }],
      }),
    }));
    const dependencies = { apiKey: "test-key", fetchImpl: fetchImpl as never };

    for (let index = 0; index <= 100; index += 1) {
      await interpretSearchQuery(`unknown-${index}`, { actors: [], works: [] }, dependencies);
    }
    await interpretSearchQuery("unknown-0", { actors: [], works: [] }, dependencies);
    expect(fetchImpl).toHaveBeenCalledTimes(102);
  });
});
