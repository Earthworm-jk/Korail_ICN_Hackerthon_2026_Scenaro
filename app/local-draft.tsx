"use client";
/**
 * 조율 중 초안 자동 저장·복구 훅 (#118 P0-3 레인 B)
 *
 * 저장 흐름은 PR #123에서 로컬로 옮겼지만, **조율 중 상태**는 아직 새로고침하면 사라진다.
 * 이 훅이 그 자리를 메운다 — 여행 조건과 선택이 바뀔 때마다 초안을 쓰고, 다음 방문에서
 * 되돌려준다.
 *
 * ## 왜 별도 파일인가
 *
 * 호출 지점은 `app/planner-wizard.tsx`(레인 A)이고 그 파일은 레인 B가 고치지 않는다.
 * 그래서 판단·타이머·저장을 전부 이 훅 안에 넣어 두고, 레인 A는 **호출 한 번**만 하면
 * 되게 했다 (#118 "필요한 props/함수 계약을 먼저 공유한다").
 *
 * ## 복구를 훅이 직접 하지 않는 이유
 *
 * 되돌리려면 위저드의 setter 여러 개가 필요하고 그건 레인 A의 상태다. 훅은 초안을 읽어
 * `onRestore`로 한 번 넘겨주기만 한다 — 무엇을 어떻게 되살릴지는 호출부가 정한다.
 *
 * ## 복구가 끝나기 전에는 쓰지 않는다 — 실패해도 열지 않는다
 *
 * 마운트 직후 화면은 아직 초기값이다. 그때 저장이 돌면 방금 읽은 초안을 빈 상태로
 * 덮어쓴다. 복구가 배우·작품·후보 재조회를 포함해 늦게 끝날 수 있으므로(오프라인이면 실패),
 * `onRestore`가 Promise를 돌려주면 그것이 **성공으로 끝날 때까지** 저장을 막는다.
 *
 * 실패하면 이번 마운트에서는 계속 막아 둔다 (PR #127 2차 리뷰). 실패했다는 것은 화면이
 * 초안대로 복원되지 않았다는 뜻이라, 거기서 저장을 열면 초기값·부분 상태가 원본을 덮는다 —
 * 오프라인에서 오히려 원본을 잃는 경로다.
 */
import { useEffect, useRef, useState } from "react";
import { clearDraft, loadDraft, saveDraft, type LocalDraft } from "@/lib/local-itineraries";
import {
  draftContentEquals,
  draftDecision,
  draftFromInput,
  restoreBlocksSave,
  type DraftInput,
  type RestoreState,
} from "@/lib/local-draft";

/**
 * 초안을 쓰기까지의 대기(ms).
 *
 * 날짜 입력은 타이핑 한 글자마다 상태가 바뀐다. 매번 쓰면 직렬화가 입력 지연으로 보인다.
 * 자동 재계산 대기(400ms, #85)보다 조금 길게 둬서 계산이 끝난 뒤 한 번만 쓰이게 한다.
 */
const DRAFT_DEBOUNCE_MS = 600;

export type UseLocalDraftOptions = DraftInput & {
  /**
   * 초안을 쓸 상태인가. **재열람 중에는 false를 넘긴다** — 저장된 일정을 보여주는 중에
   * 그 상태를 초안으로 덮으면, 새로고침했을 때 사용자가 만들던 조율이 아니라 저장해 둔
   * 일정이 복구된다.
   */
  enabled: boolean;
  /**
   * 마운트 직후 1회. 초안이 없거나 손상됐으면 호출되지 않는다.
   *
   * **필수다.** 없으면 훅이 화면을 복원할 방법이 없는데 자동 저장만 돌아 원본 초안을
   * 초기값으로 덮는다 (PR #127 2차 리뷰).
   *
   * **비동기 복구는 Promise를 돌려준다.** 성공으로 끝나야 자동 저장이 열린다. 거부하면
   * 이번 마운트에서는 저장이 잠긴 채로 남아 원본 초안이 보존된다 — 화면 상태를 다 채운
   * 뒤 부가 조회 실패를 안에서 삼키고 resolve하는 것은 호출부의 선택이다.
   */
  onRestore: (draft: LocalDraft) => void | Promise<void>;
};

export function useLocalDraft({ enabled, onRestore, ...input }: UseLocalDraftOptions): void {
  const lastWritten = useRef<LocalDraft | null>(null);
  // 서버 렌더에서는 저장소가 없어 null이다. 없으면 처음부터 저장이 열린다.
  const [initialDraft] = useState<LocalDraft | null>(() => loadDraft());
  const [restoreState, setRestoreState] = useState<RestoreState>(initialDraft === null ? "none" : "pending");
  const restoreStarted = useRef(false);
  // 복구 콜백은 렌더마다 새로 만들어질 수 있다. effect가 그걸 의존성으로 받으면 복구가
  // 여러 번 돌 수 있으므로 최신 참조만 들고 있는다(갱신은 렌더가 아니라 effect에서).
  const onRestoreRef = useRef(onRestore);
  useEffect(() => {
    onRestoreRef.current = onRestore;
  }, [onRestore]);

  // 복구 — 마운트 직후 1회. **성공한 경우에만** 저장을 연다
  useEffect(() => {
    if (initialDraft === null || restoreStarted.current) return;
    restoreStarted.current = true;
    lastWritten.current = initialDraft; // 방금 되살린 내용을 곧바로 다시 쓰지 않는다
    // 콜백을 then 안에서 부른다 — `Promise.resolve(fn())`는 인자가 먼저 평가돼서,
    // async가 아닌 콜백이 동기적으로 던지면 Promise가 만들어지기 전에 예외가 effect 밖으로
    // 나가고 catch가 못 잡는다 (PR #127 3차 리뷰 비차단). 동기 예외도 failed로 받는다.
    void Promise.resolve()
      .then(() => onRestoreRef.current(initialDraft))
      .then(() => setRestoreState("restored"))
      .catch(() => setRestoreState("failed")); // 원본 초안 유지 + 이번 마운트 저장 보류
  }, [initialDraft]);

  // 저장 — 복구가 끝났고, 조율 중이고, 내용이 실제로 바뀐 경우에만 디바운스 후 한 번
  const { trip, context, selectedPlaceIds } = input;
  useEffect(() => {
    const next: DraftInput = { trip, context, selectedPlaceIds };
    const decision = draftDecision({
      enabled,
      restorePending: restoreBlocksSave(restoreState),
      changed: !draftContentEquals(lastWritten.current, next),
    });
    if (decision === "skip") return;

    const timer = window.setTimeout(() => {
      const draft = draftFromInput(next, new Date());
      if (saveDraft(draft)) lastWritten.current = draft;
    }, DRAFT_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [enabled, restoreState, trip, context, selectedPlaceIds]);
}

/**
 * 최종 저장이 끝난 뒤 초안을 비운다.
 *
 * 남겨 두면 다음 방문에서 "저장까지 마친 일정"이 초안으로 되살아나 사용자가 이미 끝낸
 * 작업을 다시 보게 된다.
 */
export { clearDraft as clearLocalDraft };
