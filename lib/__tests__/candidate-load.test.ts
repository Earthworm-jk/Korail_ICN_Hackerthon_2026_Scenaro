import { describe, expect, it } from "vitest";
import {
  candidateResponseIsCurrent,
  loadCandidateContext,
  planContextIsStale,
} from "../candidate-load";
import { planContextKey, stepReachable } from "../itinerary-command-ui";

/**
 * 비동기 후보 로드의 컨텍스트 격리 (#207 3번 · PR #211 리뷰).
 *
 * 이 파일의 시나리오는 리뷰가 요구한 두 회귀다:
 * 1. 후보 요청 A가 진행 중일 때 선택이 B로 바뀌면, A의 응답이 나중에 와도
 *    후보·일정·Step 3 진입 어느 것도 적용되지 않는다
 * 2. 후보 재조회에 실패한 재열람 일정에서 칩을 바꾸면 3단계 표시가 잠긴다
 */

type Data = { candidates: string[] };
type Action = { ok: boolean; placed: string[] };

/** 밖에서 시점을 조종할 수 있는 지연 응답 */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe("낡은 후보 응답은 아무것도 적용하지 않는다 (PR #211 리뷰 1)", () => {
  it("후보 조회 중 컨텍스트가 바뀌면 stale — plan도 표시 전이도 시작하지 않는다", async () => {
    const context = { current: planContextKey(["kim-tae-ri", "kim-go-eun"], []) };
    const submitted = context.current;
    const fetch = deferred<Data>();
    let planCalls = 0;
    let planStarted = false;

    const outcome = (async () => loadCandidateContext<Data, Action>({
      isCurrent: () => context.current === submitted,
      fetchCandidates: () => fetch.promise,
      candidateIds: (data) => data.candidates,
      planFor: async (_, ids) => { planCalls += 1; return { ok: true, placed: [...ids] }; },
      nextSelectedIds: () => null,
      onPlanStart: () => { planStarted = true; },
    }))();

    // 요청이 하늘에 떠 있는 동안 김태리를 뺐다 — 이제 이 응답의 화면은 없다
    context.current = planContextKey(["kim-go-eun"], []);
    fetch.resolve({ candidates: ["a", "b"] });

    expect(await outcome).toEqual({ kind: "stale" });
    expect(planCalls).toBe(0);
    expect(planStarted).toBe(false);
  });

  it("plan 응답 대기 중 컨텍스트가 바뀌어도 stale — 수렴 결과를 돌려주지 않는다", async () => {
    const context = { current: "A" };
    const plan = deferred<Action>();

    const outcome = (async () => loadCandidateContext<Data, Action>({
      isCurrent: () => context.current === "A",
      fetchCandidates: async () => ({ candidates: ["a", "b"] }),
      candidateIds: (data) => data.candidates,
      planFor: () => plan.promise,
      nextSelectedIds: () => null,
    }))();

    context.current = "B";
    plan.resolve({ ok: true, placed: ["a"] });

    expect(await outcome).toEqual({ kind: "stale" });
  });

  it("plan이 던졌더라도 컨텍스트가 바뀌었으면 실패 화면조차 열지 않는다", async () => {
    const context = { current: "A" };
    const outcome = await loadCandidateContext<Data, Action>({
      isCurrent: () => context.current === "A",
      fetchCandidates: async () => ({ candidates: ["a"] }),
      candidateIds: (data) => data.candidates,
      planFor: async () => { context.current = "B"; throw new Error("plan failed"); },
      nextSelectedIds: () => null,
    });
    expect(outcome).toEqual({ kind: "stale" });
  });

  /**
   * 순번 발급이 시작 시점이어야 하는 이유 — 후보 조회 뒤에 발급하면 먼저 출발한
   * 요청이 "마지막 요청"으로 둔갑한다. 발급을 호출부가 맡으므로 판정 함수로 잠근다.
   */
  it("같은 칩으로 연타해도 먼저 출발한 요청은 낡은 순번으로 판정된다", () => {
    const key = planContextKey(["kim-go-eun"], []);
    // 요청 1이 순번 1, 요청 2가 순번 2를 시작 시점에 받았다
    expect(candidateResponseIsCurrent({
      submittedSequence: 1, currentSequence: 2,
      submittedContextKey: key, currentContextKey: key,
    })).toBe(false);
    expect(candidateResponseIsCurrent({
      submittedSequence: 2, currentSequence: 2,
      submittedContextKey: key, currentContextKey: key,
    })).toBe(true);
  });

  it("순번이 그대로여도 칩이 바뀌었으면 낡은 응답이다", () => {
    expect(candidateResponseIsCurrent({
      submittedSequence: 3, currentSequence: 3,
      submittedContextKey: planContextKey(["kim-tae-ri", "kim-go-eun"], []),
      currentContextKey: planContextKey(["kim-go-eun"], []),
    })).toBe(false);
  });
});

