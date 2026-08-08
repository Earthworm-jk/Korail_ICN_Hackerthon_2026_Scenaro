import { describe, expect, it } from "vitest";
import { messages } from "../i18n/messages";
import { formatFlightStatus } from "../flight-status";
import { planItinerary } from "../actions/itinerary";

// PR #59 리뷰 1 — 영어 핵심 경로에 한국어 완성 문자열이 남지 않는 회귀 가드.
// 엔진·메시지가 문장을 미리 조립하지 않고 구조화된 값만 내리는 계약을 고정한다.

const HANGUL = /[가-힣]/;

describe("영어 경로 한국어 잔류 회귀", () => {
  it("en 메시지 전체에 한글이 없다", () => {
    for (const [key, value] of Object.entries(messages.en)) {
      expect(HANGUL.test(value), `en.${key}: ${value}`).toBe(false);
    }
  });

  it("엔진 일정 결과(days)에 완성 문장이 없다 — 장소·역 이름은 ID로만 참조된다", async () => {
    const res = await planItinerary({
      arrivalAt: "2026-08-12T10:00:00+09:00",
      departureAt: "2026-08-14T18:00:00+09:00",
      airportReadyAt: "2026-08-12T12:00:00+09:00",
      airportArrivalDeadline: "2026-08-14T16:00:00+09:00",
      selectedActorIds: ["actor-kim-go-eun"],
      selectedWorkIds: [],
      excludedPlaceIds: [],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // days에는 ID·시각·숫자만 있어야 한다. 한글이 나오면 UI locale을 우회하는 값이다.
    expect(HANGUL.test(JSON.stringify(res.result.days))).toBe(false);
  });

  it("항공 상태는 매핑 문구만 표시하고 매핑 불가 원문은 영어에서 숨긴다", () => {
    expect(formatFlightStatus("en", "지연")).toBe("Delayed");
    expect(formatFlightStatus("ko", "지연")).toBe("지연");
    expect(formatFlightStatus("en", "게이트변경")).toBeNull(); // 미매핑 원문
    expect(formatFlightStatus("ko", "게이트변경")).toBe("게이트변경");
    expect(formatFlightStatus("en", undefined)).toBeNull();
  });
});
