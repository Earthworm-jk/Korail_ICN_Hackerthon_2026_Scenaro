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
 */
import { useEffect, useRef } from "react";
import { clearDraft, loadDraft, saveDraft, type LocalDraft } from "@/lib/local-itineraries";
import { draftContentEquals, draftDecision, draftFromInput, type DraftInput } from "@/lib/local-draft";

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
   * 그 상태를 초안으로 덮으면, 새로고침했을 때 사용자가 만들던 조율이 아니라 남의 일정이
   * 복구된다.
   */
  enabled: boolean;
  /** 마운트 직후 1회. 초안이 없거나 손상됐으면 호출되지 않는다 */
  onRestore?: (draft: LocalDraft) => void;
};

export function useLocalDraft({ enabled, onRestore, ...input }: UseLocalDraftOptions): void {
  const lastWritten = useRef<LocalDraft | null>(null);
  const restored = useRef(false);
  // 복구 콜백은 렌더마다 새로 만들어질 수 있다. effect가 그걸 의존성으로 받으면 복구가
  // 여러 번 돌 수 있으므로 최신 참조만 들고 있는다(갱신은 렌더가 아니라 effect에서).
  const onRestoreRef = useRef(onRestore);
  useEffect(() => {
    onRestoreRef.current = onRestore;
  }, [onRestore]);

  // 복구 — 마운트 직후 1회. 실패·부재는 조용히 넘긴다(호출부는 빈 화면에서 시작하면 된다)
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const draft = loadDraft();
    if (draft === null) return;
    lastWritten.current = draft; // 방금 되살린 내용을 곧바로 다시 쓰지 않는다
    onRestoreRef.current?.(draft);
  }, []);

  // 저장 — 내용이 실제로 바뀐 경우에만, 디바운스 후 한 번
  const { trip, selectedActorIds, selectedWorkIds, selectedPlaceIds } = input;
  useEffect(() => {
    const next: DraftInput = { trip, selectedActorIds, selectedWorkIds, selectedPlaceIds };
    const decision = draftDecision({
      enabled,
      changed: !draftContentEquals(lastWritten.current, next),
    });
    if (decision === "skip") return;

    const timer = window.setTimeout(() => {
      const draft = draftFromInput(next, new Date());
      if (saveDraft(draft)) lastWritten.current = draft;
    }, DRAFT_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [enabled, trip, selectedActorIds, selectedWorkIds, selectedPlaceIds]);
}

/**
 * 최종 저장이 끝난 뒤 초안을 비운다.
 *
 * 남겨 두면 다음 방문에서 "저장까지 마친 일정"이 초안으로 되살아나 사용자가 이미 끝낸
 * 작업을 다시 보게 된다.
 */
export { clearDraft as clearLocalDraft };
