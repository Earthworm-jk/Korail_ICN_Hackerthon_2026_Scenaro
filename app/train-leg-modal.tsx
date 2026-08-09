"use client";
/**
 * 열차 구간 팝업 (인수인계 G — 실행 지원 카드 해체)
 * - 일정의 열차 줄을 누르면 그 구간의 시각·소요시간·열차번호와 출처를 본다.
 *   같은 사실을 화면 아래 별도 카드에서 다시 말하지 않기 위해, 안내를 구간에 붙였다.
 * - 공항철도(AREX) 구간에만 직통 안내 한 줄이 붙는다. 공항역 구간이 없는 일정에는
 *   그 줄 자체가 없으므로 안내도 나타나지 않는다 (PR #59 리뷰 2 조건부 표시 계약).
 * - 출처는 구간 종류로만 나눈다. 구간별 계획/실적 등급 구분은 여기서 만들지 않는다.
 */
import { useId, useRef } from "react";
import type { MessageKey } from "@/lib/i18n/messages";
import { useModalDismiss } from "./use-modal-dismiss";

const KST = "Asia/Seoul";

/** SOURCES.md 철도 절 — `AREX-` 접두는 공식 편명이 아니라 스냅샷 내 공항철도 식별자다 */
const AREX_TRAIN_PREFIX = "AREX-";

export function isAirportRailLeg(trainNo: string): boolean {
  return trainNo.startsWith(AREX_TRAIN_PREFIX);
}

export type TrainLegDetail = {
  trainNo: string;
  fromName: string;
  toName: string;
  departAt: string;
  arriveAt: string;
};

function fmtTime(iso: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: KST, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(iso));
}

/** 소요시간(분) — 엔진 값이 아니라 표시된 출발·도착 시각의 차다. 새 데이터를 만들지 않는다 */
export function legDurationMinutes(
  leg: Pick<TrainLegDetail, "departAt" | "arriveAt">,
): number {
  return Math.round((Date.parse(leg.arriveAt) - Date.parse(leg.departAt)) / 60_000);
}

/** 출처는 구간 종류로만 나눈다 — 구간별 계획/실적 등급 구분은 여기서 만들지 않는다 */
export function legSourceKey(leg: Pick<TrainLegDetail, "trainNo">): MessageKey {
  return isAirportRailLeg(leg.trainNo) ? "support.arexSource" : "leg.railSource";
}

function durationLabel(leg: TrainLegDetail, tr: (key: MessageKey) => string): string {
  const minutes = legDurationMinutes(leg);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}${tr("region.minutes")}`;
  return `${hours}${tr("region.hours")}${rest > 0 ? ` ${rest}${tr("region.minutes")}` : ""}`;
}

export function TrainLegModal({ leg, onClose, tr }: {
  leg: TrainLegDetail;
  onClose: () => void;
  tr: (key: MessageKey) => string;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalDismiss(dialogRef, onClose);

  const isAirportRail = isAirportRailLeg(leg.trainNo);

  const row = (label: string, value: string) => (
    <div className="flex items-baseline justify-between gap-3 border-b border-sc-line/60 py-2 last:border-b-0">
      <span className="text-sm text-sc-muted">{label}</span>
      <span className="text-sm font-medium text-sc-text">{value}</span>
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[85vh] w-full max-w-sm overflow-auto rounded-lg bg-sc-surface p-5 shadow-xl"
      >
        <div className="flex items-start justify-between gap-2">
          <h3 id={titleId} className="font-semibold">
            {leg.fromName} → {leg.toName}
          </h3>
          <button
            type="button"
            className="rounded border px-2 py-1 text-sm"
            onClick={onClose}
            aria-label={tr("support.close")}
          >
            ×
          </button>
        </div>

        <div className="mt-3">
          {row(tr("leg.time"), `${fmtTime(leg.departAt)} → ${fmtTime(leg.arriveAt)}`)}
          {row(tr("leg.duration"), durationLabel(leg, tr))}
          {row(tr("step4.train"), leg.trainNo)}
        </div>

        {isAirportRail && (
          <p className="mt-3 rounded border border-sc-line bg-sc-subtle/60 p-2.5 text-sm text-sc-text/80">
            {tr("leg.arexNote")}
          </p>
        )}

        <p className="mt-3 text-xs text-sc-muted/70">{tr(legSourceKey(leg))}</p>
      </div>
    </div>
  );
}
