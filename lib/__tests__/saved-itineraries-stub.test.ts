import { describe, expect, it } from "vitest";
import { defaultSavedTitle } from "../saved-itineraries-stub";

// #25 §6 기본 제목 규칙의 스텁 버전 — 기간·박수·대표 콘텐츠 조합

describe("defaultSavedTitle", () => {
  it("ko — 기간·박수·대표 콘텐츠를 조합한다", () => {
    expect(
      defaultSavedTitle("2026-08-12T10:00:00+09:00", "2026-08-14T18:00:00+09:00", "김고은", "ko"),
    ).toBe("8. 12.-8. 14. · 2박 3일 · 김고은");
  });

  it("en — 영문 날짜 형식을 쓴다", () => {
    expect(
      defaultSavedTitle("2026-08-12T10:00:00+09:00", "2026-08-14T18:00:00+09:00", "Kim Go-eun", "en"),
    ).toBe("Aug 12-Aug 14 · 3 days · Kim Go-eun");
  });

  it("콘텐츠가 없으면 기간·박수만", () => {
    expect(
      defaultSavedTitle("2026-08-12T10:00:00+09:00", "2026-08-14T18:00:00+09:00", null, "ko"),
    ).toBe("8. 12.-8. 14. · 2박 3일");
  });

  it("KST 자정 경계 — UTC 표기라도 KST 날짜로 박수를 센다", () => {
    // KST 08-13 00:30 도착(= UTC 08-12 15:30) → 08-14 출국은 1박
    expect(
      defaultSavedTitle("2026-08-12T15:30:00.000Z", "2026-08-14T09:00:00.000Z", null, "ko"),
    ).toBe("8. 13.-8. 14. · 1박 2일");
  });
});
