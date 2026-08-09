import { describe, expect, it } from "vitest";
import { supabaseConfig } from "../supabase/server";

// #35 폴백 계약 — env 미설정·공백이면 스텁 모드, 두 값이 모두 있어야 실연결

describe("supabaseConfig", () => {
  it("URL과 키가 모두 있어야 설정으로 인정한다", () => {
    expect(supabaseConfig({})).toBeNull();
    expect(supabaseConfig({ NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co" })).toBeNull();
    expect(supabaseConfig({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "key" })).toBeNull();
    expect(supabaseConfig({
      NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x",
    })).toEqual({ url: "https://x.supabase.co", key: "sb_publishable_x" });
  });

  it("publishable 키를 우선하고 legacy anon 키는 호환용이다 (PR #74 리뷰 1)", () => {
    expect(supabaseConfig({
      NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "legacy",
    })).toEqual({ url: "https://x.supabase.co", key: "sb_publishable_x" });
    expect(supabaseConfig({
      NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "legacy",
    })).toEqual({ url: "https://x.supabase.co", key: "legacy" });
  });

  it("공백·빈 문자열은 미설정으로 정규화한다 (lib/env.ts 규칙)", () => {
    expect(supabaseConfig({
      NEXT_PUBLIC_SUPABASE_URL: "  ",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "key",
    })).toBeNull();
    expect(supabaseConfig({
      NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "  ",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "legacy",
    })).toEqual({ url: "https://x.supabase.co", key: "legacy" });
  });
});
