"use server";
/**
 * 계정 액션 (#25 확정: 관리형 이메일+비밀번호, lazy login) — API_SPEC 3.2
 *
 * - 모든 액션은 서버에서 세션을 재검증한다(getUser — #36 리뷰 후속 조건).
 * - env 미설정이면 NOT_CONFIGURED — UI는 in-memory 스텁(#35)으로 폴백한다.
 * - 실패 사유는 코드로만 내려주고 원문 오류는 서버 로그에만 남긴다 (영어 경로 한글 규칙과 동일 원칙).
 */
import { createSupabaseServerClient, supabaseConfig } from "../supabase/server";

export type AuthActionResult =
  | { ok: true }
  | { ok: false; reason: "NOT_CONFIGURED" | "AUTH_FAILED" };

export type AccountStatus = {
  configured: boolean;
  authenticated: boolean;
};

export async function getAccountStatus(): Promise<AccountStatus> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { configured: false, authenticated: false };
  const { data } = await supabase.auth.getUser(); // 쿠키 신뢰 금지 — 서버 재검증
  return { configured: true, authenticated: data.user !== null };
}

export async function signIn(email: string, password: string): Promise<AuthActionResult> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false, reason: "NOT_CONFIGURED" };
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    console.error("signIn 실패:", error.code ?? error.message);
    return { ok: false, reason: "AUTH_FAILED" };
  }
  return { ok: true };
}

export async function signUp(email: string, password: string): Promise<AuthActionResult> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false, reason: "NOT_CONFIGURED" };
  const { data, error } = await supabase.auth.signUp({ email, password });
  // 데모 프로젝트는 이메일 확인을 끈다(supabase/README.md) — 세션이 없으면 가입 실패로 취급
  if (error || !data.session) {
    if (error) console.error("signUp 실패:", error.code ?? error.message);
    return { ok: false, reason: "AUTH_FAILED" };
  }
  return { ok: true };
}

export async function signOutAccount(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return;
  await supabase.auth.signOut();
}

/** 순수 설정 판별 — 테스트용 재노출 없이 액션 계층에서 한 번만 감싼다 */
export async function isAccountConfigured(): Promise<boolean> {
  return supabaseConfig() !== null;
}
