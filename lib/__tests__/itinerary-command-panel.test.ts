import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ItineraryCommandPanel,
  type CommandFeedback,
} from "../../app/itinerary-command-panel";
import type { MessageKey } from "../i18n/messages";
import type { CommandProposal } from "../itinerary-command-executor";

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
  "ai.appliedDay": "{count}곳을 {date}로 옮겼습니다.",
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
        decision: "ready", placeId: "p1", placeIds: ["p1"], requestedDate: "2026-08-13",
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

describe("#152 갇히지 않는 패널", () => {
  const recommendations: CommandFeedback = {
    kind: "recommendations",
    outcome: { kind: "recommendations", targetDate: "2026-08-13", recommendations: [] },
    submittedSequence: 1,
  } as never;

  // 닫기가 모두 막힌 상태에서 취소 경로마저 없으면 사용자가 갇힌다
  it("추천 상태에도 명시적 취소가 있다", () => {
    expect(render({ feedback: recommendations })).toContain("ai.cancel");
  });

  it("합의한 임시 패널 폭 상한을 지킨다", () => {
    expect(render()).toContain("max-w-[400px]");
  });
});

describe("PR #157 리뷰 1 — 적용 후 문구는 결과를 과장하지 않는다", () => {
  const proposalWith = (over: Partial<CommandProposal>): CommandProposal => ({
    decision: "needs_confirmation", placeId: "p1", placeIds: ["p1", "p2"],
    requestedDate: "2026-08-14", reasons: ["date_adjusted"],
    displaced: [], moved: [], ...over,
  });
  const feedbackWith = (proposal: CommandProposal, applied: boolean): CommandFeedback => ({
    kind: "proposal", applied, submittedSequence: 1,
    outcome: {
      kind: "proposal", proposal,
      nextRequest: {} as never, nextResult: {} as never,
      diff: {} as never, summary: {} as never,
    },
  });
  const appliedWith = (proposal: CommandProposal) => feedbackWith(proposal, true);

  /**
   * 확인 창에서는 "일부는 다른 날로 조정"이라 정확히 알려 놓고, 적용 후에 "2곳을 그 날로
   * 옮겼다"고 하면 **거짓이 된다.** `requestedDate` 폴백이 정확히 그 사고였다.
   */
  it("흩어져 앉으면 날짜도 개수도 단정하지 않는다", () => {
    const html = render({ feedback: appliedWith(proposalWith({ scheduledDate: undefined })) });
    expect(html).toContain("ai.appliedDayPartial");
    expect(html).not.toContain("2026-08-14");
  });

  it("전부 같은 날에 앉았을 때만 날짜와 개수를 말한다", () => {
    const html = render({ feedback: appliedWith(proposalWith({
      scheduledDate: "2026-08-14", decision: "ready", reasons: [],
    })) });
    expect(html).toContain("2");
    expect(html).toContain("2026-08-14");
    expect(html).not.toContain("ai.appliedDayPartial");
  });

  /** 불가 문구도 같은 폴백을 쓰고 있었다 */
  it("통 이동이 불가하면 한 곳처럼 말하지 않는다", () => {
    const html = render({ feedback: appliedWith(proposalWith({ decision: "impossible" })) });
    expect(html).toContain("ai.impossibleDay");
  });

  /**
   * **한 곳짜리는 이 분기에 걸리면 안 된다.** `impossible`에는 원래 `scheduledDate`가
   * 없어서, 대상 수보다 날짜 유무를 먼저 보면 자연어·날짜 버튼으로 장소 하나를 못 옮긴
   * 기존 경로까지 "이 날 일정을 통째로 옮길 수 없습니다"라고 말한다.
   */
  it("한 곳짜리 실패는 장소 이름으로 말한다", () => {
    const html = render({ feedback: appliedWith(proposalWith({
      placeId: "p1", placeIds: ["p1"], decision: "impossible", scheduledDate: undefined,
    })) });
    expect(html).toContain("ai.impossible");
    expect(html).not.toContain("ai.impossibleDay");
  });

  it("한 곳짜리는 확인 대기 상태에서도 DAY 문구를 쓰지 않는다", () => {
    const pending = feedbackWith(
      proposalWith({ placeId: "p1", placeIds: ["p1"], scheduledDate: undefined }), false);
    expect(render({ feedback: pending })).not.toContain("ai.appliedDayPartial");
  });
});
