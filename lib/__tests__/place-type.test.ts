import { describe, expect, it } from "vitest";
import { loadRepositories } from "../repositories/json";
import { PlaceType, type PlaceTypeT } from "../types/schema";
import {
  PLACE_TYPE_FALLBACK_ICON_KEY,
  PLACE_TYPE_ICON_KEY,
  placeTypeIconKey,
} from "../place-type-icon";

/**
 * 장소 유형·아이콘 계약 (#83 §F)
 *
 * 아이콘 자체는 우리가 고르는 표현이라 출처가 필요 없다. 그러나 "이 장소는 사찰이다"는
 * 사실 주장이므로 근거는 `data/SOURCES.md`에 남긴다. 이 테스트는 그 주장이 시드에서
 * 조용히 사라지거나 조용히 들어오는 것을 막는다.
 */
describe("장소 유형 시드", () => {
  it("시드의 모든 장소가 유형이 분류돼 있다", () => {
    const { places } = loadRepositories();
    const unclassified = places.filter((p) => p.placeType === undefined).map((p) => p.id);
    expect(unclassified).toEqual([]);
    // PR #113 리뷰 — 총개수는 고정하지 않는다. #72로 30-50곳까지 늘어나므로, 15번째 장소가
    // placeType까지 제대로 채워져도 실패하는 테스트가 된다. 다만 시드가 비면 위 단언이
    // 공허하게 통과하므로 비어 있지 않음만 확인한다.
    expect(places.length).toBeGreaterThan(0);
  });

  it("유형 값이 스키마 어휘 안에 있다", () => {
    const { places } = loadRepositories();
    for (const place of places) {
      expect(() => PlaceType.parse(place.placeType), place.id).not.toThrow();
    }
  });

  /**
   * `placeType`과 `stayMetadata.category`는 다른 축이다(무엇인가 / 얼마나 머무는가).
   * 다른 축이라도 서로 모순되면 둘 중 하나가 틀린 것이다 — 카페가 대형 체험일 수 없고
   * 해변이 식음료 체류일 수 없다. 확장(#72)에서 한쪽만 대충 채우는 것을 막는다.
   */
  it("체류 카테고리와 모순되지 않는다", () => {
    const { places } = loadRepositories();
    const 금지: Partial<Record<PlaceTypeT, string[]>> = {
      cafe: ["large_experience", "resort_visit"],
      restaurant: ["large_experience", "resort_visit"],
      beach: ["food_cafe"],
      trail: ["food_cafe"],
      heritage: ["food_cafe"],
    };
    for (const place of places) {
      const category = place.stayMetadata?.category;
      if (!place.placeType || !category) continue;
      expect(금지[place.placeType] ?? [], `${place.id} (${place.placeType})`).not.toContain(category);
    }
  });
});

describe("유형 아이콘 매핑", () => {
  it("모든 유형에 매핑이 있다 — 새 유형을 추가하고 아이콘을 빠뜨릴 수 없다", () => {
    for (const type of PlaceType.options) {
      expect(Object.keys(PLACE_TYPE_ICON_KEY), type).toContain(type);
    }
  });

  it("유형이 없으면 기본 아이콘으로 떨어진다 — 조용한 빈칸을 만들지 않는다", () => {
    expect(placeTypeIconKey(undefined)).toBe(PLACE_TYPE_FALLBACK_ICON_KEY);
    expect(PLACE_TYPE_FALLBACK_ICON_KEY).toBe("map-pin");
  });

  it("heritage는 특정 문화권 건축물 대신 중립적인 history 아이콘을 쓴다", () => {
    expect(PLACE_TYPE_ICON_KEY.heritage).toBe("history");
  });

  it("모든 유형이 이모지나 빈 문자열 대신 아이콘 키를 가진다", () => {
    const emoji = /\p{Extended_Pictographic}/u;
    for (const [type, icon] of Object.entries(PLACE_TYPE_ICON_KEY)) {
      expect(icon, type).not.toBe("");
      expect(emoji.test(icon), type).toBe(false);
    }
  });

  it("분류된 문화유산과 미분류 장소의 표시가 서로 구별된다", () => {
    expect(placeTypeIconKey("heritage")).not.toBe(placeTypeIconKey(undefined));
  });
});
