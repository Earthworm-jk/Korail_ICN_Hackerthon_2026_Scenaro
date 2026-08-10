"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Step 3의 보조 기능을 우측 일정 rail에서 떼어 화면 하단 utility dock으로 옮긴다.
 * React portal이라 기존 state/context/callback은 그대로 유지한다.
 */
export function StageUtilityPortal({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setHost(document.getElementById("stage-utility-dock"));
  }, []);

  return host ? createPortal(children, host) : children;
}

/**
 * 긴 근거 문구와 일반 경고는 compact disclosure로 만든다.
 * blocking 과선택 경고는 건드리지 않는다.
 */
export function StageUtilityDockController() {
  useEffect(() => {
    const host = document.getElementById("stage-utility-dock");
    if (!host) return;

    const closeOpenUtilities = () => {
      host.querySelectorAll<HTMLDetailsElement>("details[open]").forEach((details) => {
        details.open = false;
      });
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeOpenUtilities();
    };
    document.addEventListener("keydown", onKeyDown);

    const boundInfo = new WeakSet<HTMLElement>();
    const boundWarnings = new WeakSet<HTMLElement>();

    const bindToggle = (node: HTMLElement, key: "stageInfo" | "stageWarning") => {
      const collapsed = () => node.dataset[key] !== "expanded";
      node.dataset[key] = "collapsed";
      node.setAttribute("role", "button");
      node.setAttribute("tabindex", "0");
      node.setAttribute("aria-expanded", "false");

      const toggle = () => {
        const next = collapsed() ? "expanded" : "collapsed";
        node.dataset[key] = next;
        node.setAttribute("aria-expanded", String(next === "expanded"));
      };

      node.addEventListener("click", toggle);
      node.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        toggle();
      });
    };

    const markDisclosures = () => {
      document
        .querySelectorAll<HTMLElement>("#place-picker + div[aria-busy] p.rounded-lg.border.bg-sc-subtle")
        .forEach((node) => {
          if (boundInfo.has(node)) return;
          boundInfo.add(node);
          bindToggle(node, "stageInfo");
        });

      document
        .querySelectorAll<HTMLElement>("#place-picker + div[aria-busy] div.rounded-lg.border.border-sc-orange\\/30.bg-sc-orange-soft")
        .forEach((node) => {
          if (boundWarnings.has(node) || !node.querySelector("h3") || !node.querySelector("ul")) return;
          // '선택한 장소를 모두 배치할 수 없습니다'는 별도 blocking alert로 항상 펼쳐 둔다.
          if (node.querySelector('a[href="#place-picker"]')) return;
          boundWarnings.add(node);
          const count = node.querySelectorAll("li").length;
          const heading = node.querySelector<HTMLElement>("h3");
          if (heading) heading.dataset.stageCount = String(count);
          bindToggle(node, "stageWarning");
        });
    };

    markDisclosures();
    const observer = new MutationObserver(markDisclosures);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      observer.disconnect();
    };
  }, []);

  return null;
}

/**
 * 최초 Step 3 진입 때 엔진이 실제로 일정에 배치한 장소만 기본 선택으로 남긴다.
 *
 * 후보 전체를 평가하는 기존 첫 계산은 그대로 사용하고, 그 결과의 📍 일정 항목에 들어간 장소만
 * 선택 상태로 남긴다. 사용자가 이후 직접 장소를 더 선택하면 자동으로 다시 줄이지 않는다.
 * 따라서 blocking 과선택 경고는 '사용자가 수용량을 넘겨 선택한 경우'에만 의미 있게 나타난다.
 *
 * 이 비교 PR에서는 PlannerWizard의 state 계약을 복제하지 않으려고 UI 브리지로 구현한다.
 * 최종 구조 확정 시 loadCandidates/초기 plan 경로 안으로 옮긴다.
 */
export function InitialCapacitySelectionController() {
  useEffect(() => {
    const initialized = new WeakSet<HTMLElement>();
    let trimming = false;

    const candidateName = (card: HTMLElement) => {
      const title = card.querySelector<HTMLElement>("p.font-medium");
      if (!title) return "";
      const first = title.childNodes[0]?.textContent ?? title.textContent ?? "";
      return first.trim();
    };

    const selectionButton = (card: HTMLElement) =>
      card.querySelector<HTMLButtonElement>(":scope > div > button:last-child");

    const tryNormalize = () => {
      if (trimming) return;
      const picker = document.getElementById("place-picker");
      const result = picker?.nextElementSibling as HTMLElement | null;
      if (!picker || !result || initialized.has(picker)) return;

      // 아직 첫 계획을 계산 중이면 결과가 확정될 때까지 기다린다.
      if (result.getAttribute("aria-busy") === "true") return;

      const cards = Array.from(picker.querySelectorAll<HTMLElement>(":scope > ul > li"));
      if (cards.length === 0) return;

      const itineraryRows = Array.from(result.querySelectorAll<HTMLElement>("li"))
        .filter((row) => row.textContent?.trim().startsWith("📍"));

      // 일정이 아직 없으면 계획 결과가 나오는 중이거나 empty 상태다. empty에서는 임의 선택을 만들지 않는다.
      if (itineraryRows.length === 0) {
        const plannedOrEmpty = result.querySelector('[role="status"], .bg-sc-orange-soft, .bg-sc-red\\/5');
        if (plannedOrEmpty) initialized.add(picker);
        return;
      }

      const toRemove = cards.filter((card) => {
        const button = selectionButton(card);
        const name = candidateName(card);
        if (!button || button.textContent?.trim() !== "✓" || !name) return false;
        return !itineraryRows.some((row) => row.textContent?.includes(name));
      });

      if (toRemove.length === 0) {
        initialized.add(picker);
        return;
      }

      trimming = true;
      picker.dataset.autoTrimming = "true";

      const removeNext = (index: number) => {
        if (index >= toRemove.length) {
          initialized.add(picker);
          trimming = false;
          delete picker.dataset.autoTrimming;
          return;
        }
        const name = candidateName(toRemove[index]);
        const latestCards = Array.from(picker.querySelectorAll<HTMLElement>(":scope > ul > li"));
        const latest = latestCards.find((card) => candidateName(card) === name);
        const button = latest ? selectionButton(latest) : null;
        if (button?.textContent?.trim() === "✓") button.click();
        window.setTimeout(() => removeNext(index + 1), 55);
      };

      removeNext(0);
    };

    tryNormalize();
    const observer = new MutationObserver(tryNormalize);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-busy"] });
    return () => observer.disconnect();
  }, []);

  return null;
}
