/**
 * 저장·목록 의도를 어디로 보낼지 판단 (#118 P0-3, PR #123 리뷰 3) — 순수 함수
 *
 * `lib/auto-plan.ts`와 같은 이유로 훅 밖에 둔다. 조건이 `useSaveStub` 안에 흩어져 있으면
 * "계정 상태를 확인하는 중에 저장을 누르면 어디에 저장되는가" 같은 전이를 테스트로 고정할
 * 수 없다. 무엇을 할지만 여기서 정하고 훅은 그 결정을 실행한다.
 *
 * 핵심은 `loading`이 로컬과 **구분돼야 한다**는 것이다. `?cloud=1`로 계정 상태를 조회하는
 * 동안에는 저장 위치가 아직 정해지지 않았다. 그때 로컬로 흘려보내면 클라우드를 요청했는데도
 * 로컬에 저장되고, 곧이어 mode만 supabase로 바뀌어 화면과 저장 위치가 어긋난다.
 */
export type StorageMode = "loading" | "local" | "supabase";

export type IntentRouting =
  /** 아직 판단할 수 없다 — 의도를 담아 두고 mode가 확정되면 다시 부른다 */
  | "queue"
  /** 브라우저 로컬 저장소 */
  | "local"
  /** 계정(Supabase) 경로 */
  | "cloud"
  /** 계정 경로인데 인증이 없다 — lazy login 모달 */
  | "login";

function route(mode: StorageMode, authenticated: boolean): IntentRouting {
  if (mode === "loading") return "queue";
  if (mode !== "supabase") return "local";
  return authenticated ? "cloud" : "login";
}

/** 저장 버튼 */
export function routeSaveIntent(mode: StorageMode, authenticated: boolean): IntentRouting {
  return route(mode, authenticated);
}

/** "내 일정" 열기 — 판단 규칙은 저장과 같다 */
export function routeTripsIntent(mode: StorageMode, authenticated: boolean): IntentRouting {
  return route(mode, authenticated);
}
