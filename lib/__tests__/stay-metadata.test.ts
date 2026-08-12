import { describe, expect, it } from "vitest";
import { generateItinerary } from "../engine";
import { loadRepositories } from "../repositories/json";
import { STAY_CATEGORY_DEFAULT_MINUTES } from "../types/schema";
import { BASE_CONSTRAINTS } from "../../test/planner-fixtures";
import promotionBatch from "../../data/runtime-promotion-batch.json";

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
  "place-simgok-port": "nature_walk",
  "place-sacheonjin-beach": "nature_walk",
  "place-sonnollim-workshop": "brief_exterior",
  "place-gwanghalluwon-garden": "culture_venue",
} as const;

const EXPECTED_OFFICIAL_SOURCES = {
  "place-woljeongsa-fir-forest": {
    minutes: 60,
    source: "https://tour.pc.go.kr/Home/H20000/H20100/H20106/html",
    verifiedAt: "2026-08-10",
  },
  "place-samyang-ranch": {
    minutes: 120,
    source: "https://www.samyangroundhill.com/enjoy/course",
    verifiedAt: "2026-08-10",
  },
  "place-gyeonggijeon-shrine": {
    minutes: 60,
    source: "https://tour.jeonju.go.kr/index.jeonju?menuCd=DOM_000000106005001000",
    verifiedAt: "2026-08-10",
  },
  "place-omokdae-gil": {
    minutes: 60,
    source: "https://tour.jeonju.go.kr/index.jeonju?menuCd=DOM_000000106008000000",
    verifiedAt: "2026-08-12",
  },
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

  it("현재 런타임 36곳은 검토한 유형과 category_default 또는 공식 근거를 모두 가진다", () => {
    const places = loadRepositories().places;
    const promotedCategories = Object.fromEntries(
      promotionBatch.places.map(({ runtimePlaceId, stayCategory }) => [runtimePlaceId, stayCategory]),
    );
    const expectedCategories: Record<string, string> = {
      ...EXPECTED_CATEGORIES,
      ...promotedCategories,
    };
    expect(places).toHaveLength(Object.keys(expectedCategories).length);
    for (const place of places) {
      expect(place.stayMetadata?.category, place.id).toBe(
        expectedCategories[place.id],
      );
      const official = EXPECTED_OFFICIAL_SOURCES[
        place.id as keyof typeof EXPECTED_OFFICIAL_SOURCES
      ];
      if (official !== undefined) {
        expect(place.stayMetadata?.basis, place.id).toBe("official_source");
        if (place.stayMetadata?.basis !== "official_source") continue;
        expect(place.stayMetadata.sourceMinutes, place.id).toBe(official.minutes);
        expect(place.stayMetadata.source, place.id).toBe(official.source);
        expect(place.stayMetadata.sourceFormat, place.id).toBe("html");
        expect(place.stayMetadata.sourceQuote.length, place.id).toBeGreaterThan(0);
        expect(place.stayMetadata.sourceLocator.length, place.id).toBeGreaterThan(0);
        expect(place.stayMetadata.verifiedAt, place.id).toBe(official.verifiedAt);
        expect(place.stayMinutes, place.id).toBe(official.minutes);
      } else {
        expect(place.stayMetadata?.basis, place.id).toBe("category_default");
        expect(place.stayMinutes, place.id).toBe(
          STAY_CATEGORY_DEFAULT_MINUTES[place.stayMetadata!.category],
        );
      }
    }
  });

  it("공식 근거 승격은 기존 유형 기본값과 같아 일정 엔진 입력을 바꾸지 않는다", () => {
    const places = loadRepositories().places.filter(
      ({ stayMetadata }) => stayMetadata?.basis === "official_source",
    );
    expect(places).toHaveLength(4);
    for (const place of places) {
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
