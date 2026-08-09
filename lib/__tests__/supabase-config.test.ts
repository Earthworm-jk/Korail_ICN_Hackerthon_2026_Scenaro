import { describe, expect, it } from "vitest";
import { supabaseConfig } from "../supabase/server";

// #35 폴백 계약 — env 미설정·공백이면 스텁 모드, 두 값이 모두 있어야 실연결

describe("supabaseConfig", () => {
  it("두 값이 모두 있어야 설정으로 인정한다", () => {
    expect(supabaseConfig({})).toBeNull();
    expect(supabaseConfig({ NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co" })).toBeNull();
    expect(supabaseConfig({ NEXT_PUBLIC_SUPABASE_ANON_KEY: "key" })).toBeNull();
    expect(supabaseConfig({
      NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "key",
    })).toEqual({ url: "https://x.supabase.co", anonKey: "key" });
  });

  it("공백·빈 문자열은 미설정으로 정규화한다 (lib/env.ts 규칙)", () => {
    expect(supabaseConfig({
      NEXT_PUBLIC_SUPABASE_URL: "  ",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "key",
    })).toBeNull();
  });
});
