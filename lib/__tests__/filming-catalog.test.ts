import { describe, expect, it } from "vitest";
import plannerPlaces from "../../data/places.json";
import {
  deriveFilmingCatalogCandidates,
  loadFilmingCatalog,
} from "../filming-catalog";

const SCHOOL_NAMES = [
  "중앙고등학교",
  "건국대학교",
  "덕성여자대학교",
  "동국대학교",
  "한국기술교육대학교 제1캠퍼스",
];

describe("전체 촬영지 카탈로그", () => {
  const catalog = loadFilmingCatalog();

  it("검토 확정 수량과 작품별 수량을 고정한다", () => {
    expect(catalog.metadata.placeCount).toBe(184);
    expect(catalog.metadata.relationCount).toBe(203);
    expect(catalog.metadata.placeStatusCounts).toEqual({ confirmed: 175, conditional: 9 });
    expect(catalog.metadata.relationStatusCounts).toEqual({ confirmed: 194, conditional: 9 });
    expect(catalog.metadata.workRelationCounts).toEqual({
      "work-encounter": 48,
      "work-goblin": 43,
      "work-little-women": 3,
      "work-love-in-the-moonlight": 13,
      "work-record-of-youth": 31,
      "work-the-king": 35,
      "work-yumi-cells": 18,
      "work-yumi-cells-2": 12,
    });
  });

  it("학교와 폐업·검증불가 제외 목록을 검색 카탈로그에 넣지 않는다", () => {
    const names = new Set(catalog.places.map(({ name }) => name.ko));
    for (const name of SCHOOL_NAMES) expect(names.has(name), name).toBe(false);
    for (const name of ["나주영상테마파크", "북촌진곰탕", "미니슈퍼", "혜성마켓"]) {
      expect(names.has(name), name).toBe(false);
    }
  });

  it("아난티는 골프클럽임과 이용 조건을 명시한 조건부 장소다", () => {
    const ananti = catalog.places.find(({ name }) => name.ko === "아난티 클럽 서울");
    expect(ananti).toMatchObject({ placeType: "golf_club", status: "conditional" });
    expect(ananti?.visitNote?.ko).toContain("골프클럽");
    expect(ananti?.visitNote?.ko).toContain("예약");
  });

  it("유미 시즌 정정과 더 킹 작품 동명이인 분리를 유지한다", () => {
    for (const name of ["역사책방", "화이트오페라 2호점"]) {
      const place = catalog.places.find(({ name: localized }) => localized.ko === name);
      const workIds = catalog.relations
        .filter(({ placeId }) => placeId === place?.id)
        .map(({ workId }) => workId);
      expect(workIds, name).toEqual(["work-yumi-cells-2"]);
    }
    expect(catalog.works.find(({ id }) => id === "work-the-king")?.title.ko)
      .toBe("더 킹: 영원의 군주");
  });

  it("작품은 전체 관계, 배우는 장면 등장 확정 관계만 엄격하게 반환한다", () => {
    const goblin = deriveFilmingCatalogCandidates(catalog, {
      selectedActorIds: [],
      selectedWorkIds: ["work-goblin"],
    });
    expect(goblin.flatMap(({ relations }) => relations)).toHaveLength(43);

    const kim = deriveFilmingCatalogCandidates(catalog, {
      selectedActorIds: ["actor-kim-go-eun"],
      selectedWorkIds: [],
    });
    expect(kim.length).toBeGreaterThan(0);
    expect(kim.every(({ relations }) => relations.every((relation) =>
      relation.actorPresenceReviewed === true
        && relation.featuredActorIds?.includes("actor-kim-go-eun") === true,
    ))).toBe(true);
  });

  it("플래너의 시간표 검증 시드는 기존 14곳과 분리한다", () => {
    expect(plannerPlaces).toHaveLength(14);
    expect(plannerPlaces.some(({ name }) => name.ko === "강촌레일파크")).toBe(false);
  });
});

