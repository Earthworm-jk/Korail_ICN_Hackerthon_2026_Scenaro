import { describe, expect, it } from "vitest";
import { loadRepositories } from "../repositories/json";
import { accessBufferMinutes } from "../types/schema";
import promotionBatch from "../../data/runtime-promotion-batch.json";

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

  it("런타임 fixture는 기존 18곳과 5명·10편 승격 배치를 포함한 36곳이다", () => {
    const repos = loadRepositories();
    const gyeonggijeon = repos.places.find(({ id }) => id === "place-gyeonggijeon-shrine");

    expect(repos.places).toHaveLength(18 + promotionBatch.places.length);
    expect(repos.actors).toHaveLength(5);
    expect(repos.works).toHaveLength(10);
    expect(repos.stations.some(({ id }) => id === "station-namwon")).toBe(true);
    expect(repos.places.find(({ id }) => id === "place-gwanghalluwon-garden")?.nearestStationId)
      .toBe("station-namwon");
    // #51 확정: 관계 미검증·김고은 미등장 — MVP 런타임 시드에서 장소·관계 완전 제외
    expect(repos.places.some(({ id }) => id === "place-gangchon-rail-park")).toBe(false);
    expect(repos.workPlaceRelations.some(({ placeId }) => placeId === "place-gangchon-rail-park")).toBe(false);
    expect(gyeonggijeon?.workIds).toContain("work-the-king");
    expect(gyeonggijeon?.nearestStationId).toBe("station-jeonju");
    expect(repos.stations.some(({ id }) => id === "station-jeonju")).toBe(true);
    // #72 부산 팩: 더 킹 김고은 장면 후보 2곳 + 부산역 (경부선)
    expect(repos.places.some(({ id }) => id === "place-bexco")).toBe(true);
    expect(repos.places.some(({ id }) => id === "place-busan-cinema-center")).toBe(true);
    expect(repos.stations.find(({ id }) => id === "station-busan")?.regionId).toBe("yeongnam");
    expect(repos.places.some(({ id }) => id === "place-naju-image-theme-park")).toBe(false);
    expect(repos.stations.some(({ id }) => id === "station-naju")).toBe(false);
    expect(repos.places.some(({ id }) => id === "place-jukrim-catholic-church")).toBe(false);
    expect(repos.stations.some(({ id }) => id === "station-chuncheon")).toBe(false);
  });

  it("36곳의 전 작품–장소 관계가 완전하고 장소 직접 검색 별칭은 노출하지 않는다", () => {
    const repos = loadRepositories();
    const relationKeys = new Set(
      repos.workPlaceRelations.map(({ workId, placeId }) => `${workId}|${placeId}`),
    );
    const expectedKeys = new Set(
      repos.places.flatMap((place) => place.workIds.map((workId) => `${workId}|${place.id}`)),
    );
    const yeongjin = repos.places.find(({ id }) => id === "place-yeongjin-beach");
    const yeongjinGoblin = repos.workPlaceRelations.find(({ workId, placeId }) =>
      workId === "work-goblin" && placeId === "place-yeongjin-beach");

    expect(relationKeys).toEqual(expectedKeys);
    expect(repos.workPlaceRelations).toHaveLength(42);
    expect(repos.workPlaceRelations.every(({ reviewed, sourceUrls }) => reviewed && sourceUrls.length > 0)).toBe(true);
    expect(yeongjin?.name).toEqual({ ko: "영진해변", en: "Yeongjin Beach" });
    expect(yeongjin?.searchAliases).toBeUndefined();
    expect(yeongjin?.reasonText.ko).toContain("도깨비 방파제");
    expect(yeongjinGoblin?.representativeness).toEqual({
      level: "iconic",
      method: "manual",
      evidenceSourceUrls: [
        "https://english.visitkorea.or.kr/svc/sp/HallyuNew/contentsView.do?dataSetId=70&vcontsId=216921",
      ],
    });
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
