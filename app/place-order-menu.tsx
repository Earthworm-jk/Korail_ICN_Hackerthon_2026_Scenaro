"use client";

import { useRef } from "react";
import { ArrowUpNarrowWide } from "lucide-react";
import { withValues, type MessageKey } from "@/lib/i18n/messages";

/**
 * 같은 날 안에서 이 장소를 어느 앞으로 보낼지 (#145, PR #170 리뷰 2)
 *
 * **드래그만으로는 부족하다.** HTML5 drag는 터치에서 동작하지 않고 키보드로도 쓸 수 없는데,
 * 이 제품의 구현 기준은 태블릿이다. 날짜 이동에서 같은 이유로 `DayMoveMenu`를 뒀던 것과
 * 같은 자리다 — 순서에도 포커스 가능한 진입점을 함께 둔다.
 *
 * 드래그와 이 메뉴는 `submitVisitOrderEdit` 하나로 들어가므로 조작 방법에 따라 판정이
 * 갈리지 않는다.
 */
export function PlaceOrderMenu({
  placeId,
  targets,
  disabled,
  placeName,
  onMoveBefore,
  tr,
}: {
  placeId: string;
  /** 이 장소를 앞으로 보낼 수 있는 대상들. 자기 자신은 호출부에서 뺀다 */
  targets: string[];
  disabled: boolean;
  placeName: (id: string) => string;
  onMoveBefore: (targetPlaceId: string) => void;
  tr: (key: MessageKey) => string;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const popoverId = `place-order-${placeId}`;

  // 그 날에 자기 말고 아무도 없으면 순서라는 것이 없다 — 눌러 봐야 빈 메뉴다
  if (targets.length === 0) return null;

  return (
    <>
      <button
        type="button"
        popoverTarget={popoverId}
        disabled={disabled}
        aria-haspopup="menu"
        aria-controls={popoverId}
        aria-label={tr("step4.placeOrderLabel")}
        className="grid size-9 shrink-0 place-items-center rounded-full border border-sc-blue/25 text-sc-blue hover:bg-sc-blue-soft disabled:opacity-40"
      >
        <ArrowUpNarrowWide aria-hidden="true" className="size-4" />
      </button>

      <div
        ref={popoverRef}
        id={popoverId}
        popover="auto"
        role="menu"
        aria-label={tr("step4.placeOrderLabel")}
        className="m-auto w-[min(300px,calc(100vw-32px))] rounded-xl border bg-sc-surface p-3 text-left shadow-2xl backdrop:bg-black/20"
      >
        <p className="text-sm font-semibold text-sc-text">{tr("step4.placeOrderTitle")}</p>
        <ul className="mt-2 space-y-1">
          {targets.map((targetId) => (
            <li key={targetId}>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  // 목록을 먼저 닫는다 — 확인 창이 뜨는데 메뉴가 top layer에 남으면 가린다
                  popoverRef.current?.hidePopover();
                  onMoveBefore(targetId);
                }}
                className="min-h-11 w-full rounded-lg border px-3 text-left text-sm hover:border-sc-blue"
              >
                {withValues(tr("step4.placeOrderTarget"), { place: placeName(targetId) })}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
