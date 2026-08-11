"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Step 3의 보조 기능을 우측 일정 rail에서 떼어 화면 하단 utility dock으로 옮긴다.
 * 1024px 미만에서는 기존 위치를 유지한다 — Stage UI 자체가 desktop 전용이기 때문이다.
 */
export function StageUtilityPortal({
  children,
  targetId = "stage-utility-dock",
}: {
  children: ReactNode;
  /** 옮겨 갈 곳. 기본은 옛 utility dock, `stage-sheet-actions`는 시트 헤더 오른쪽 끝 */
  targetId?: string;
}) {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    // 대상이 시트 안에 있으면 시트가 렌더된 뒤에야 잡힌다. 한 번 놓치면 영영 제자리에
    // 남으므로, 붙을 곳이 생기는지 DOM 변화까지 지켜본다.
    const sync = () => setHost(media.matches ? document.getElementById(targetId) : null);
    sync();
    media.addEventListener("change", sync);
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      media.removeEventListener("change", sync);
      observer.disconnect();
    };
  }, [targetId]);

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

    /**
     * 바닥에 고정된 것이 차지하는 높이를 `--sc-dock-h`로 알린다 — `main`이 그만큼
     * padding-bottom을 두어야 마지막 액션 줄이 그 아래 숨지 않는다.
     *
     * 데스크톱에서 바닥을 차지하는 것은 **추천 시트다** (#146). 시트를 독 자리에
     * 고정했으므로 `#stage-utility-dock`은 비어 `display: none`이고 높이가 0이다.
     * 그래서 시트를 먼저 재고, 시트가 없을 때만 독을 잰다 — 모바일과 다른 화면에서는
     * 여전히 독이 바닥을 차지할 수 있다.
     *
     * 펼침·접힘으로 시트 높이가 바뀌므로 시트도 관찰 대상이다.
     */
    const syncGeometry = () => {
      geometryFrame = 0;

      const sheet = document.querySelector<HTMLElement>("#place-picker[data-place-sheet]");
      if (sheet !== observedSheet) {
        if (observedSheet) geometryObserver.unobserve(observedSheet);
        observedSheet = sheet;
        if (sheet) geometryObserver.observe(sheet);
      }

      // 시트가 바닥에 고정돼 있을 때만 그 높이를 쓴다. 문서 흐름 안에 있으면
      // 이미 자기 자리를 차지하므로 따로 비워 둘 필요가 없다.
      const sheetFixed = sheet ? getComputedStyle(sheet).position === "fixed" : false;
      const bottomHeight = sheetFixed && sheet ? sheet.offsetHeight : host.offsetHeight;
      root.style.setProperty("--sc-dock-h", `${bottomHeight}px`);
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

    // 경고 카드를 클래스 이름으로 찾아 클릭 가능한 디스클로저로 바꾸던 코드는 지웠다
    // (#146). 경고는 이제 React가 아이콘 + 팝오버로 직접 그린다 — 마크업을 사후에
    // 뜯어고치는 대신 컴포넌트가 자기 접근성 속성을 갖는다.
    scheduleGeometrySync();
    const observer = new MutationObserver(scheduleGeometrySync);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", scheduleGeometrySync);
      observer.disconnect();
      geometryObserver.disconnect();
      if (geometryFrame) cancelAnimationFrame(geometryFrame);
      root.style.removeProperty("--sc-dock-h");
    };
  }, []);

  return null;
}
