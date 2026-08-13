/** 장소 유형 → Lucide 아이콘 키 (#118 P0-4) */
import type { PlaceTypeT } from "./types/schema";

export const PLACE_TYPE_FALLBACK_ICON_KEY = "map-pin" as const;

/**
 * 한 세트의 오픈소스 아이콘만 사용한다. `heritage`의 `landmark`는 서양 건축 양식을
 * 사실로 주장하는 그림이 아니라 지도 서비스에서 널리 쓰이는 "문화 명소" 표지로 사용한다.
 * 시간/기록을 뜻하는 `history`보다 방문 대상임을 즉시 전달하는 이점이 더 크고, 실제 장소의
 * 건축 양식은 이름·사진이 전달한다. 촬영지 공통 아이콘은 유형별 구분을 잃으므로 쓰지 않는다.
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
