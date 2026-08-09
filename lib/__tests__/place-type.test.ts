import { describe, expect, it } from "vitest";
import { loadRepositories } from "../repositories/json";
import { PlaceType, type PlaceTypeT } from "../types/schema";
import { PLACE_TYPE_ICON, PLACE_TYPE_FALLBACK_ICON, placeTypeIcon } from "../place-type-icon";

/**
 * 장소 유형·아이콘 계약 (#83 §F)
 *
 * 아이콘 자체는 우리가 고르는 표현이라 출처가 필요 없다. 그러나 "이 장소는 사찰이다"는
 * 사실 주장이므로 근거는 `data/SOURCES.md`에 남긴다. 이 테스트는 그 주장이 시드에서
 * 조용히 사라지거나 조용히 들어오는 것을 막는다.
 */
describe("장소 유형 시드", () => {
  it("현재 시드 14곳은 모두 유형이 분류돼 있다", () => {
    const { places } = loadRepositories();
    const unclassified = places.filter((p) => p.placeType === undefined).map((p) => p.id);
    expect(unclassified).toEqual([]);
    expect(places.length).toBe(14);
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
      expect(Object.keys(PLACE_TYPE_ICON), type).toContain(type);
    }
  });

  it("유형이 없으면 기본 아이콘으로 떨어진다 — 조용한 빈칸을 만들지 않는다", () => {
    expect(placeTypeIcon(undefined)).toBe(PLACE_TYPE_FALLBACK_ICON);
    expect(PLACE_TYPE_FALLBACK_ICON).not.toBe("");
  });

  /**
   * heritage의 빈 문자열은 누락이 아니라 의도다. 유니코드에 한국 사찰·전각 글리프가 없고,
   * 형태가 가까운 ⛩️(일본 신사)·🏯(일본 성)·🛕(힌두 사원)는 K-컬처 제품에서 쓸 수 없다.
   * 틀린 아이콘이 "빈칸을 채운다"는 이유로 들어오는 것을 이 테스트가 막는다.
   */
  it("heritage는 의도적으로 비어 있고, 다른 문화의 기호로 채우지 않는다", () => {
    expect(PLACE_TYPE_ICON.heritage).toBe("");
    const 금지기호 = ["⛩️", "⛩", "🏯", "🛕", "🏛️", "🏛"];
    for (const [type, icon] of Object.entries(PLACE_TYPE_ICON)) {
      expect(금지기호, type).not.toContain(icon);
    }
  });

  it("heritage 외에는 모두 아이콘이 있다", () => {
    for (const [type, icon] of Object.entries(PLACE_TYPE_ICON)) {
      if (type === "heritage") continue;
      expect(icon, type).not.toBe("");
    }
  });

  /**
   * 빈 박스(heritage)와 기본 아이콘(미분류)은 다른 상태를 뜻한다 —
   * "유형은 아는데 아이콘이 없다" vs "유형을 확인하지 못했다".
   * 같은 표시가 되면 확인한 것과 확인 못 한 것이 화면에서 구별되지 않는다.
   */
  it("빈 박스와 미분류 표시가 서로 구별된다", () => {
    expect(placeTypeIcon("heritage")).not.toBe(placeTypeIcon(undefined));
  });
});
