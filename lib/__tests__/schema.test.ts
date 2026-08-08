import { describe, expect, it } from "vitest";
import { loadRepositories } from "../repositories/json";
import { accessBufferMinutes } from "../types/schema";

describe("시드 스키마 검증 (REQ-DATA-004)", () => {
  it("모든 시드 JSON이 Zod 스키마를 통과한다 — 불일치는 기동 단계에서 실패", () => {
    const repos = loadRepositories();
    expect(repos.actors.length).toBeGreaterThan(0);
    expect(repos.places.length).toBeGreaterThan(0);
    expect(repos.stations.length).toBeGreaterThan(0);
  });

  it("장소의 참조 무결성 — nearestStationId·workIds가 실제로 존재한다", () => {
    const repos = loadRepositories();
    const stationIds = new Set(repos.stations.map((s) => s.id));
    const workIds = new Set(repos.works.map((w) => w.id));
    for (const p of repos.places) {
      expect(stationIds.has(p.nearestStationId)).toBe(true);
      // 기동 시 데이터 불일치 즉시 실패 계약 — 모든 참조가 존재해야 한다
      expect(p.workIds.every((w) => workIds.has(w)), p.id).toBe(true);
    }
    for (const a of repos.actors) {
      expect(a.workIds.every((w) => workIds.has(w)), a.id).toBe(true);
    }
  });

  it("장소의 권역은 최근접역에서 파생 가능하다 — 역마다 regionId 존재", () => {
    const repos = loadRepositories();
    for (const s of repos.stations) {
      expect(s.regionId, s.id).toBeTruthy();
    }
  });

  it("김고은 데모 fixture는 강촌레일파크 제외가 확정된 13곳이다 (#51)", () => {
    const repos = loadRepositories();
    const gyeonggijeon = repos.places.find(({ id }) => id === "place-gyeonggijeon-shrine");

    expect(repos.places).toHaveLength(13);
    // #51 확정: 관계 미검증·김고은 미등장 — MVP 런타임 시드에서 장소·관계 완전 제외
    expect(repos.places.some(({ id }) => id === "place-gangchon-rail-park")).toBe(false);
    expect(repos.workPlaceRelations.some(({ placeId }) => placeId === "place-gangchon-rail-park")).toBe(false);
    expect(gyeonggijeon?.workIds).toContain("work-the-king");
    expect(gyeonggijeon?.nearestStationId).toBe("station-jeonju");
    expect(repos.stations.some(({ id }) => id === "station-jeonju")).toBe(true);
    expect(repos.places.some(({ id }) => id === "place-naju-image-theme-park")).toBe(false);
    expect(repos.stations.some(({ id }) => id === "station-naju")).toBe(false);
  });

  it("#51 데이터는 13개 작품–장소 관계와 검토된 데모 별칭을 제공한다 (강촌 제외)", () => {
    const repos = loadRepositories();
    const relationKeys = new Set(
      repos.workPlaceRelations.map(({ workId, placeId }) => `${workId}|${placeId}`),
    );
    const expectedKeys = new Set(
      repos.places.flatMap((place) => place.workIds.map((workId) => `${workId}|${place.id}`)),
    );
    const yeongjin = repos.places.find(({ id }) => id === "place-yeongjin-beach");

    expect(relationKeys).toEqual(expectedKeys);
    expect(repos.workPlaceRelations).toHaveLength(13);
    expect(repos.workPlaceRelations.every(({ reviewed, sourceUrls }) => reviewed && sourceUrls.length > 0)).toBe(true);
    expect(yeongjin?.name).toEqual({ ko: "주문진 방사제", en: "Jumunjin Breakwater" });
    expect(yeongjin?.searchAliases?.map(({ ko }) => ko)).toEqual([
      "영진해변",
      "도깨비 방파제",
      "주문진 방파제",
      "주문진 도깨비 방사제",
    ]);
  });

  it("재확인 대상 2곳은 주소만 두고 임의 좌표를 만들지 않는다", () => {
    const repos = loadRepositories();
    for (const id of ["place-lala-muri", "place-oak-valley-resort"]) {
      const place = repos.places.find((item) => item.id === id);
      expect(place?.address, id).toBeTruthy();
      expect(place?.latitude, id).toBeUndefined();
      expect(place?.longitude, id).toBeUndefined();
    }
  });
});

describe("접근시간 버퍼 규칙 (#5)", () => {
  it("max(20분, 접근시간의 50%)", () => {
    expect(accessBufferMinutes(10)).toBe(20);
    expect(accessBufferMinutes(40)).toBe(20);
    expect(accessBufferMinutes(60)).toBe(30);
    expect(accessBufferMinutes(90)).toBe(45);
  });
});
