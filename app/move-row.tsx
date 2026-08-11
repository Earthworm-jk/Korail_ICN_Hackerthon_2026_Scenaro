"use client";

import type { ReactNode } from "react";

/**
 * 이동 연결 행 (#118 P0-3, #146 2·3절)
 *
 * **이동은 조작 대상이 아니라 결과다.** 조율 중 사용자가 옮기는 것은 장소이고, 열차는
 * 그 결과로 정해진다. 그런데 시각·소요·열차번호까지 펼쳐 두면 이동이 장소보다 화면을
 * 더 차지해 무엇을 만지면 되는지가 흐려진다.
 *
 * **다만 역 이름은 접어도 남긴다.** 처음엔 구간까지 감췄더니, DAY 헤더의 `역 시설 3곳`이
 * 화면 어디에도 없는 역을 가리키는 상태가 됐다 — 2일차 종착이 서울역인데 화면에는
 * "이동"만 보이니 데이터가 틀린 것처럼 읽혔다. 사용자가 몰라도 되는 것은 열차 상세이지,
 * 그 날 어느 역을 거치는지가 아니다.
 *
 * 저장된 최종 일정에서는 이동이 확인 대상이므로 편 채로 둔다.
 */
export function MoveRow({
  collapsed,
  icon,
  label,
  route,
  note,
  startAt,
  duration,
  children,
  onOpenDetail,
  detailLabel,
}: {
  collapsed: boolean;
  icon: ReactNode;
  label: string;
  /** 출발역 → 도착역. 접었을 때도 남긴다 — 아래 주석 참고 */
  route: string;
  /**
   * 접힌 카드의 시각과 소요 (#146).
   *
   * 접었을 때도 장소 카드와 **같은 3단 구조**여야 한다 - 시각 / 아이콘 + 이름 /
   * 소요. 한 줄로 몰아 적으면 240px 카드에서 줄바꿈 위치가 내용마다 달라져
   * 카드가 들쭉날쭉해 보인다. 그래서 `children`에만 두지 않고 따로 받는다.
   */
  startAt?: string;
  duration?: string;
  /** `공항철도 이용`처럼 그 구간의 사실. 선택지가 없을 때 무엇으로 가는지 알린다 */
  note?: string;
  children: ReactNode;
  onOpenDetail?: () => void;
  detailLabel?: string;
}) {
  const frame = "flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-dashed bg-sc-subtle/40 px-2 py-1.5";
  // 접힌 카드는 장소 카드와 같은 세로 3단이다 — 가로로 몰지 않는다 (#146)
  const collapsedFrame = "flex h-full flex-col rounded-lg border border-dashed bg-sc-subtle/40 px-2 py-1.5";
  const badge = (
    <span className="grid size-7 shrink-0 place-items-center rounded-md bg-sc-subtle text-sc-muted">
      {icon}
    </span>
  );

  if (!collapsed) {
    // 펼친 상태에서도 열차는 상세 모달로 들어갈 수 있어야 한다
    if (onOpenDetail) {
      return (
        <button type="button" className={`${frame} w-full text-left hover:border-sc-blue`} onClick={onOpenDetail}>
          {badge}
          {children}
        </button>
      );
    }
    return <div className={frame}>{badge}{children}</div>;
  }

  return (
    <details className="group">
      {/* `list-none`이 없으면 브라우저 기본 삼각형이 아이콘 앞에 하나 더 붙는다 */}
      <summary className={`${collapsedFrame} cursor-pointer list-none marker:content-none hover:border-sc-blue`}>
        <span className="block tabular-nums text-xs text-sc-muted" data-row-time>{startAt ?? label}</span>
        <span className="mt-1 flex items-start gap-2" data-row-main>
          {badge}
          <span className="min-w-0 flex-1 text-sc-text/80" data-row-name>{route}</span>
        </span>
        <span className="mt-auto flex items-center gap-1.5 pt-1 text-xs text-sc-muted" data-row-meta>
          <span>{duration ?? label}</span>
          {note && (
            <span className="shrink-0 rounded bg-sc-blue-soft px-1.5 py-0.5 text-sc-blue">{note}</span>
          )}
        </span>
      </summary>
      <div className={`${frame} mt-1 ml-4`}>
        {children}
        {onOpenDetail && detailLabel && (
          <button
            type="button"
            className="min-h-10 shrink-0 rounded border px-2 text-xs text-sc-blue hover:border-sc-blue"
            onClick={onOpenDetail}
          >
            {detailLabel}
          </button>
        )}
      </div>
    </details>
  );
}