describe("후보 로드 수렴 계약 — 화면과 같은 모양", () => {
  it("부분 배치면 그 장소만으로 다시 계산해 고정점에 도달한다", async () => {
    const planLog: string[][] = [];
    const outcome = await loadCandidateContext<Data, Action>({
      isCurrent: () => true,
      fetchCandidates: async () => ({ candidates: ["a", "b", "c"] }),
      candidateIds: (data) => data.candidates,
      planFor: async (_, ids) => {
        planLog.push([...ids]);
        // 엔진이 c를 배치하지 못했다
        return { ok: true, placed: [...ids].filter((id) => id !== "c") };
      },
      nextSelectedIds: (current, action) => {
        if (!action.ok) return null;
        const next = action.placed;
        const same = next.length === current.length && next.every((id, i) => id === current[i]);
        return same ? null : next;
      },
    });

    expect(outcome.kind).toBe("settled");
    if (outcome.kind !== "settled") return;
    expect(outcome.selectedIds).toEqual(["a", "b"]);
    expect(planLog).toEqual([["a", "b", "c"], ["a", "b"]]);
  });

  it("plan이 던지면 후보 전체 선택의 실패 결과를 돌려준다", async () => {
    const outcome = await loadCandidateContext<Data, Action>({
      isCurrent: () => true,
      fetchCandidates: async () => ({ candidates: ["a", "b"] }),
      candidateIds: (data) => data.candidates,
      planFor: async () => { throw new Error("boom"); },
      nextSelectedIds: () => null,
    });
    expect(outcome).toEqual({
      kind: "failed",
      data: { candidates: ["a", "b"] },
      allCandidateIds: ["a", "b"],
    });
  });
});

describe("오프라인 재열람의 컨텍스트 격리 (PR #211 리뷰 2)", () => {
  const savedKey = planContextKey(["kim-tae-ri", "kim-go-eun"], ["work-x"]);

  /**
   * 재열람은 저장 일정을 먼저 열고 후보 재조회는 실패할 수 있다. 그때 후보가 없다는
   * 이유로 stale이 영구 false면, 칩을 바꾼 채 3단계 표시로 저장 일정에 재진입한다.
   * 판정은 후보 유무가 아니라 **키의 존재와 일치**만 본다.
   */
  it("후보 재조회가 실패해도(후보 없음) 칩이 바뀌면 stale이다", () => {
    const changedKey = planContextKey(["kim-go-eun"], ["work-x"]);
    expect(planContextIsStale(savedKey, changedKey)).toBe(true);
    // 화면 조합: 재열람으로 furthestStep이 3이어도 3단계 표시가 잠긴다
    expect(stepReachable({ target: 3, furthestStep: 3, planContextStale: true })).toBe(false);
  });

  it("칩이 저장 당시와 같으면 stale이 아니다 — 재조회 실패만으로 잠그지 않는다", () => {
    expect(planContextIsStale(savedKey, savedKey)).toBe(false);
  });

  it("아직 어떤 컨텍스트도 불러온 적 없으면 stale이 아니다", () => {
    expect(planContextIsStale(null, planContextKey(["kim-go-eun"], []))).toBe(false);
  });
});
