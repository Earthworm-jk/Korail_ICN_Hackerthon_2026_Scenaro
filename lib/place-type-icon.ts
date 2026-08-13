/** 장소 유형 → Lucide 아이콘 키 (#118 P0-4) */
import type { PlaceTypeT } from "./types/schema";

export const PLACE_TYPE_FALLBACK_ICON_KEY = "map-pin" as const;

/**
 * 한 세트의 오픈소스 아이콘만 사용한다. `heritage`는 시간/기록을 뜻하는 추상 아이콘보다
 * 실제 방문 대상임이 바로 읽히는 문화 명소 아이콘을 쓴다.
 */
export const PLACE_TYPE_ICON_KEY = {
  beach: "waves",
  trail: "trees",
  heritage: "landmark",
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
