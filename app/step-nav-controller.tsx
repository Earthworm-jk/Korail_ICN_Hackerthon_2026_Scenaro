"use client";

import { useEffect } from "react";

/**
 * #117 UI refinement — 상단 stepper를 실제 탐색 탭으로 만든다.
 *
 * PlannerWizard의 계산/선택 state는 그대로 둔다. 새 별도 상태를 만들지 않고 이미 검증된
 * 뒤로/다음 버튼을 호출해서 동일한 전이 규칙을 재사용한다.
 *
 * 허용 규칙:
 * - 이전 단계는 언제든 이동 가능.
 * - 앞으로 갈 때는 현재 단계의 기존 CTA가 활성화된 경우에만 한 단계씩 진행한다.
 * - 1 → 3을 눌러도 2단계 필수 K-content 선택이 비어 있으면 2단계에서 멈춘다.
 *
 * Step 3 구조가 정식 컴포넌트로 분리될 때 이 브리지는 PlannerWizard 내부 onStepChange로
 * 교체할 수 있다. 현재 파생 디자인 PR에서는 기능 계약을 중복 구현하지 않는 쪽을 택한다.
 */
export function StepNavController() {
  useEffect(() => {
    const nav = document.querySelector<HTMLElement>("nav.grid.grid-cols-3");
    if (!nav) return;

    const tabs = Array.from(nav.children) as HTMLElement[];
    const cleanups: Array<() => void> = [];

    const activeIndex = () => tabs.findIndex((tab) => tab.getAttribute("aria-current") === "step");

    const clickPrimaryNext = () => {
      const visibleSection = document.querySelector<HTMLElement>("main section");
      if (!visibleSection) return false;
      const next = Array.from(visibleSection.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.classList.contains("bg-sc-blue") && !button.disabled);
      if (!next) return false;
      next.click();
      return true;
    };

    const clickBack = (current: number) => {
      if (current === 2) {
        const button = document.querySelector<HTMLButtonElement>("#place-picker > div.mt-4 > button");
        if (button) {
          button.click();
          return true;
        }
      }

      const visibleSection = document.querySelector<HTMLElement>("main section");
      if (!visibleSection) return false;
      const candidates = Array.from(visibleSection.querySelectorAll<HTMLButtonElement>("button"));
      const back = candidates.find((button) =>
        !button.disabled &&
        !button.classList.contains("bg-sc-blue") &&
        button.closest("div.flex.justify-between") !== null,
      );
      if (!back) return false;
      back.click();
      return true;
    };

    const goTo = (target: number) => {
      const move = () => {
        const current = activeIndex();
        if (current < 0 || current === target) return;

        if (target > current) {
          // 기존 CTA가 비활성이라면 해당 단계의 필수 입력이 아직 충족되지 않은 것.
          if (!clickPrimaryNext()) return;
          window.setTimeout(move, 0);
          return;
        }

        if (!clickBack(current)) return;
        window.setTimeout(move, 0);
      };

      move();
    };

    tabs.forEach((tab, index) => {
      tab.setAttribute("role", "button");
      tab.setAttribute("tabindex", "0");

      const onClick = () => goTo(index);
      const onKeyDown = (event: Event) => {
        const keyboard = event as KeyboardEvent;
        if (keyboard.key !== "Enter" && keyboard.key !== " ") return;
        keyboard.preventDefault();
        goTo(index);
      };

      tab.addEventListener("click", onClick);
      tab.addEventListener("keydown", onKeyDown);
      cleanups.push(() => {
        tab.removeEventListener("click", onClick);
        tab.removeEventListener("keydown", onKeyDown);
      });
    });

    return () => cleanups.forEach((cleanup) => cleanup());
  }, []);

  return null;
}
