/**
 * 환경변수 파서 (Zod)
 *
 * 범위(PR #15 리뷰로 정정): 이 모듈은 **모듈 로드 시 파싱**되는 파서 기반을 제공한다.
 * 아직 앱 진입 경로에 연결되어 있지 않으며, P1 항공 어댑터가 import하는 시점부터
 * 실효한다. 서버 시작 경로에 강제 연결할지는 어댑터 도입 PR에서 결정한다.
 *
 * AIRPORT_API_KEY는 의도적으로 optional이다: 키가 없으면 앱이 죽는 게 아니라
 * 항공 어댑터가 스냅샷 모드로 동작해야 한다(NFR-DEMO-001 오프라인 데모,
 * REQ-DATA-003 폴백). 공백·빈 문자열 키는 없는 것으로 정규화한다.
 */
import { z } from "zod";

const EnvSchema = z.object({
  AIRPORT_API_KEY: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
});

export type Env = z.infer<typeof EnvSchema>;

/** 순수 파서 — 테스트와 운영이 같은 코드 경로를 쓴다 */
export function parseEnv(source: Record<string, string | undefined>): Env {
  return EnvSchema.parse({
    AIRPORT_API_KEY: source.AIRPORT_API_KEY,
  });
}

/** 모듈 로드 시 1회 파싱된 운영 값 */
export const env: Env = parseEnv(process.env);

/** 항공 어댑터의 동작 모드 — live는 키가 있을 때만, 실패 시엔 언제나 스냅샷 폴백 */
export function flightMode(e: Env = env): "live" | "snapshot" {
  return e.AIRPORT_API_KEY ? "live" : "snapshot";
}
