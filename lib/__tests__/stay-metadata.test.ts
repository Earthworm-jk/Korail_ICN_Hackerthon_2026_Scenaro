import { describe, expect, it } from "vitest";
import { generateItinerary } from "../engine";
import { loadRepositories } from "../repositories/json";
import { STAY_CATEGORY_DEFAULT_MINUTES } from "../types/schema";
import { BASE_CONSTRAINTS } from "../../test/planner-fixtures";

const EXPECTED_CATEGORIES = {
  "place-yeongjin-beach": "nature_walk",
  "place-lala-muri": "food_cafe",
  "place-eomma-son-makguksu": "food_cafe",
  "place-skybay-hotel-gyeongpo": "brief_exterior",
  "place-woljeongsa-temple": "culture_venue",
  "place-woljeongsa-fir-forest": "nature_walk",
  "place-samyang-ranch": "large_experience",
  "place-balwangsan-cable-car": "large_experience",
  "place-oak-valley-resort": "resort_visit",
  "place-seoullo-7017": "brief_exterior",
  "place-deoksugung-stone-wall-road": "brief_exterior",
  "place-gyeonggijeon-shrine": "culture_venue",
  "place-bexco": "culture_venue",
  "place-busan-cinema-center": "culture_venue",
} as const;

describe("보수 체류 추정 기준 (#84 P0-4)", () => {
  it("유형표는 기존 45·60·90·120분 엔진 값을 보존한다", () => {
    expect(STAY_CATEGORY_DEFAULT_MINUTES).toEqual({
      brief_exterior: 45,
      nature_walk: 60,
      food_cafe: 60,
      culture_venue: 60,
      resort_visit: 90,
      large_experience: 120,
    });
  });

  it("현재 데모 14곳은 검토한 유형과 category_default 근거를 모두 가진다", () => {
    const places = loadRepositories().places;
    expect(places).toHaveLength(Object.keys(EXPECTED_CATEGORIES).length);
    for (const place of places) {
      expect(place.stayMetadata, place.id).toEqual({
        category: EXPECTED_CATEGORIES[place.id as keyof typeof EXPECTED_CATEGORIES],
        basis: "category_default",
      });
      expect(place.stayMinutes, place.id).toBe(
        STAY_CATEGORY_DEFAULT_MINUTES[place.stayMetadata!.category],
      );
    }
  });

  it("근거 메타는 설명용 additive이며 기존 일정 산출을 바꾸지 않는다", () => {
    const repos = loadRepositories();
    const withoutMetadata = {
      ...repos,
      places: repos.places.map(({ stayMetadata, ...place }) => {
        void stayMetadata;
        return place;
      }),
    };
    expect(generateItinerary(BASE_CONSTRAINTS, repos)).toEqual(
      generateItinerary(BASE_CONSTRAINTS, withoutMetadata),
    );
  });
});
