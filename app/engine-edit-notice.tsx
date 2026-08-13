"use client";

import { useEffect, useState } from "react";
import { CalendarCheck } from "lucide-react";
import type { MessageKey } from "@/lib/i18n/messages";

/** 알림이 그대로 보이는 시간. 페이드가 끝난 뒤 onExpire로 DOM에서 걷는다 */
const VISIBLE_MS = 3000;
const FADE_MS = 500;

/**
 * 결정적 편집의 비차단 완료 알림 (#207 2번).
 *
 * `ready`로 조용히 적용된 변경은 패널을 열지 않는다 — 대신 이 알림이 "반영됐고 되돌릴
 * 수 있다"만 말하고 스스로 사라진다. 사용자가 닫기를 눌러야 하는 확인창을 남기지 않는다.
 *
 * 사라지는 것은 **알림뿐이다.** 실행 취소 지점은 함께 폐기하지 않는다(#207 정책) —
 * 알림이 걷힌 뒤에도 조율 패널에서 같은 변경을 되돌릴 수 있다.
 *
 * 페이드는 CSS 전환에 맡기고 제거는 타이머로 확정한다. `transitionend`에 걸면
 * `prefers-reduced-motion`에서 전환이 생략될 때 알림이 영영 남는다 — reduced motion은
 * 애니메이션만 생략하고 상태 전이는 같아야 한다.
 */
export function EngineEditNotice({
  canUndo,
  onUndo,
  onExpire,
  tr,
}: {
  canUndo: boolean;
  onUndo: () => void;
  onExpire: () => void;
  tr: (key: MessageKey) => string;
}) {
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const fadeTimer = window.setTimeout(() => setFading(true), VISIBLE_MS);
    const expireTimer = window.setTimeout(onExpire, VISIBLE_MS + FADE_MS);
    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(expireTimer);
    };
  }, [onExpire]);

  return (
    <div
      role="status"
      aria-live="polite"
      data-engine-edit-notice
      className={`mt-3 ml-auto flex w-fit max-w-full items-center gap-2 rounded-lg border border-sc-blue/25 bg-sc-blue-soft px-3 py-2 text-sm text-sc-blue transition-opacity motion-reduce:transition-none ${
        fading ? "opacity-0 duration-500" : "opacity-100"
      }`}
    >
      <CalendarCheck aria-hidden="true" className="size-4 shrink-0" />
      <span className="min-w-0">{tr("engineEdit.appliedNotice")}</span>
      {canUndo && (
        <button
          type="button"
          onClick={onUndo}
          className="min-h-9 shrink-0 rounded border border-sc-blue/40 px-2 text-xs font-medium hover:bg-sc-surface"
        >
          {tr("ai.undo")}
        </button>
      )}
    </div>
  );
}
