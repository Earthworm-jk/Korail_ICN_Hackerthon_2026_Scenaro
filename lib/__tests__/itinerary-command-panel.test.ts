import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ItineraryCommandPanel,
  type CommandFeedback,
} from "../../app/itinerary-command-panel";
import type { MessageKey } from "../i18n/messages";

const copy: Partial<Record<MessageKey, string>> = {
  "ai.title": "AI tuning",
  "ai.subtitle": "Tune the route",
  "ai.inputLabel": "Request",
  "ai.placeholder": "Type a request",
  "ai.submit": "Send",
  "ai.pending": "Tuning…",
  "ai.pendingDetail": "Interpreting your request and checking candidates with the verified itinerary engine.",
  "ai.exampleAdd": "Add a place",
  "ai.exampleRecommend": "Recommend along day 2",
  "ai.exampleExplain": "What changed?",
  "ai.disabled": "Create an itinerary first.",
  "ai.disabledOverselection": "Reduce your selection first.",
  "ai.sourceDeterministic": "Verified result",
  "ai.recommendReady.one": "{count} verified filming location that fits the {date} route is pinned.",
  "ai.recommendReady.other": "{count} verified filming locations that fit the {date} route are pinned.",
};

const tr = (key: MessageKey) => copy[key] ?? key;

function render(options: {
  pending?: boolean;
  disabled?: boolean;
  disabledMessage?: MessageKey;
  feedback?: CommandFeedback | null;
  canUndo?: boolean;
  closeDisabled?: boolean;
} = {}) {
  return renderToStaticMarkup(createElement(ItineraryCommandPanel, {
    value: "",
    pending: options.pending ?? false,
    disabled: options.disabled ?? false,
    disabledMessage: options.disabledMessage,
    onUndo: () => {},
    onClose: () => {},
    closeDisabled: options.closeDisabled ?? false,
    canUndo: options.canUndo ?? false,
    feedback: options.feedback ?? null,
    lastDiff: null,
    onChange: () => undefined,
    onSubmit: () => undefined,
    onExample: () => undefined,
    onApply: () => undefined,
    onDismiss: () => undefined,
    placeName: (id: string) => id,
    tr,
  }));
}

describe("AI 일정 조율 패널 리뷰 회귀", () => {
  it("추천 한 곳은 영어 단수형으로 표시한다", () => {
    const feedback: CommandFeedback = {
      kind: "recommendations",
      interpretation: { source: "deterministic" },
      submittedSequence: 1,
      outcome: {
        kind: "recommendations",
        targetDate: "2026-08-13",
        recommendations: [{
          placeId: "place-one",
          targetDate: "2026-08-13",
          travelMinutesDelta: 10,
          routeMatch: "same_region",
          matchedWorkIds: [],
          displacedPlaceIds: [],
          movedPlaceIds: [],
        }],
      },
    };

    const markup = render({ feedback });
    expect(markup).toContain("1 verified filming location that fits");
    expect(markup).not.toContain("1 verified filming locations");
  });

  it("대기 중에는 의도 해석과 엔진 검증 단계를 설명한다", () => {
    expect(render({ pending: true })).toContain(
      "Interpreting your request and checking candidates with the verified itinerary engine.",
    );
  });

  it("과선택 차단 이유를 일반 비활성 안내와 구분한다", () => {
    const markup = render({
      disabled: true,
      disabledMessage: "ai.disabledOverselection",
    });
    expect(markup).toContain("Reduce your selection first.");
    expect(markup).not.toContain("Create an itinerary first.");
  });
});

describe("#109 실행 취소 버튼", () => {
  const applied: CommandFeedback = {
    kind: "proposal",
    outcome: {
      kind: "proposal",
      proposal: {
        decision: "ready", placeId: "p1", requestedDate: "2026-08-13",
        scheduledDate: "2026-08-13", reasons: [], displaced: [], moved: [],
      },
      nextRequest: {} as never,
      nextResult: {} as never,
      diff: {} as never,
      summary: {} as never,
    },
    applied: true,
    submittedSequence: 1,
  };

  it("적용된 뒤 되돌릴 지점이 있으면 버튼이 보인다", () => {
    expect(render({ feedback: applied, canUndo: true })).toContain("ai.undo");
  });

  // 되돌릴 지점이 없으면 눌러도 아무 일이 없다 — 버튼 자체를 두지 않는다
  it("되돌릴 지점이 없으면 버튼이 없다", () => {
    expect(render({ feedback: applied, canUndo: false })).not.toContain("ai.undo");
  });

  it("아직 확인 대기 중이면 실행 취소가 아니라 적용·취소를 묻는다", () => {
    const pending: CommandFeedback = { ...applied, applied: false };
    const html = render({ feedback: pending, canUndo: true });
    expect(html).not.toContain("ai.undo");
    expect(html).toContain("ai.apply");
  });
});
