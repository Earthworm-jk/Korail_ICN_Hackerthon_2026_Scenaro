import { describe, expect, it } from "vitest";
import { searchEntities } from "../actions/search";

// #51 완료 기준 "배우·작품 검색 회귀" — ko/en 결정적 매칭, 부분 일치, 빈 질의·결과 없음.
// 장소명·별칭은 검색 대상이 아니다 (#51 최종 검색 범위 — 배우·작품만).

describe("searchEntities — 배우·작품 ko/en 자동완성 (#51)", () => {
  it("승격된 5명·10편을 실제 Repository에서 검색한다", async () => {
    const actors = [
      ["김고은", "actor-kim-go-eun"],
      ["박보검", "actor-park-bo-gum"],
      ["공유", "actor-gong-yoo"],
      ["이민호", "actor-lee-min-ho"],
      ["김태리", "actor-kim-tae-ri"],
    ] as const;
    const works = [
      ["도깨비", "work-goblin"],
      ["유미의 세포들", "work-yumi-cells"],
      ["유미의 세포들 2", "work-yumi-cells-2"],
      ["작은 아씨들", "work-little-women"],
      ["더 킹: 영원의 군주", "work-the-king"],
      ["남자친구", "work-encounter"],
      ["청춘기록", "work-record-of-youth"],
      ["구르미 그린 달빛", "work-love-in-the-moonlight"],
      ["미스터 션샤인", "work-mr-sunshine"],
      ["스물다섯 스물하나", "work-twenty-five-twenty-one"],
    ] as const;

    for (const [query, id] of actors) {
      expect((await searchEntities(query)).actors.map((actor) => actor.id)).toContain(id);
    }
    for (const [query, id] of works) {
      expect((await searchEntities(query)).works.map((work) => work.id)).toContain(id);
    }
  });

  it("한국어 부분 일치로 배우·작품을 찾는다", async () => {
    const byActor = await searchEntities("김고");
    expect(byActor.actors.map((a) => a.id)).toContain("actor-kim-go-eun");
    const byWork = await searchEntities("도깨비");
    expect(byWork.works.map((w) => w.id)).toContain("work-goblin");
  });

  it("영어 부분 일치와 대소문자 무시가 동작한다", async () => {
    const byActor = await searchEntities("kim go");
    expect(byActor.actors.map((a) => a.id)).toContain("actor-kim-go-eun");
    const byWork = await searchEntities("GUARDIAN");
    expect(byWork.works.map((w) => w.id)).toContain("work-goblin");
    const yumi = await searchEntities("Yumi's");
    expect(yumi.works.map((w) => w.id)).toContain("work-yumi-cells");
  });

  it("같은 질의는 항상 같은 결과를 준다 (결정적 — 오프라인 시드만 사용)", async () => {
    const first = await searchEntities("김");
    const second = await searchEntities("김");
    expect(second).toEqual(first);
  });

  it("빈 질의·공백 질의는 빈 결과다 (예외 아님 — REQ-SRCH-008은 UI 처리)", async () => {
    expect(await searchEntities("")).toEqual({ actors: [], works: [] });
    expect(await searchEntities("   ")).toEqual({ actors: [], works: [] });
  });

  it("일치가 없으면 빈 배열이다 — 장소명은 검색 대상이 아니다 (#51)", async () => {
    expect(await searchEntities("존재하지않는검색어")).toEqual({ actors: [], works: [] });
    // 장소명·별칭 직접 검색 제외 확정 — 시드에 있는 장소명으로도 결과가 없어야 한다
    expect(await searchEntities("영진해변")).toEqual({ actors: [], works: [] });
    expect(await searchEntities("도깨비 방파제")).toEqual({ actors: [], works: [] });
  });
});
