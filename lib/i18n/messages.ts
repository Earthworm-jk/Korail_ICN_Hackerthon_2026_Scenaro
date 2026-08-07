/**
 * 화면 문구 — 처음부터 ko/en 번역 객체로 분리 (#4 최종 결정, NFR-I18N-001)
 * 핵심 데모 경로 문구는 ko/en 모두 필수이며 키 누락은 테스트가 실패시킨다.
 * 컴포넌트에 문구를 하드코딩하지 않는다.
 */
export const messages = {
  ko: {
    "app.title": "씬나로",
    "app.tagline": "당신의 시나리오대로 갑니다.",
    "search.actor.placeholder": "배우 이름으로 검색",
    "search.work.placeholder": "드라마·영화 제목으로 검색",
    "itinerary.estimateLabel": "추정치",
    "itinerary.recalculated": "일정을 다시 계산했습니다",
  },
  en: {
    "app.title": "SCENARO",
    "app.tagline": "Your scenario, your route.",
    "search.actor.placeholder": "Search by actor name",
    "search.work.placeholder": "Search by drama or film title",
    "itinerary.estimateLabel": "Estimated",
    "itinerary.recalculated": "Your itinerary has been recalculated",
  },
} as const;

export type Locale = keyof typeof messages;
export type MessageKey = keyof (typeof messages)["ko"];

export function t(locale: Locale, key: MessageKey): string {
  return messages[locale][key];
}
