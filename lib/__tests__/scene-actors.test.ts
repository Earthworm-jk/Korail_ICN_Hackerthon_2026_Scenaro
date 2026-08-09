import { describe, expect, it } from "vitest";
import {
  loadRepositories,
  parseRepositories,
  SeedValidationError,
  type RawSeedFiles,
} from "../repositories/json";

// #51 장면 출연 배우 3상태·비병합 회귀
// - ⓐ 등장 확정 / ⓑ 미등장 확정 / ⓒ 미검토 — "없음-확정"과 "모름"을 섞지 않는다
// - 호텔킹·주문진방파제는 원천 기반 합성 fixture로만 검증 (MVP 콘텐츠 아님, #51 확정)

const KO_EN = (ko: string, en: string) => ({ ko, en });

function fixtureSeed(): RawSeedFiles {
  const place = (id: string, name: string, lat: number, lon: number) => ({
    id,
    name: KO_EN(name, name),
    workIds: [`work-for-${id}`],
    nearestStationId: "station-fx",
    accessEstimate: { minutes: 35, source: "fixture", verifiedAt: "2026-08-08" },
    openingHours: { type: "always_open", source: "fixture", verifiedAt: "2026-08-08" },
    stayMinutes: 60,
    verificationLevel: "원본확인",
    officialSourceCount: 1,
    reasonText: KO_EN("사유", "Reason"),
    latitude: lat,
    longitude: lon,
  });
  const work = (id: string, title: string) => ({ id, title: KO_EN(title, title) });
  const relation = (workId: string, placeId: string) => ({
    workId,
    placeId,
    sceneNote: KO_EN("장면", "Scene"),
    sourceUrls: ["https://example.com/source"],
    verifiedAt: "2026-08-08",
    reviewed: true,
  });
  return {
    actors: [{ id: "actor-fx", name: KO_EN("배우", "Actor"), workIds: ["work-for-place-yeongjin-fx"] }],
    works: [
      work("work-for-place-yeongjin-fx", "도깨비FX"),
      work("work-for-place-jumunjin-fx", "호텔킹FX"),
    ],
    // 유사 명칭 + 인접 좌표 — 원천에서 별도 관리되면 독립 Place 유지 (#51 단순화 규칙)
    places: [
      place("place-yeongjin-fx", "영진해변", 37.973, 128.951),
      place("place-jumunjin-fx", "주문진방파제", 37.972, 128.95),
    ],
    stations: [
      { id: "station-fx", name: KO_EN("역", "Station"), lineType: "KTX", regionId: "gangwon" },
    ],
    trainLegs: [],
    gatewayLegs: [],
    flights: [],
    workPlaceRelations: [
      relation("work-for-place-yeongjin-fx", "place-yeongjin-fx"),
      relation("work-for-place-jumunjin-fx", "place-jumunjin-fx"),
    ],
  };
}

describe("유사 명칭·인접 장소 비병합 (호텔킹 합성 fixture)", () => {
  it("이름이 비슷하고 좌표가 인접해도 독립 Place 2곳과 각자의 관계가 그대로 통과한다", () => {
    const repos = parseRepositories(fixtureSeed());
    expect(repos.places.map((p) => p.id).sort()).toEqual(["place-jumunjin-fx", "place-yeongjin-fx"]);
    expect(repos.workPlaceRelations).toHaveLength(2);
  });
});

describe("장면 출연 배우 3상태 검증", () => {
  const withRelation = (patch: Record<string, unknown>): RawSeedFiles => {
    const seed = fixtureSeed();
    Object.assign((seed.workPlaceRelations as Record<string, unknown>[])[0], patch);
    return seed;
  };

  it("ⓐ 등장 확정과 ⓑ 미등장 확정, ⓒ 미검토가 모두 유효하다", () => {
    expect(() => parseRepositories(withRelation({
      featuredActorIds: ["actor-fx"], actorPresenceReviewed: true,
    }))).not.toThrow();
    expect(() => parseRepositories(withRelation({
      featuredActorIds: [], actorPresenceReviewed: true,
    }))).not.toThrow();
    expect(() => parseRepositories(fixtureSeed())).not.toThrow();
  });

  it("featuredActorIds만 있고 검토 표시가 없으면 실패한다 (ⓑ/ⓒ 혼동 금지)", () => {
    expect(() => parseRepositories(withRelation({ featuredActorIds: ["actor-fx"] })))
      .toThrow(SeedValidationError);
    expect(() => parseRepositories(withRelation({ actorPresenceReviewed: true })))
      .toThrow(SeedValidationError);
  });

  it("actorPresenceReviewed:false는 네 번째 상태가 아니다 — 명시하면 실패한다 (PR #63 리뷰)", () => {
    expect(() => parseRepositories(withRelation({ actorPresenceReviewed: false })))
      .toThrow(SeedValidationError);
    expect(() => parseRepositories(withRelation({
      featuredActorIds: [], actorPresenceReviewed: false,
    }))).toThrow(SeedValidationError);
  });

  it("존재하지 않는 배우·중복 배우 참조는 실패한다", () => {
    expect(() => parseRepositories(withRelation({
      featuredActorIds: ["actor-ghost"], actorPresenceReviewed: true,
    }))).toThrow(/존재하지 않는 배우 참조/);
    expect(() => parseRepositories(withRelation({
      featuredActorIds: ["actor-fx", "actor-fx"], actorPresenceReviewed: true,
    }))).toThrow(SeedValidationError);
  });

  it("장면 배우의 출연작에 관계의 작품이 없으면 실패한다 (오연결 조기 차단)", () => {
    const seed = fixtureSeed();
    // 관계[1]은 호텔킹FX — actor-fx의 workIds에 없는 작품이라 오연결이다
    Object.assign((seed.workPlaceRelations as Record<string, unknown>[])[1], {
      featuredActorIds: ["actor-fx"], actorPresenceReviewed: true,
    });
    expect(() => parseRepositories(seed)).toThrow(/출연작\(workIds\)에 없는 작품/);
  });
});

describe("실시드 장면 배우 상태 (#26 참고 섹션 대조)", () => {
  const repos = loadRepositories();

  it("등장 확정 8곳 · 미등장 확정 3곳 · 미검토 1곳 (12곳 — #61 죽림동성당 제외)", () => {
    const a = repos.workPlaceRelations.filter(
      (r) => r.actorPresenceReviewed && (r.featuredActorIds?.length ?? 0) > 0,
    );
    const b = repos.workPlaceRelations.filter(
      (r) => r.actorPresenceReviewed && r.featuredActorIds?.length === 0,
    );
    const c = repos.workPlaceRelations.filter((r) => !r.actorPresenceReviewed);
    expect(a).toHaveLength(10);
    expect(b).toHaveLength(3);
    expect(c.map((r) => r.placeId)).toEqual(["place-yeongjin-beach"]);
  });

  it("미등장 확정 3곳은 삼양목장·덕수궁 돌담길·경기전이다 (데모 멘트 회귀)", () => {
    const confirmedAbsent = repos.workPlaceRelations
      .filter((r) => r.actorPresenceReviewed && r.featuredActorIds?.length === 0)
      .map((r) => r.placeId)
      .sort();
    expect(confirmedAbsent).toEqual([
      "place-deoksugung-stone-wall-road",
      "place-gyeonggijeon-shrine",
      "place-samyang-ranch",
    ]);
  });
});
