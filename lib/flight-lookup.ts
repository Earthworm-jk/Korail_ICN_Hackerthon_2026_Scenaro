/**
 * 항공편 조회의 상태 전이 (PR #205 리뷰)
 *
 * 순수 모듈이다. 화면 안에 전이를 늘어놓으면 "실패했는데 이전 배지가 남는다",
 * "늦게 온 응답이 새 입력을 되돌린다" 같은 경계를 테스트로 고정할 수 없다.
 * 조율 명령이 `commandResponseIsCurrent`로 늦은 응답을 버리는 것과 같은 규율이다.
 */

export type FlightFieldState = {
  flightNo: string;
  at: string;
  notFound: boolean;
  /** 조회 자체가 실패했다 — 편명이 없는 것(notFound)과 구분한다 */
  lookupFailed?: boolean;
  source?: "live" | "snapshot";
  status?: string;
  terminal?: string;
};

export type FlightLookupResult = {
  source: "live" | "snapshot";
  status?: string;
  terminal?: string;
};

/**
 * 이 응답을 화면에 반영해도 되는가.
 *
 * 조회는 최대 5초가 걸리고 그동안 사용자는 편명·시각을 계속 고칠 수 있다. 입력이 바뀌면
 * 순번을 올려 **그 전에 나간 요청의 응답을 버린다.** 버리지 않으면 늦게 온 옛 응답이
 * 새 입력을 예전 값으로 되돌리고 시각까지 덮는다.
 */
export function flightLookupIsCurrent(sequence: number, current: number): boolean {
  return sequence === current;
}

/** 조회 성공 — 이전 실패·미검색 흔적을 지우고 이번 결과로 바꾼다 */
export function flightFieldAfterSuccess(
  previous: FlightFieldState,
  result: FlightLookupResult,
): FlightFieldState {
  return {
    ...previous,
    notFound: false,
    lookupFailed: false,
    source: result.source,
    status: result.status,
    terminal: result.terminal,
  };
}

/** 정상 응답이지만 그 편이 없다 — 사용자는 시각을 직접 넣으면 된다 */
export function flightFieldAfterNotFound(previous: FlightFieldState): FlightFieldState {
  return {
    ...previous,
    notFound: true,
    lookupFailed: false,
    source: undefined,
    status: undefined,
    terminal: undefined,
  };
}

/**
 * 조회 자체가 실패했다 — 사용자는 다시 누르거나 시각을 직접 넣어야 한다.
 *
 * **이전 성공의 배지·운항 상태를 반드시 지운다.** 남겨 두면 "지금 조회하지 못했습니다"와
 * "실시간 조회 · 항공데이터"가 한 화면에 같이 떠서 방금 받아온 정보처럼 읽힌다.
 */
export function flightFieldAfterFailure(previous: FlightFieldState): FlightFieldState {
  return {
    ...previous,
    notFound: false,
    lookupFailed: true,
    source: undefined,
    status: undefined,
    terminal: undefined,
  };
}

/**
 * 편명을 고쳤다 — 이전 편명에 붙어 있던 결과를 전부 떼어 낸다.
 *
 * 문구만 지우고 배지를 남기면 바뀐 편명 옆에 옛 편의 운항 정보가 붙어 있게 된다.
 */
export function flightFieldAfterFlightNoEdit(
  previous: FlightFieldState,
  flightNo: string,
): FlightFieldState {
  return {
    ...previous,
    flightNo,
    notFound: false,
    lookupFailed: false,
    source: undefined,
    status: undefined,
    terminal: undefined,
  };
}

// ---------------------------------------------------------------------------
// 조회 진행 상태 조율 (PR #205 재리뷰)
//
// 순번만으로는 부족했다. 성공 응답의 시각 반영이 자기 요청의 순번을 올려 버려서
// `finally`가 자기 pending을 해제하지 못했고, 버튼이 "조회 중…"에 굳었다.
// 진행 상태를 순번과 함께 한 값으로 다루면 그 어긋남이 생길 자리가 없다.
// ---------------------------------------------------------------------------

export type LookupDirection = "arrival" | "departure";

export type LookupPending = { direction: LookupDirection; sequence: number } | null;

export type LookupCoordinator = {
  /** 마지막으로 시작되거나 무효화된 순번 */
  sequence: number;
  /** 지금 화면이 "조회 중"으로 보여야 하는 요청 */
  pending: LookupPending;
};

export const initialLookupCoordinator: LookupCoordinator = { sequence: 0, pending: null };

/** 조회를 시작한다 — 이 순번을 응답 대조에 쓴다 */
export function startLookup(
  state: LookupCoordinator,
  direction: LookupDirection,
): { state: LookupCoordinator; sequence: number } {
  const sequence = state.sequence + 1;
  return { state: { sequence, pending: { direction, sequence } }, sequence };
}

/**
 * 사용자가 편명·시각을 고쳤다 — 진행 중 요청의 응답을 버린다.
 *
 * **진행 표시도 함께 끈다.** 새 요청이 시작된 게 아니라 옛 요청이 쓸모없어진 것이라,
 * 켜 둔 채로 두면 아무도 그것을 끄지 않는다. 옛 요청의 `settleLookup`은 이미 stale이라
 * 지나가고, 버튼은 잠긴 채로 남아 다시 조회할 수도 없다.
 */
export function invalidateLookup(state: LookupCoordinator): LookupCoordinator {
  return { sequence: state.sequence + 1, pending: null };
}

/** 이 응답을 화면에 반영해도 되는가 */
export function acceptsLookupResponse(state: LookupCoordinator, sequence: number): boolean {
  return flightLookupIsCurrent(sequence, state.sequence);
}

/**
 * 요청이 끝났다 — **자기 진행 표시만** 끈다.
 *
 * 그 사이 새 조회가 시작됐다면 지금 켜져 있는 것은 그 요청의 표시다. 옛 요청이 그것을
 * 끄면 도는 중인데 버튼이 풀린다.
 */
export function settleLookup(state: LookupCoordinator, sequence: number): LookupCoordinator {
  if (state.pending?.sequence !== sequence) return state;
  return { ...state, pending: null };
}
