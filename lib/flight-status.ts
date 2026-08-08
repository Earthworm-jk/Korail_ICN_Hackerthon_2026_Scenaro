/**
 * 항공 운항 상태 표시 (PR #59 리뷰 1)
 *
 * 인천공항 API의 remark는 한국어 원문 문자열이라 영어 화면에 그대로 내보내지 않는다.
 * 알려진 값만 ko/en 메시지로 매핑하고, 매핑할 수 없는 원문은 한국어 모드에서만
 * 원문 그대로, 영어 모드에서는 숨긴다(시각·출처 배지만 남는다).
 */
import { t, type Locale, type MessageKey } from "./i18n/messages";

const REMARK_KEY: Record<string, MessageKey> = {
  도착: "flight.status.arrived",
  착륙: "flight.status.landed",
  출발: "flight.status.departed",
  지연: "flight.status.delayed",
  결항: "flight.status.cancelled",
  회항: "flight.status.diverted",
  탑승중: "flight.status.boarding",
  탑승마감: "flight.status.boardingClosed",
  출발예정: "flight.status.scheduled",
  도착예정: "flight.status.scheduled",
};

export function formatFlightStatus(locale: Locale, remark: string | undefined): string | null {
  if (!remark) return null;
  const key = REMARK_KEY[remark.trim()];
  if (key) return t(locale, key);
  return locale === "ko" ? remark : null;
}
