"use client";
/**
 * 구간별 "다른 출발 시간" 대안 선택 UI (#14 ver.0.4 확정 §6 — 구간 UI 유지 + 전체 교체 명시).
 * 데이터는 lib/alternatives-mock의 목업 — 엔진 alternatives 출력(#14 ⑨, #33 후속) 연결 시
 * 이 컴포넌트의 props 타입만 엔진 계약으로 바뀌고 상호작용은 유지된다.
 */
import { useState } from "react";
import type { MockAlternative } from "@/lib/alternatives-mock";
import type { MessageKey } from "@/lib/i18n/messages";

function fmtKstTime(iso: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(iso));
}

export function AlternativeTimetables({ date, alternatives, selectedAltId, recommendedDepartAt, onSelect, tr }: {
  date: string;
  alternatives: MockAlternative[];
  selectedAltId: string | null; // null = 추천 일정
  recommendedDepartAt: string;
  onSelect: (alt: MockAlternative | null) => void;
  tr: (key: MessageKey) => string;
}) {
  const [open, setOpen] = useState(false);
  const dayAlts = alternatives.filter((a) => a.date === date);
  if (dayAlts.length === 0) return null;

  const effectLabel = (alt: MockAlternative) => {
    const delta = alt.effects.localUseDeltaMinutes;
    const localUse = `${tr("alt.localUse")} ${delta > 0 ? "+" : "−"}${Math.abs(delta)}${tr("step1.minutes")}`;
    const places = alt.effects.excludedPlaceIds.length > 0
      ? `${tr("alt.excludes")} ${alt.effects.excludedPlaceIds.length}`
      : tr("alt.sameComposition");
    return `${localUse} · ${places}`;
  };

  return (
    <div className="mt-2">
      <button
        className="rounded border border-blue-300 bg-blue-50 px-2 py-1 text-xs text-blue-700"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {tr("alt.toggle")} {open ? "−" : "+"}
        <span className="ml-2 rounded bg-amber-100 px-1 py-0.5 text-amber-800">{tr("alt.mockBadge")}</span>
      </button>
      {open && (
        <div className="mt-2 space-y-1">
          <p className="rounded bg-teal-50 p-2 text-xs text-teal-700">{tr("alt.note")}</p>
          <button
            className={`block w-full rounded border px-3 py-2 text-left text-sm ${selectedAltId === null ? "border-blue-600 bg-blue-50" : ""}`}
            aria-pressed={selectedAltId === null}
            onClick={() => onSelect(null)}
          >
            <span className="font-medium tabular-nums">{fmtKstTime(recommendedDepartAt)}</span>
            <span className="ml-2 text-xs text-gray-500">{tr("alt.recommended")}</span>
          </button>
          {dayAlts.map((alt) => (
            <button
              key={alt.id}
              className={`block w-full rounded border px-3 py-2 text-left text-sm ${selectedAltId === alt.id ? "border-blue-600 bg-blue-50" : ""}`}
              aria-pressed={selectedAltId === alt.id}
              onClick={() => onSelect(alt)}
            >
              <span className="font-medium tabular-nums">
                {fmtKstTime(alt.days.find((d) => d.date === date)!.rides[0].departAt)}
              </span>
              <span className="ml-2 text-xs text-gray-500">{effectLabel(alt)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
