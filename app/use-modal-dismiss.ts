"use client";
/**
 * 팝업 공통 해제 동작 — 포커스 트랩 · Escape · 트리거 포커스 복귀 (PR #93에서 추출)
 * aria-modal="true" 선언과 실제 동작을 일치시키는 부분이라 팝업마다 복사하면 어긋난다.
 * 역 편의시설 팝업과 열차 구간 팝업이 같은 구현을 공유한다.
 */
import { useEffect, type RefObject } from "react";

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function useModalDismiss(
  dialogRef: RefObject<HTMLElement | null>,
  onClose: () => void,
) {
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusablesIn = () => [
      ...(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []),
    ].filter((element) => !element.hasAttribute("disabled"));

    focusablesIn()[0]?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusablesIn();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      const inside = dialogRef.current?.contains(active ?? null) ?? false;
      if (event.shiftKey && (!inside || active === first)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (!inside || active === last)) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, [dialogRef, onClose]);
}
