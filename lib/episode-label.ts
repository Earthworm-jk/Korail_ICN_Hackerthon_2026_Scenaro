/**
 * 회차 표기 locale 포맷 (#51 · PR #59 리뷰 1의 영어 경로 규칙 연장)
 *
 * episodeLabel은 시드의 한국어 표기("1화"·"1–2화"·"1화·14화")다. 영어 화면에는
 * 숫자부만 "Ep. N" 형태로 바꿔 표시하고, 숫자 패턴이 아닌 표기(특별편 등)는
 * 번역을 지어내지 않고 영어에서 숨긴다 — 작품명·장면 설명만 남는다 (A3).
 */
import type { Locale } from "./i18n/messages";

export function formatEpisodeLabel(locale: Locale, label: string | undefined): string | null {
  if (!label) return null;
  if (locale === "ko") return label;
  const stripped = label.replace(/화/g, "");
  return /^\d+(?:[–·-]\d+)*$/.test(stripped) ? `Ep. ${stripped}` : null;
}
