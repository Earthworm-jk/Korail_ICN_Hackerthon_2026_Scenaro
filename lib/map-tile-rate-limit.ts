/**
 * 배경 타일 프록시 요청 상한 (PR #164 리뷰 · 공개 프록시 보호).
 *
 * 프록시는 배포되는 공개 경로이고 키는 우리 것이다. 누가 이 경로를 훑으면 **우리 쿼터를
 * 대신 소모한다.** 좌표 범위 제한(`tileServesMap`)이 훑을 수 있는 넓이를 줄이고, 이 상한이
 * 같은 넓이를 반복해서 긁는 것을 줄인다 — 둘은 다른 구멍을 막는다.
 *
 * ## 무엇을 지키고 무엇을 못 지키는가
 *
 * 인스턴스 메모리에만 둔다. 서버리스에서는 인스턴스가 여러 개일 수 있으므로 **전역 상한이
 * 아니라 인스턴스별 상한**이고, 그만큼 느슨하다. 그걸 감수하는 이유는 정확한 전역 상한을
 * 하려면 외부 저장소가 필요한데, 그건 지금 막으려는 문제보다 범위가 큰 작업이기 때문이다
 * (디스크 캐시가 서버리스에서 안 되는 것과 같은 이유다).
 *
 * **막으려는 것은 남의 스크래핑이지 우리 사용자가 아니다.** 그래서 호출자별로 센다 — 한 명이
 * 긁어도 다른 사람의 몫은 남는다. 시연장에서 심사위원 여럿이 동시에 열어도 서로를 막지 않는다.
 *
 * 상한은 한 화면이 12-20장이라는 실측을 기준으로 넉넉히 잡았다. 지도를 계속 움직여도
 * 정상 사용이 걸리지 않는 값이어야 한다 — 걸리면 배경이 빠지고 원인은 화면에 안 보인다.
 */

/** 세는 구간 */
export const RATE_WINDOW_MS = 60_000;
/** 한 호출자가 한 구간에 받을 수 있는 타일 수 — 한 화면 12-20장 기준으로 넉넉히 */
export const RATE_LIMIT_PER_WINDOW = 240;

/** 메모리가 무한히 늘지 않게 — 이보다 많아지면 만료된 것부터 버린다 */
const MAX_TRACKED_CALLERS = 5_000;

type Window = { count: number; startedAt: number };

const windows = new Map<string, Window>();

/**
 * 호출자 식별 — 프록시 뒤라 소켓 주소가 아니라 전달 헤더를 본다.
 *
 * 헤더는 위조할 수 있다. 그래도 쓰는 이유는 이 상한이 인증이 아니라 **비용 방어**이기
 * 때문이다. 매 요청마다 헤더를 바꾸는 상대까지 막으려면 인증이 필요하고, 그건 공개 배경
 * 지도에 맞는 무게가 아니다. 값이 없으면 한 덩어리로 묶어 센다 — 최소한 무제한은 아니다.
 */
export function callerKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first && first.length > 0 ? first : "unknown";
}

function prune(now: number): void {
  for (const [key, window] of windows) {
    if (now - window.startedAt >= RATE_WINDOW_MS) windows.delete(key);
  }
}

/**
 * 이번 요청을 세고, 상한을 넘었는지 답한다.
 *
 * 넘은 요청은 세지 않는다 — 계속 두드리는 상대의 구간이 영원히 갱신되면 정상 사용자가
 * 돌아올 자리도 같이 사라진다.
 */
export function overRateLimit(request: Request, now: number = Date.now()): boolean {
  const key = callerKey(request);
  const window = windows.get(key);

  if (window === undefined || now - window.startedAt >= RATE_WINDOW_MS) {
    if (windows.size >= MAX_TRACKED_CALLERS) prune(now);
    windows.set(key, { count: 1, startedAt: now });
    return false;
  }

  if (window.count >= RATE_LIMIT_PER_WINDOW) return true;
  window.count += 1;
  return false;
}

/** 남은 구간(초) — `Retry-After`에 넣는다 */
export function secondsUntilReset(request: Request, now: number = Date.now()): number {
  const window = windows.get(callerKey(request));
  if (window === undefined) return 0;
  return Math.max(0, Math.ceil((window.startedAt + RATE_WINDOW_MS - now) / 1000));
}

/** 테스트에서 구간을 비운다 — 프로덕션 경로에서는 부르지 않는다 */
export function resetRateLimit(): void {
  windows.clear();
}
