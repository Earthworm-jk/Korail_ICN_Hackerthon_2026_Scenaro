/**
 * 장소 유형 → 카드 아이콘 (#83 §F 썸네일)
 *
 * 시안 v0.6의 썸네일은 사진이 아니라 48×48 그라데이션 박스에 글자 하나를 넣은
 * 자리표시자였다. 실제 사진은 이미지마다 출처·라이선스·확인일이 필요하고 재배포 조건이
 * 불명확해 확보 비용 대비 얻는 것이 적다는 판단으로, 우리가 만드는 표현인 아이콘으로
 * 대체한다 (2026-08-10 결정).
 *
 * 이모지를 쓰는 이유는 현재 UI가 이미 🚆 📍 ✈️ ⚠️ 를 쓰고 있어서다. 시안의 한자
 * 자리표시자(海 松 塔 牧)는 영어 화면에서 읽히지 않아 쓰지 않는다 — 이모지는 언어 중립이다.
 */
import type { PlaceTypeT } from "./types/schema";

/** 유형을 확인하지 못한 장소 — 빈칸으로 두지 않는다 */
export const PLACE_TYPE_FALLBACK_ICON = "📍";

/**
 * `heritage`가 빈 문자열인 것은 **매핑 누락이 아니라 의도**다.
 *
 * 월정사·경기전에 쓸 이모지가 유니코드에 없다. 형태가 가까운 것들은 전부 다른 문화의
 * 기호다 — ⛩️는 일본 신사 도리이, 🏯는 일본 성, 🛕는 힌두 사원, 🏛️는 그리스 신전이다.
 * K-컬처 제품에서 한국 사찰·전각에 그 기호를 붙일 수 없다. 틀린 아이콘을 넣느니
 * 그라데이션 박스만 두고 글리프를 비운다.
 *
 * 이것은 기본 아이콘(📍)과 다른 상태다. 📍는 "유형을 확인하지 못했다"이고, 빈 박스는
 * "유형은 아는데 쓸 만한 아이콘이 없다"다. 둘을 같은 표시로 만들면 확인한 것과 확인하지
 * 못한 것이 화면에서 구별되지 않는다.
 *
 * #72로 사찰이 더 들어오면 여기만 채우면 된다. 시드는 건드릴 필요가 없다.
 */
export const PLACE_TYPE_ICON: Record<PlaceTypeT, string> = {
  beach: "🏖️",
  trail: "🌲",
  heritage: "",
  walkway: "🚶",
  ranch: "🐄",
  cable_car: "🚡",
  cafe: "☕",
  restaurant: "🍜",
  stay: "🏨",
  convention: "🏢",
  cinema: "🎬",
  port: "⚓",
  workshop: "🧶",
  square: "🏙️",
  library: "📚",
  bookstore: "📖",
  transit: "🚏",
  park: "🌳",
  cultural_center: "🎭",
  filming_set: "🎥",
};

export function placeTypeIcon(placeType: PlaceTypeT | undefined): string {
  if (placeType === undefined) return PLACE_TYPE_FALLBACK_ICON;
  return PLACE_TYPE_ICON[placeType];
}
