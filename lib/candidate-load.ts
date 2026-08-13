/**
 * 후보 로드 한 사이클 — 조회·고정점 수렴·낡은 응답 폐기 (#207 3번 · PR #211 리뷰 1).
 *
 * 이 파일이 존재하는 이유는 **비동기 경계가 화면 밖에서 검증돼야 하기 때문**이다.
 * 컴포넌트 안에 있을 때는 "후보 요청이 진행 중일 때 칩이 바뀌면 어떻게 되는가"를
 * 테스트로 잡을 수 없었고, 실제로 두 구멍이 있었다:
 *
 * - 순번을 후보 조회 **뒤에** 발급해, 먼저 출발한 요청이 늦게 돌아와 **새 순번을
 *   배정받고** 오래된 배우 집합의 후보·일정으로 3단계를 직접 열었다
 * - 조회와 각 plan 응답 뒤에 컨텍스트를 확인하지 않아, 순번이 그대로면(재요청 없이
 *   칩만 바뀐 경우) 낡은 응답이 그대로 적용됐다
 *
 * 그래서 규율을 여기 고정한다: **모든 await 뒤에서 `isCurrent`를 확인하고, 거짓이면
 * 아무것도 반환하지 않고 `stale`로 끝난다.** 순번 발급을 시작 시점으로 옮기는 것은
 * 호출부의 한 줄이지만, 그 순번·컨텍스트를 언제 다시 확인하는가는 전부 여기다.
 *
 * 상태 커밋은 하지 않는다 — 결과를 돌려주고, 화면은 `stale`이 아닐 때만 반영한다.
 */

export type CandidateLoadOutcome<D, R> =
  /** 응답이 도착했을 때 이미 다른 요청·다른 칩 집합의 화면이다 — 아무것도 반영하지 않는다 */
  | { kind: "stale" }
  /** plan 호출이 던졌다 — 후보는 받았으므로 실패 화면도 후보 전체 선택으로 연다 */
  | { kind: "failed"; data: D; allCandidateIds: string[] }
  /** 고정점에 도달했다. action이 ok가 아닐 수 있다(invalid) — 그 분기는 화면 몫이다 */
  | { kind: "settled"; data: D; selectedIds: string[]; action: R };

export async function loadCandidateContext<D, R>(io: {
  /** 제출 순번·컨텍스트가 아직 현재인가 — 모든 await 뒤에서 다시 묻는다 */
  isCurrent: () => boolean;
  fetchCandidates: () => Promise<D>;
  candidateIds: (data: D) => string[];
  planFor: (data: D, selectedIds: readonly string[]) => Promise<R>;
  /**
   * 다음 수렴 단계의 선택. `null`이면 고정점(같은 선택이거나 더 좁힐 결과가 아님)이다.
   * "planned가 아니면 멈춘다" 판단도 이 함수가 갖는다 — 루프는 모양만 안다.
   */
  nextSelectedIds: (current: readonly string[], action: R) => string[] | null;
  /** 후보가 현재 화면으로 판정된 직후 한 번 — PLAN_START 같은 표시 전이를 여기서 건다 */
  onPlanStart?: () => void;
  /** 첫 계산 뒤 추가 수렴 횟수 — 화면의 기존 계약은 2다(최대 3회 안에서 고정점) */
  maxPasses?: number;
}): Promise<CandidateLoadOutcome<D, R>> {
  const data = await io.fetchCandidates();
  // 후보 조회가 끝났다고 이 응답의 화면이 남아 있다는 뜻이 아니다 (PR #211 리뷰 1)
  if (!io.isCurrent()) return { kind: "stale" };

  const allCandidateIds = io.candidateIds(data);
  io.onPlanStart?.();

  let selectedIds = allCandidateIds;
  try {
    let action = await io.planFor(data, selectedIds);
    if (!io.isCurrent()) return { kind: "stale" };

    for (let pass = 0, max = io.maxPasses ?? 2; pass < max; pass += 1) {
      const next = io.nextSelectedIds(selectedIds, action);
      if (next === null) break;
      selectedIds = next;
      action = await io.planFor(data, selectedIds);
      if (!io.isCurrent()) return { kind: "stale" };
    }

    return { kind: "settled", data, selectedIds, action };
  } catch {
    if (!io.isCurrent()) return { kind: "stale" };
    return { kind: "failed", data, allCandidateIds };
  }
}

/**
 * 제출한 후보 로드 응답이 아직 현재 화면을 대상으로 하는가 (PR #211 리뷰 1).
 *
 * 순번만으로는 부족하다 — 재요청 없이 칩만 바뀌면 순번이 그대로라 낡은 응답이
 * 통과한다. 컨텍스트만으로도 부족하다 — 같은 칩으로 `다음`을 연타하면 늦은 첫
 * 응답이 새 요청의 결과를 덮는다. 둘을 함께 본다.
 */
export function candidateResponseIsCurrent(input: {
  submittedSequence: number;
  currentSequence: number;
  submittedContextKey: string;
  currentContextKey: string;
}): boolean {
  return input.submittedSequence === input.currentSequence
    && input.submittedContextKey === input.currentContextKey;
}

/**
 * 3단계가 이전 계획 컨텍스트의 파생물인가 (#207 3번 · PR #211 리뷰 2).
 *
 * `candidateData !== null`을 전제로 삼지 않는다 — 재열람은 저장 일정을 먼저 열고
 * 후보 재조회는 실패할 수 있는데(오프라인 동작이 명시 계약이다), 그때 후보가 없다는
 * 이유로 stale이 영구 false가 되면 칩을 바꾼 채 저장 일정으로 재진입할 수 있었다.
 * 컨텍스트 키는 후보 조회 성공 여부와 무관하게 저장 레코드가 이미 알고 있으므로,
 * **키가 존재하고 지금 키와 다르면 stale**이다.
 */
export function planContextIsStale(
  loadedContextKey: string | null,
  currentContextKey: string,
): boolean {
  return loadedContextKey !== null && loadedContextKey !== currentContextKey;
}
