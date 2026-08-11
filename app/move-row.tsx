"use client";

import type { ReactNode } from "react";

/**
 * 이동 연결 행 (#118 P0-3, #146 2절)
 *
 * **이동은 조작 대상이 아니라 결과다.** 조율 중 사용자가 옮기는 것은 장소이고, 열차는
 * 그 결과로 정해진다. 그런데 구간·시각·소요를 펼쳐 두면 이동이 장소보다 화면을 더
 * 차지해 무엇을 만지면 되는지가 흐려진다.
 *
 * 그래서 조율 중에는 흐름만 남긴다 — 여기에 이동이 하나 있다는 사실. 구간·시각·소요는
 * 펼쳤을 때 나온다. 저장된 최종 일정에서는 그때부터 이동이 확인 대상이므로 편 채로 둔다.
 */
export function MoveRow({
  collapsed,
  icon,
  label,
  children,
  onOpenDetail,
  detailLabel,
}: {
  collapsed: boolean;
  icon: ReactNode;
  label: string;
  children: ReactNode;
  onOpenDetail?: () => void;
  detailLabel?: string;
}) {
  const frame = "flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-dashed bg-sc-subtle/40 px-2 py-1.5";
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
      <summary className={`${frame} cursor-pointer list-none marker:content-none hover:border-sc-blue`}>
        {badge}
        <span className="min-w-0 flex-1 text-xs text-sc-muted">{label}</span>
      </summary>
      <div className={`${frame} mt-1 ml-4`}>
        {children}
        {onOpenDetail && detailLabel && (
          <button
            type="button"
            className="shrink-0 rounded border px-2 py-0.5 text-xs text-sc-blue hover:border-sc-blue"
            onClick={onOpenDetail}
          >
            {detailLabel}
          </button>
        )}
      </div>
    </details>
  );
}
