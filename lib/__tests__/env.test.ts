import { describe, expect, it } from "vitest";
import { parseEnv, flightMode, searchInterpretationMode } from "../env";

// 운영 코드의 parseEnv를 직접 검증한다 — 외부 환경(process.env)에 의존하지 않는 결정적 테스트
describe("환경변수 파서 (운영 EnvSchema 직접 검증)", () => {
  it("키 누락 → undefined, snapshot 모드 (NFR-DEMO-001)", () => {
    const e = parseEnv({});
    expect(e.AIRPORT_API_KEY).toBeUndefined();
    expect(flightMode(e)).toBe("snapshot");
  });

  it("공백 키 → undefined, snapshot 모드", () => {
    const e = parseEnv({ AIRPORT_API_KEY: "   " });
    expect(e.AIRPORT_API_KEY).toBeUndefined();
    expect(flightMode(e)).toBe("snapshot");
  });

  it("실제 키 → trim된 값, live 모드", () => {
    const e = parseEnv({ AIRPORT_API_KEY: "  real-key  " });
    expect(e.AIRPORT_API_KEY).toBe("real-key");
    expect(flightMode(e)).toBe("live");
  });

  it("OpenAI 키는 optional이며 공백이면 결정적 검색 모드다", () => {
    expect(searchInterpretationMode(parseEnv({}))).toBe("deterministic");
    expect(searchInterpretationMode(parseEnv({ OPENAI_API_KEY: "   " }))).toBe("deterministic");
  });

  it("OpenAI 키가 있으면 검색 해석 live 모드다", () => {
    const e = parseEnv({ OPENAI_API_KEY: "  sk-test  " });
    expect(e.OPENAI_API_KEY).toBe("sk-test");
    expect(searchInterpretationMode(e)).toBe("live");
  });
});
