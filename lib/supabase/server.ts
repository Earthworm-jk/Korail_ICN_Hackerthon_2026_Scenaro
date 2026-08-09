/**
 * Supabase 서버 클라이언트 (#25 확정: Auth + saved_itineraries + RLS)
 *
 * - 쿠키 세션 기반 @supabase/ssr — 브라우저에 세션이 있어도 액션은 항상
 *   서버에서 사용자를 재검증한다 (#36 리뷰 후속 조건).
 * - env 미설정이면 null — 앱은 in-memory 스텁(#35)으로 폴백한다 (오프라인 데모 안전망,
 *   NFR-DEMO-001과 같은 원칙). anon 키는 공개 가능한 클라이언트 키이며 RLS가 접근을 통제한다.
 */
import "server-only";

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export type SupabaseConfig = { url: string; anonKey: string };

/** 순수 파서 — 공백·빈 문자열은 미설정으로 정규화 (lib/env.ts 규칙과 동일) */
export function supabaseConfig(
  source: Record<string, string | undefined> = process.env,
): SupabaseConfig | null {
  const url = source.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = source.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  return url && anonKey ? { url, anonKey } : null;
}

export async function createSupabaseServerClient() {
  const config = supabaseConfig();
  if (!config) return null;
  const cookieStore = await cookies();
  return createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Component 렌더 중에는 쿠키 쓰기가 금지된다 — 세션 갱신은 액션 경로에서만
        }
      },
    },
  });
}
