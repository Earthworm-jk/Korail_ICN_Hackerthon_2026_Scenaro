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
 * Dock 공통 동작 + 긴 데이터 근거 문구를 compact disclosure로 바꾼다.
 * - Escape: 열린 dock item 닫기
 * - 데이터 근거/검증 문구: 한 줄 기본, 클릭·Enter·Space로 펼침
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

    const bound = new WeakSet<HTMLElement>();
    const markInfoDisclosures = () => {
      document
        .querySelectorAll<HTMLElement>("#place-picker + div[aria-busy] p.rounded-lg.border.bg-sc-subtle")
        .forEach((node) => {
          if (bound.has(node)) return;
          bound.add(node);
          node.dataset.stageInfo = "collapsed";
          node.setAttribute("role", "button");
          node.setAttribute("tabindex", "0");
          node.setAttribute("aria-expanded", "false");

          const toggle = () => {
            const expanded = node.dataset.stageInfo === "expanded";
            node.dataset.stageInfo = expanded ? "collapsed" : "expanded";
            node.setAttribute("aria-expanded", String(!expanded));
          };

          node.addEventListener("click", toggle);
          node.addEventListener("keydown", (event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            toggle();
          });
        });
    };

    markInfoDisclosures();
    const observer = new MutationObserver(markInfoDisclosures);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      observer.disconnect();
    };
  }, []);

  return null;
}
