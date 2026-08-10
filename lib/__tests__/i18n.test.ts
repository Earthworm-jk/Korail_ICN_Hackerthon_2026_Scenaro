import { describe, expect, it } from "vitest";
import { messages } from "../i18n/messages";

describe("번역 키 패리티 (#4 — 핵심 데모 경로 누락 0건)", () => {
  it("ko와 en의 키 집합이 완전히 일치한다", () => {
    const ko = Object.keys(messages.ko).sort();
    const en = Object.keys(messages.en).sort();
    expect(en).toEqual(ko);
  });

  it("빈 문자열 번역이 없다", () => {
    for (const locale of ["ko", "en"] as const) {
      for (const [key, value] of Object.entries(messages[locale])) {
        expect(value, `${locale}.${key}`).not.toBe("");
      }
    }
  });

  it("자동·수동 검토를 사람 검토로 뭉뚱그리지 않고 장면 근거로 표시한다 (#120 리뷰)", () => {
    expect(messages.ko["step3.aiReasonLabel"]).toBe("검증된 장면 근거");
    expect(messages.en["step3.aiReasonLabel"]).toBe("Verified scene evidence");
  });
});
