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
  "ai.overselectionTitle": "{keep} of your {selected} places can fit.",
  "ai.overselectionBasis": "Covers your works evenly, then fits as many as possible.",
  "ai.overselectionKeepLabel": "Places that fit",
  "ai.overselectionApply": "Keep these {keep}",
  "ai.overselectionPickMyself": "I'll choose myself",
  "ai.overselectionApplied": "Recalculated with the trimmed selection.",
  "ai.overselectionUndo": "Undo",
  "ai.fillTitle": "Want to look for more filming locations to fit in?",
  "ai.fillDay": "Day {day}",
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
  overselection?: { keepPlaceIds: string[]; dropCount: number; selectedCount: number } | null;
  onUndoOverselection?: () => void;
  recommendDayCount?: number;
  onRecommendDay?: (dayIndex: number) => void;
  keptPlaceIds?: string[];
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
    overselection: options.overselection ?? null,
    onApplyOverselection: () => undefined,
    onPickOverselection: () => undefined,
    onUndoOverselection: options.onUndoOverselection,
    recommendDayCount: options.recommendDayCount ?? 0,
    onRecommendDay: options.onRecommendDay,
    keptPlaceIds: options.keptPlaceIds,
    onToggleKeep: () => undefined,
  }));
}

describe("AI 일정 조율 패널 리뷰 회귀", () => {
  it("긴 카드 본문은 독립 스크롤 영역을 제공한다", () => {
    const html = render();
    expect(html).toContain("data-itinerary-command-scroll");
    expect(html).toContain("overflow-y-auto");
    expect(html).toContain("max-h-[min(60dvh,560px)]");
  });

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
        kind: "date",
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
    kind: "date", decision: "needs_confirmation", placeId: "p1", placeIds: ["p1", "p2"],
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

/**
 * 과선택 정리 제안 (#171).
 *
 * 재란님이 보고한 세 문제를 한 화면으로 닫는다 — AI가 회색이다, 9곳이 어디인지 모른다,
 * "제외할 장소 선택"을 눌러도 아무 일이 없다.
 */
describe("과선택 정리 제안", () => {
  const overselection = {
    keepPlaceIds: ["place-a", "place-b", "place-c"],
    dropCount: 11,
    selectedCount: 14,
  };

  it("고른 수와 들어가는 수를 함께 말한다", () => {
    const html = render({ overselection, disabled: true });
    expect(html).toContain("3 of your 14 places can fit.");
  });

  /** 지금까지 어느 곳이 들어가는지 아무 데도 없었다 (#183) */
  it("들어가는 곳을 이름으로 나열한다", () => {
    const html = render({ overselection, disabled: true });
    for (const placeId of overselection.keepPlaceIds) expect(html).toContain(placeId);
  });

  it("기준을 밝힌다 — 무엇이 고른 조합인지", () => {
    expect(render({ overselection, disabled: true }))
      .toContain("Covers your works evenly");
  });

  it("한 번에 정리하는 버튼과 직접 고르는 길을 함께 준다", () => {
    const html = render({ overselection, disabled: true });
    expect(html).toContain("Keep these 3");
    // #84가 지킨 "사용자가 제외를 결정한다"는 길도 남긴다
    expect(html).toContain("I&#x27;ll choose myself");
    // #207에서 후보 목록은 모달로 이동했다. 사라진 인라인 목록의 앵커로 보내면 무반응처럼 보인다.
    expect(html).not.toContain('href="#place-picker"');
    expect(html).toContain('<button type="button"');
  });

  /** 입력은 막혀 있어도 이유가 보여야 한다 — 이유 없는 회색이 문제였다 */
  it("입력이 막힌 이유를 함께 보여준다", () => {
    expect(render({ overselection, disabled: true, disabledMessage: "ai.disabledOverselection" }))
      .toContain("Reduce your selection first.");
  });

  it("과선택이 아니면 카드를 그리지 않는다", () => {
    const html = render({ overselection: null });
    expect(html).not.toContain("places can fit");
  });

  describe("되돌리기", () => {
    it("정리한 뒤에는 되돌리기를 준다", () => {
      const html = render({ overselection: null, onUndoOverselection: () => undefined });
      expect(html).toContain("Recalculated with the trimmed selection.");
      expect(html).toContain("Undo");
    });

    /** 아직 과선택이면 되돌릴 것이 없다 — 두 줄이 같이 뜨면 무엇이 현재인지 모른다 */
    it("아직 과선택이면 되돌리기를 숨긴다", () => {
      const html = render({ overselection, onUndoOverselection: () => undefined });
      expect(html).not.toContain("Recalculated with the trimmed selection.");
    });
  });
});

/**
 * 채우기 제안 (#171).
 *
 * 과선택 쪽과 대칭인 빈자리다 — 여유가 남을 때 화면이 **먼저 말하지 않았다.**
 * `recommend_along_route`는 이미 끝까지 구현돼 있고 진입점만 없었다.
 */
describe("채우기 제안", () => {
  const onRecommendDay = () => undefined;

  it("날짜만큼 버튼을 준다", () => {
    const html = render({ recommendDayCount: 3, onRecommendDay });
    expect(html).toContain("Want to look for more filming locations to fit in?");
    for (const day of ["Day 1", "Day 2", "Day 3"]) expect(html).toContain(day);
  });

  /** 남은 시간을 분으로 주장하지 않는다 — 창 값은 접근·체류를 빼지 않아 사실이 아니다 */
  it("남은 시간을 숫자로 말하지 않는다", () => {
    const html = render({ recommendDayCount: 2, onRecommendDay });
    expect(html).not.toMatch(/\d+\s*(분|시간|minutes|hours)/);
  });

  /** 정리가 먼저다 — 두 제안이 같이 뜨면 무엇을 하라는 것인지 알 수 없다 */
  it("과선택이면 채우기 제안을 숨긴다", () => {
    const html = render({
      recommendDayCount: 3,
      onRecommendDay,
      overselection: { keepPlaceIds: ["a"], dropCount: 2, selectedCount: 3 },
    });
    expect(html).not.toContain("Want to look for more filming locations to fit in?");
  });

  it("일정이 없으면 그리지 않는다", () => {
    expect(render({ recommendDayCount: 0, onRecommendDay }))
      .not.toContain("Want to look for more filming locations to fit in?");
  });

  /**
   * PR #186 리뷰 — 다른 진입점(입력·제출·예시)은 전부 `disabled || pending`을 본다.
   * `pending`만 보면 재열람·대안 화면에서 **눌리는데 아무 반응이 없는 버튼**이 된다:
   * `submitItineraryCommand`의 가드에서 조용히 return 되기 때문이다.
   */
  const dayButtons = (html: string) =>
    [...html.matchAll(/<button[^>]*>Day \d<\/button>/g)].map(([tag]) => tag);
  // 클래스명에 `disabled:opacity-40`이 있으므로 속성으로 좁힌다
  const isDisabled = (tag: string) => / disabled=""/.test(tag);

  it("계산 중에는 누를 수 없다", () => {
    const buttons = dayButtons(render({ recommendDayCount: 2, onRecommendDay, pending: true }));
    expect(buttons).toHaveLength(2);
    for (const button of buttons) expect(isDisabled(button)).toBe(true);
  });

  it("명령을 받을 수 없는 화면에서는 누를 수 없다", () => {
    const buttons = dayButtons(render({ recommendDayCount: 3, onRecommendDay, disabled: true }));
    expect(buttons).toHaveLength(3);
    for (const button of buttons) expect(isDisabled(button)).toBe(true);
  });

  it("받을 수 있으면 눌린다", () => {
    const buttons = dayButtons(render({
      recommendDayCount: 3, onRecommendDay, disabled: false, pending: false,
    }));
    expect(buttons).toHaveLength(3);
    for (const button of buttons) expect(isDisabled(button)).toBe(false);
  });
});

/** 적용 전 개별 수정 (#84 개정) */
describe("제안 목록 개별 수정", () => {
  const overselection = { keepPlaceIds: ["place-a", "place-b"], dropCount: 3, selectedCount: 5 };

  it("각 장소를 누를 수 있는 칩으로 그린다", () => {
    const html = render({ overselection, disabled: true });
    expect(html).toContain('aria-pressed="true"');
    expect((html.match(/aria-pressed/g) ?? []).length).toBe(2);
  });

  it("뺀 곳은 눌리지 않은 상태로 보인다", () => {
    const html = render({ overselection, disabled: true, keptPlaceIds: ["place-a"] });
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain("line-through");
  });

  /** 버튼 문구가 제안 수 그대로면 사용자가 손본 결과와 어긋난다 */
  it("적용 버튼이 손본 수를 말한다", () => {
    expect(render({ overselection, disabled: true, keptPlaceIds: ["place-a"] }))
      .toContain("Keep these 1");
  });

  it("전부 빼면 적용을 막는다", () => {
    const html = render({ overselection, disabled: true, keptPlaceIds: [] });
    const apply = html.match(/<button[^>]*>Keep these 0<\/button>/)?.[0] ?? "";
    expect(apply).toMatch(/ disabled=""/);
  });
});
