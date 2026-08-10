/** 장소 유형 → Lucide 아이콘 키 (#118 P0-4) */
import type { PlaceTypeT } from "./types/schema";

export const PLACE_TYPE_FALLBACK_ICON_KEY = "map-pin" as const;

/**
 * 한 세트의 오픈소스 아이콘만 사용한다. `heritage`는 특정 문화권의 건축물을 닮은
 * 아이콘 대신 문화적으로 중립적인 `history`를 쓴다.
 */
export const PLACE_TYPE_ICON_KEY = {
  beach: "waves",
  trail: "trees",
  heritage: "history",
  walkway: "footprints",
  ranch: "beef",
  cable_car: "cable-car",
  cafe: "coffee",
  restaurant: "utensils",
  stay: "hotel",
  convention: "building",
  cinema: "clapperboard",
  port: "anchor",
  workshop: "paintbrush",
  square: "land-plot",
  library: "library",
  bookstore: "book-open",
  transit: "bus-front",
  park: "tree-pine",
  cultural_center: "drama",
  filming_set: "video",
} as const satisfies Record<PlaceTypeT, string>;

export type PlaceTypeIconKey =
  | (typeof PLACE_TYPE_ICON_KEY)[PlaceTypeT]
  | typeof PLACE_TYPE_FALLBACK_ICON_KEY;

export function placeTypeIconKey(placeType: PlaceTypeT | undefined): PlaceTypeIconKey {
  return placeType === undefined
    ? PLACE_TYPE_FALLBACK_ICON_KEY
    : PLACE_TYPE_ICON_KEY[placeType];
}
