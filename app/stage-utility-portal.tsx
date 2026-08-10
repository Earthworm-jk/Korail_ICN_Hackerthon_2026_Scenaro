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
 * - Escape로 열린 dock 항목 닫기
 * - blocking 과선택 경고는 건드리지 않음
 *
 * 데이터 산출 기준은 별도 dock 항목으로 노출하지 않는다.
 */
export function StageUtilityDockController() {
  useEffect(() => {
    const host = document.getElementById("stage-utility-dock");
    if (!host) return;

    const root = document.documentElement;
    let observedSheet: HTMLElement | null = null;
    let geometryFrame = 0;

    const syncGeometry = () => {
      geometryFrame = 0;
      const dockHeight = host.offsetHeight;
      root.style.setProperty("--sc-dock-h", `${dockHeight}px`);

      const sheet = document.querySelector<HTMLElement>("#place-picker[data-place-sheet]");
      if (sheet !== observedSheet) {
        if (observedSheet) geometryObserver.unobserve(observedSheet);
        observedSheet?.style.removeProperty("--sc-sheet-dock-offset");
        observedSheet = sheet;
        if (sheet) geometryObserver.observe(sheet);
      }
      if (!sheet || dockHeight === 0) {
        sheet?.style.setProperty("--sc-sheet-dock-offset", "0px");
        return;
      }

      // getBoundingClientRect includes the previous translation. Add it back before
      // calculating the next value so repeated ResizeObserver passes converge.
      const previousOffset = Number.parseFloat(
        sheet.style.getPropertyValue("--sc-sheet-dock-offset"),
      ) || 0;
      const unshiftedSheetBottom = sheet.getBoundingClientRect().bottom + previousOffset;
      const dockTop = host.getBoundingClientRect().top;
      const nextOffset = Math.max(0, Math.ceil(unshiftedSheetBottom - dockTop + 12));
      sheet.style.setProperty("--sc-sheet-dock-offset", `${nextOffset}px`);
    };

    const scheduleGeometrySync = () => {
      if (geometryFrame) cancelAnimationFrame(geometryFrame);
      geometryFrame = requestAnimationFrame(syncGeometry);
    };

    const geometryObserver = new ResizeObserver(scheduleGeometrySync);
    geometryObserver.observe(host);
    window.addEventListener("resize", scheduleGeometrySync);

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

    const markWarnings = () => {
      document
        .querySelectorAll<HTMLElement>("#place-picker + div[aria-busy] div.rounded-lg.border.border-sc-orange\\/30.bg-sc-orange-soft")
        .forEach((node) => {
          if (!node.querySelector("h3") || !node.querySelector("ul")) return;
          if (node.querySelector('a[href="#place-picker"]')) return;
          bindWarning(node);
        });
      scheduleGeometrySync();
    };

    markWarnings();
    const observer = new MutationObserver(markWarnings);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", scheduleGeometrySync);
      observer.disconnect();
      geometryObserver.disconnect();
      if (geometryFrame) cancelAnimationFrame(geometryFrame);
      root.style.removeProperty("--sc-dock-h");
      observedSheet?.style.removeProperty("--sc-sheet-dock-offset");
    };
  }, []);

  return null;
}
