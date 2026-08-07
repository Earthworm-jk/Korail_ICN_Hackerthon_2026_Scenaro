/**
 * 환경변수 — 기동 시 Zod 검증 (시드 검증과 같은 원칙: 런타임 중이 아니라 시작할 때 실패)
 *
 * AIRPORT_API_KEY는 의도적으로 optional이다: 키가 없으면 앱이 죽는 게 아니라
 * 항공 어댑터가 스냅샷 모드로 동작해야 한다(NFR-DEMO-001 오프라인 데모, REQ-DATA-003 폴백).
 * 대신 형식이 이상한 값(공백 등)은 여기서 걸러 시작 시점에 발견한다.
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

export const env: Env = EnvSchema.parse({
  AIRPORT_API_KEY: process.env.AIRPORT_API_KEY,
});

/** 항공 어댑터의 동작 모드 — live는 키가 있을 때만, 실패 시엔 언제나 스냅샷 폴백 */
export function flightMode(): "live" | "snapshot" {
  return env.AIRPORT_API_KEY ? "live" : "snapshot";
}
