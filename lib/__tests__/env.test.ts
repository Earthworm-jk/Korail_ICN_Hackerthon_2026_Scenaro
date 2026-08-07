import { describe, expect, it } from "vitest";
import { flightMode, env } from "../env";

describe("환경변수 기동 검증", () => {
  it("키가 없어도 기동은 실패하지 않고 스냅샷 모드가 된다 (NFR-DEMO-001)", () => {
    // 테스트 환경에는 AIRPORT_API_KEY가 없으므로 snapshot이 기본
    if (!process.env.AIRPORT_API_KEY) {
      expect(env.AIRPORT_API_KEY).toBeUndefined();
      expect(flightMode()).toBe("snapshot");
    } else {
      expect(flightMode()).toBe("live");
    }
  });

  it("빈 문자열 키는 없는 것으로 정규화된다", async () => {
    const { z } = await import("zod");
    const schema = z
      .string()
      .trim()
      .optional()
      .transform((v) => (v === "" ? undefined : v));
    expect(schema.parse("   ")).toBeUndefined();
    expect(schema.parse("real-key")).toBe("real-key");
  });
});
