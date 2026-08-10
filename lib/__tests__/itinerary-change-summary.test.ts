import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ItineraryChangeSummary } from "../../app/itinerary-change-summary";
import type { ItineraryDiff } from "../itinerary-diff";
import type { MessageKey } from "../i18n/messages";

const copy: Partial<Record<MessageKey, string>> = {
  "step4.changeTitle": "AI가 전체 일정을 다시 조율했어요",
  "step4.changeUnchangedTitle": "현재 일정이 유지됐어요",
  "step4.changeUnchangedShort": "재검증 완료 · 변경 없음",
  "step4.changeUnchanged": "기존 일정을 유지했습니다.",
  "step4.changeAddedCount": "추가 {n}곳",
  "step4.changeMovedCount": "방문일 이동 {n}곳",
  "step4.changeDroppedCount": "제외 {n}곳",
  "step4.changeRideCount": "이동 구간 변경 {n}개",
  "step4.changeDetails": "변경 내용 보기",
  "step4.changeAdded": "{place} · 일정에 추가",
  "step4.changeMoved": "{place} · {from}에서 {to}로 이동",
  "step4.changeDropped": "{place} · 일정에서 제외",
  "step4.changeReason": "사유: {reason}",
};

const tr = (key: MessageKey) => copy[key] ?? key;
const placeName = (id: string) => ({ added: "광화문", moved: "영진해변", dropped: "라라무리" })[id] ?? id;

function render(diff: ItineraryDiff) {
  return renderToStaticMarkup(createElement(ItineraryChangeSummary, {
    diff,
    placeName,
    reasonLabel: () => "하루 방문 상한",
    tr,
  }));
}

describe("일정 변화 요약", () => {
  it("추가·이동·제외·이동 구간 변화를 짧은 요약과 접힌 상세로 표시한다", () => {
    const markup = render({
      changed: true,
      places: {
        kept: [],
        added: [{ placeId: "added", date: "2026-08-12" }],
        moved: [{ placeId: "moved", fromDate: "2026-08-12", toDate: "2026-08-13" }],
        dropped: [{ placeId: "dropped", reason: "DAILY_CAPACITY_EXCEEDED" }],
      },
      rides: { kept: [], added: [{} as never], dropped: [{} as never], missed: [] },
    });

    expect(markup).toContain('data-itinerary-change="changed"');
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain("추가 1곳");
    expect(markup).toContain("방문일 이동 1곳");
    expect(markup).toContain("제외 1곳");
    expect(markup).toContain("이동 구간 변경 1개");
    expect(markup).toContain("광화문 · 일정에 추가");
    expect(markup).toContain("영진해변 · 2026-08-12에서 2026-08-13로 이동");
    expect(markup).toContain("라라무리 · 일정에서 제외 · 사유: 하루 방문 상한");
  });

  it("변경이 없으면 애니메이션의 대체 결과로 유지 사실을 알린다", () => {
    const markup = render({
      changed: false,
      places: { kept: [], added: [], moved: [], dropped: [] },
      rides: { kept: [], added: [], dropped: [], missed: [] },
    });

    expect(markup).toContain('data-itinerary-change="unchanged"');
    expect(markup).toContain("현재 일정이 유지됐어요");
    expect(markup).toContain("기존 일정을 유지했습니다.");
    expect(markup).toContain("재검증 완료 · 변경 없음");
    expect(markup).toContain("<details");
  });
});
