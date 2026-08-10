"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Step 3의 보조 기능을 우측 일정 rail에서 떼어 화면 하단 utility dock으로 옮긴다.
 * 1024px 미만에서는 기존 위치를 유지한다 — Stage UI 자체가 desktop 전용이기 때문이다.
 */
export function StageUtilityPortal({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const sync = () => setHost(media.matches ? document.getElementById("stage-utility-dock") : null);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  return host ? createPortal(children, host) : children;
}

/**
 * Utility Dock 공통 동작.
 * - 일반 확인사항은 compact disclosure로 축약
 * - 데이터 기준/검증 문구는 우측에서 제거하고 dock의 '데이터 기준' 항목으로 모음
 * - Escape로 열린 dock 항목 닫기
 * - blocking 과선택 경고는 건드리지 않음
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

    const boundWarnings = new WeakSet<HTMLElement>();

    const bindWarning = (node: HTMLElement) => {
      if (boundWarnings.has(node)) return;
      boundWarnings.add(node);
      const count = node.querySelectorAll("li").length;
      const heading = node.querySelector<HTMLElement>("h3");
      if (heading) heading.dataset.stageCount = String(count);
      node.dataset.stageWarning = "collapsed";
      node.setAttribute("role", "button");
      node.setAttribute("tabindex", "0");
      node.setAttribute("aria-expanded", "false");

      const toggle = () => {
        const expanded = node.dataset.stageWarning === "expanded";
        node.dataset.stageWarning = expanded ? "collapsed" : "expanded";
        node.setAttribute("aria-expanded", String(!expanded));
      };
      node.addEventListener("click", toggle);
      node.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        toggle();
      });
    };

    const syncDataUtility = () => {
      const desktop = window.matchMedia("(min-width: 1024px)").matches;
      const result = document.querySelector<HTMLElement>("#place-picker + div[aria-busy]");
      if (!desktop || !result) return;

      const sourceNodes = Array.from(
        result.querySelectorAll<HTMLElement>("p.rounded-lg.border.bg-sc-subtle"),
      );
      if (sourceNodes.length === 0) return;

      sourceNodes.forEach((node) => { node.dataset.stageSource = "data"; });

      let details = host.querySelector<HTMLDetailsElement>('details[data-stage-utility="data"]');
      if (!details) {
        details = document.createElement("details");
        details.dataset.stageUtility = "data";
        details.className = "group rounded-lg border bg-sc-surface";
        const summary = document.createElement("summary");
        summary.className = "flex min-h-11 list-none items-center justify-between gap-3 px-3 py-2.5 text-sm";
        const label = document.createElement("span");
        label.className = "min-w-0";
        const strong = document.createElement("strong");
        strong.className = "block truncate font-medium text-sc-text";
        strong.textContent = "ⓘ 데이터 기준";
        const sub = document.createElement("span");
        sub.className = "block truncate text-xs text-sc-muted";
        sub.textContent = "일정 산출·검증 근거";
        label.append(strong, sub);
        const arrow = document.createElement("span");
        arrow.className = "shrink-0 text-sc-muted";
        arrow.textContent = "⌄";
        summary.append(label, arrow);
        const panel = document.createElement("div");
        panel.className = "stage-data-panel border-t px-3 pb-3 pt-2";
        details.append(summary, panel);
        host.append(details);
      }

      const panel = details.querySelector<HTMLElement>(".stage-data-panel");
      if (panel) {
        panel.replaceChildren();
        sourceNodes.forEach((source) => {
          const p = document.createElement("p");
          p.className = "text-xs text-sc-muted";
          p.textContent = source.textContent?.trim() ?? "";
          panel.append(p);
        });
      }
    };

    const markWarnings = () => {
      document
        .querySelectorAll<HTMLElement>("#place-picker + div[aria-busy] div.rounded-lg.border.border-sc-orange\\/30.bg-sc-orange-soft")
        .forEach((node) => {
          if (!node.querySelector("h3") || !node.querySelector("ul")) return;
          if (node.querySelector('a[href="#place-picker"]')) return;
          bindWarning(node);
        });
    };

    const sync = () => {
      markWarnings();
      syncDataUtility();
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    const media = window.matchMedia("(min-width: 1024px)");
    media.addEventListener("change", sync);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      media.removeEventListener("change", sync);
      observer.disconnect();
    };
  }, []);

  return null;
}

/**
 * 최초 Step 3 진입 때 엔진의 첫 추천 일정에 실제로 배치된 장소만 기본 선택으로 남긴다.
 * 후보 전체를 평가하는 기존 첫 계산을 이용하므로 고정 '3곳' 같은 임의 상한을 만들지 않는다.
 * 이후 사용자가 직접 장소를 더 선택하면 자동으로 다시 줄이지 않는다.
 */
export function InitialCapacitySelectionController() {
  useEffect(() => {
    let trimming = false;
    let normalizedSignature: string | null = null;

    const candidateName = (card: HTMLElement) => {
      const title = card.querySelector<HTMLElement>("p.font-medium");
      if (!title) return "";
      const first = title.childNodes[0]?.textContent ?? title.textContent ?? "";
      return first.trim();
    };

    const selectionButton = (card: HTMLElement) =>
      card.querySelector<HTMLButtonElement>(":scope > div > button:last-child");

    const expandAllCandidates = (picker: HTMLElement, done: () => void) => {
      const more = Array.from(picker.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.parentElement === picker && button.classList.contains("w-full"));
      if (!more) {
        done();
        return;
      }
      more.click();
      window.setTimeout(() => expandAllCandidates(picker, done), 20);
    };

    const normalizeVisibleCandidates = (picker: HTMLElement, result: HTMLElement, signature: string) => {
      const cards = Array.from(picker.querySelectorAll<HTMLElement>(":scope > ul > li"));
      const itineraryRows = Array.from(result.querySelectorAll<HTMLElement>("li"))
        .filter((row) => row.textContent?.trim().startsWith("📍"));

      if (cards.length === 0 || itineraryRows.length === 0) {
        normalizedSignature = signature;
        return;
      }

      const scheduledNames = itineraryRows.map((row) => row.textContent ?? "");
      const toRemove = cards.filter((card) => {
        const button = selectionButton(card);
        const name = candidateName(card);
        return Boolean(
          button &&
          button.textContent?.trim() === "✓" &&
          name &&
          !scheduledNames.some((row) => row.includes(name)),
        );
      });

      trimming = true;
      picker.dataset.autoTrimming = "true";

      const removeNext = (index: number) => {
        if (index >= toRemove.length) {
          normalizedSignature = signature;
          trimming = false;
          delete picker.dataset.autoTrimming;
          return;
        }
        const name = candidateName(toRemove[index]);
        const latestCards = Array.from(picker.querySelectorAll<HTMLElement>(":scope > ul > li"));
        const latest = latestCards.find((card) => candidateName(card) === name);
        const button = latest ? selectionButton(latest) : null;
        if (button?.textContent?.trim() === "✓") button.click();
        window.setTimeout(() => removeNext(index + 1), 45);
      };

      removeNext(0);
    };

    const tryNormalize = () => {
      if (trimming) return;
      const picker = document.getElementById("place-picker");
      const result = picker?.nextElementSibling as HTMLElement | null;
      if (!picker || !result || result.getAttribute("aria-busy") === "true") return;

      const firstCards = Array.from(picker.querySelectorAll<HTMLElement>(":scope > ul > li"));
      if (firstCards.length === 0) return;
      const moreText = Array.from(picker.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.parentElement === picker && button.classList.contains("w-full"))?.textContent ?? "";
      const signature = `${firstCards.map(candidateName).join("|")}::${moreText.trim()}`;
      if (normalizedSignature === signature) return;

      const itineraryRows = Array.from(result.querySelectorAll<HTMLElement>("li"))
        .filter((row) => row.textContent?.trim().startsWith("📍"));
      if (itineraryRows.length === 0) return;

      expandAllCandidates(picker, () => normalizeVisibleCandidates(picker, result, signature));
    };

    tryNormalize();
    const observer = new MutationObserver(tryNormalize);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-busy"],
    });
    return () => observer.disconnect();
  }, []);

  return null;
}
