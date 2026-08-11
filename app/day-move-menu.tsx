"use client";

import { useRef } from "react";
import { CalendarArrowDown } from "lucide-react";
import { withValues, type MessageKey } from "@/lib/i18n/messages";

/**
 * DAY 전체를 다른 날로 (#146 10, PR #157 리뷰 2)
 *
 * **드래그만으로는 부족하다.** HTML5 drag는 터치에서 동작하지 않고 키보드로도 쓸 수 없는데,
 * 이 제품의 구현 기준은 태블릿이다. 장소마다 있는 날짜 버튼은 *그 장소* 하나를 옮기는
 * 것이라 "이 날 전체"와 같은 기능이 아니다 — 3곳짜리 날이면 세 번 눌러야 하고, 그 사이
 * 각각이 별도 제안·별도 재계산이 되어 결과도 달라진다.
 *
 * 그래서 같은 일을 하는 **포커스 가능한 진입점**을 함께 둔다. 드래그와 이 메뉴는
 * `submitDayMove` 하나로 들어가므로 조작 방법에 따라 판정이 갈리지 않는다.
 */
export function DayMoveMenu({
  date,
  targets,
  disabled,
  onMove,
  scope = "day",
  tr,
}: {
  /** 팝오버 id를 만드는 키. 날짜 단위면 날짜, 장소 단위면 장소 id */
  date: string;
  /**
   * 무엇을 옮기는가 (#146).
   *
   * 모바일에는 드래그가 없다 — HTML5 drag는 터치에서 동작하지 않는다. 날짜 통에만
   * 이 메뉴를 두고 장소는 드래그로만 옮기게 두면 **휴대폰에서는 장소를 옮길 방법이
   * 아예 없다.** 같은 메뉴를 장소에도 쓴다.
   */
  scope?: "day" | "place";
  /** 옮길 수 있는 날들. 자기 자신은 호출부에서 뺀다 */
  targets: { date: string; index: number }[];
  disabled: boolean;
  onMove: (targetDate: string) => void;
  tr: (key: MessageKey) => string;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const popoverId = `${scope}-move-${date}`;
  const label = tr(scope === "day" ? "step4.dayMoveLabel" : "step4.placeMoveLabel");

  // 옮길 곳이 없으면 버튼도 두지 않는다 — 눌러 봐야 빈 메뉴다
  if (targets.length === 0) return null;

  return (
    <>
      <button
        type="button"
        popoverTarget={popoverId}
        disabled={disabled}
        aria-haspopup="menu"
        aria-controls={popoverId}
        aria-label={label}
        className="inline-flex min-h-10 items-center gap-1 rounded-full border border-sc-blue/25 px-3 text-xs text-sc-blue hover:bg-sc-blue-soft disabled:opacity-40"
      >
        <CalendarArrowDown aria-hidden="true" className="size-4" />
      </button>

      <div
        ref={popoverRef}
        id={popoverId}
        popover="auto"
        role="menu"
        aria-label={label}
        className="m-auto w-[min(280px,calc(100vw-32px))] rounded-xl border bg-sc-surface p-3 text-left shadow-2xl backdrop:bg-black/20"
      >
        <p className="text-sm font-semibold text-sc-text">{tr("step4.dayMoveTitle")}</p>
        <ul className="mt-2 space-y-1">
          {targets.map((target) => (
            <li key={target.date}>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  // 목록을 먼저 닫는다 — 확인 창이 뜨는데 메뉴가 top layer에 남으면 가린다
                  popoverRef.current?.hidePopover();
                  onMove(target.date);
                }}
                className="min-h-11 w-full rounded-lg border px-3 text-left text-sm hover:border-sc-blue"
              >
                {withValues(tr("step4.dayMoveTarget"), {
                  day: String(target.index + 1),
                  date: target.date,
                })}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
