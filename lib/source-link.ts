/**
 * 출처 문자열에서 링크 분리 (#5 출처 표기)
 *
 * 시드의 `openingHours.source`는 사람이 읽는 설명과 URL이 한 문자열에 섞여 있다.
 *   "한국관광공사 VISITKOREA 영진해변 24시간 개방 https://english.visitkorea.or.kr/..."
 * 화면에 URL을 그대로 뿌리면 카드가 도메인 문자열로 뒤덮인다. 설명만 보여주고 URL은
 * 링크 뒤로 숨긴다 — 출처를 없애는 게 아니라 눌러서 확인할 수 있게 옮기는 것이다.
 */

const URL_PATTERN = /https?:\/\/\S+/;

export type SourceParts = {
  /** URL을 뺀 사람이 읽는 설명 (없으면 빈 문자열) */
  label: string;
  /** 첫 번째 URL — 없으면 null */
  url: string | null;
};

export function splitSourceLink(source: string): SourceParts {
  const match = source.match(URL_PATTERN);
  const url = match ? match[0].replace(/[).,]+$/, "") : null; // 문장 끝 문장부호는 URL이 아니다
  const label = source.replace(URL_PATTERN, "").replace(/\s{2,}/g, " ").trim();
  return { label, url };
}
