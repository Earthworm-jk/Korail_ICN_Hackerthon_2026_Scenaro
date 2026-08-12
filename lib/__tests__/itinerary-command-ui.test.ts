import { describe, expect, it } from "vitest";
import {
  commandInputUnavailable,
  overselectionProposalOf,
  selectionUndoAfterChange,
  selectionUndoAvailable,
  commandPanelUnavailable,
  commandResponseIsCurrent,
  selectionAfterCommand,
  stateAfterRouteRecommendation,
} from "../itinerary-command-ui";

describe("자연어 명령 응답 적용 경계 (#144 리뷰)", () => {
  /**
   * #171 — 과선택은 **패널을 여는 조건에서 뺐다.**
   *
   * 앞서는 여기 묶여 있어서 패널을 여는 버튼까지 잠겼고, 그래서 왜 잠겼는지 설명하는
   * 문구를 볼 방법이 없었다 — 사용자에게는 이유 없이 회색인 버튼이었다. AI를 표방하는
   * 화면에서 **가장 도움이 필요한 순간**에 그랬다.
   *
   * 지금은 연다. 열어서 상황을 설명하고 정리를 제안한다. 다만 자연어 **입력**은 계속
   * 막는다 — 지금 일정은 확정이 아니라 제외 판단용 미리보기라(#84), 그 위에서 편집을
   * 받으면 확정되지 않은 것을 편집하게 된다.
   */
  const ready = {
    hasCandidates: true,
    hasPlannedResult: true,
    reopened: false,
    alternativeSelected: false,
  };

  it("과선택이어도 패널은 열린다 — 이유를 볼 수 있어야 한다", () => {
    expect(commandPanelUnavailable({ ...ready, requiresSelectionAdjustment: true })).toBe(false);
    expect(commandPanelUnavailable({ ...ready, requiresSelectionAdjustment: false })).toBe(false);
  });

  it("과선택이면 자연어 입력은 막는다 — 정리가 먼저다", () => {
    expect(commandInputUnavailable({ ...ready, requiresSelectionAdjustment: true })).toBe(true);
    expect(commandInputUnavailable({ ...ready, requiresSelectionAdjustment: false })).toBe(false);
  });

  /** 열 수 없는 조건은 입력도 당연히 막는다 — 둘이 어긋나면 빈 패널이 열린다 */
  it("패널을 못 여는 조건은 입력도 막는다", () => {
    for (const blocked of [
      { ...ready, hasCandidates: false },
      { ...ready, hasPlannedResult: false },
      { ...ready, reopened: true },
      { ...ready, alternativeSelected: true },
    ]) {
      const gate = { ...blocked, requiresSelectionAdjustment: false };
      expect(commandPanelUnavailable(gate)).toBe(true);
      expect(commandInputUnavailable(gate)).toBe(true);
    }
  });

  it("제출 뒤 선택 시퀀스가 바뀌면 늦은 응답을 폐기한다", () => {
    expect(commandResponseIsCurrent(7, 7)).toBe(true);
    expect(commandResponseIsCurrent(7, 8)).toBe(false);
  });

  it("확인 창에서 고지한 displaced 장소만 기존 선택에서 제외한다", () => {
    const selected = selectionAfterCommand({
      candidatePlaceIds: ["requested", "displaced", "already-rejected", "newly-scheduled"],
      currentSelectedPlaceIds: new Set(["displaced", "already-rejected"]),
      scheduledPlaceIds: new Set(["requested", "newly-scheduled"]),
      displacedPlaceIds: new Set(["displaced"]),
    });

    expect([...selected]).toEqual(["requested", "already-rejected", "newly-scheduled"]);
  });

  it("동선 추천 적용은 고지한 제외만 반영하고 추천 장소의 방문일을 보존한다", () => {
    expect(stateAfterRouteRecommendation({
      currentSelectedPlaceIds: new Set(["kept", "displaced"]),
      currentPreferredVisitDates: { displaced: "2026-08-12", kept: "2026-08-13" },
      recommendation: {
        placeId: "recommended",
        targetDate: "2026-08-13",
        displacedPlaceIds: ["displaced"],
      },
    })).toEqual({
      selectedPlaceIds: new Set(["kept", "recommended"]),
      preferredVisitDates: { kept: "2026-08-13", recommended: "2026-08-13" },
    });
  });
});

/**
 * 정리 제안의 시점 경계 (PR #185 리뷰).
 *
 * 선택은 즉시 바뀌고 일정은 응답 후에 바뀐다. 그 사이에는 방금 고른 장소가 "이전 일정에
 * 없다"는 이유만으로 미배치로 찍히고, 그 상태로 정리를 적용하면 **방금 고른 장소까지
 * 버린다.** 재계산이 실패해 이전 결과가 남으면 그 오판이 계속된다.
 */
describe("정리 제안은 현재 결과일 때만 낸다", () => {
  const capacity = {
    requiresAdjustment: true,
    scheduledPlaceIds: ["place-a", "place-b"],
    minimumExclusionCount: 3,
    selectedCount: 5,
  };

  it("현재 결과면 제안을 만든다", () => {
    expect(overselectionProposalOf({ capacity, selectionStateShown: true })).toEqual({
      keepPlaceIds: ["place-a", "place-b"],
      dropCount: 3,
      selectedCount: 5,
    });
  });

  /** 갱신 중에는 표시 중인 일정이 방금 선택으로 계산된 것이 아니다 */
  it("갱신 중이면 만들지 않는다", () => {
    expect(overselectionProposalOf({ capacity, selectionStateShown: false })).toBeNull();
  });

  /** 재계산이 실패해 이전 결과가 남은 경우도 같은 값으로 걸린다 */
  it("표시 결과가 현재 선택과 어긋나면 만들지 않는다", () => {
    expect(overselectionProposalOf({ capacity: null, selectionStateShown: true })).toBeNull();
    expect(overselectionProposalOf({ capacity: null, selectionStateShown: false })).toBeNull();
  });

  it("과선택이 아니면 만들지 않는다", () => {
    expect(overselectionProposalOf({
      capacity: { ...capacity, requiresAdjustment: false },
      selectionStateShown: true,
    })).toBeNull();
  });

  /**
   * 표시와 실행이 같은 값을 봐야 한다 — 화면은 숨기고 핸들러만 열려 있으면 이벤트 시점의
   * 오래된 closure 로 다시 적용된다. 그래서 핸들러도 이 함수를 다시 부른다.
   */
  it("같은 입력이면 같은 답이다 — 표시와 실행이 갈리지 않는다", () => {
    const input = { capacity, selectionStateShown: false };
    expect(overselectionProposalOf(input)).toBe(overselectionProposalOf(input));
  });
});

/**
 * 정리 되돌리기의 수명 (PR #185 리뷰).
 *
 * **정리 적용 직후에만 유효한 한 단계**다. 그 뒤에 선택이 바뀌었는데 옛 스냅샷을 복원하면
 * 그 사이 작업이 통째로 덮인다. 호출부마다 지우게 하면 새 경로가 생길 때 또 빠뜨리므로
 * (#175에서 같은 실수를 두 번 했다), 적용 결과를 함께 저장해 **선택이 그대로일 때만** 연다.
 */
describe("정리 되돌리기는 적용 직후에만", () => {
  const undo = { appliedPlaceIds: ["a", "b", "c"] };

  it("적용 직후에는 되돌릴 수 있다", () => {
    expect(selectionUndoAvailable(undo, ["a", "b", "c"])).toBe(true);
    // 순서는 상관없다 — 집합이다
    expect(selectionUndoAvailable(undo, ["c", "a", "b"])).toBe(true);
  });

  it("되돌릴 것이 없으면 닫혀 있다", () => {
    expect(selectionUndoAvailable(null, ["a"])).toBe(false);
  });

  /** 사용자가 후보를 껐다 — 복원하면 그 변경이 덮인다 */
  it("장소를 빼면 닫힌다", () => {
    expect(selectionUndoAvailable(undo, ["a", "b"])).toBe(false);
  });

  /** 다른 명령이나 추천이 선택을 늘렸다 — 경로가 무엇이든 같은 값으로 걸린다 */
  it("장소를 더하면 닫힌다", () => {
    expect(selectionUndoAvailable(undo, ["a", "b", "c", "d"])).toBe(false);
  });

  /** 하나 끄고 하나 켜면 개수는 같다 — 개수만 보면 이 경우를 놓친다 */
  it("개수가 같아도 구성이 다르면 닫힌다", () => {
    expect(selectionUndoAvailable(undo, ["a", "b", "z"])).toBe(false);
  });

  it("선택이 비면 닫힌다", () => {
    expect(selectionUndoAvailable(undo, [])).toBe(false);
  });
});

/**
 * 스냅샷은 한 번 벗어나면 돌아오지 않는다 (PR #185 리뷰 3회차).
 *
 * 집합 비교만으로는 **중간 사건을 못 본다** — A에서 하나를 껐다 다시 켜면 집합이 다시 A라
 * 오래된 되돌리기가 되살아난다. #175의 기준 왕복과 같은 한계다. 화면은 매 렌더에서
 * 이 함수를 통과시켜 상태 자체를 없앤다.
 */
describe("정리 되돌리기 스냅샷 수명", () => {
  const undo = { previousPlaceIds: ["a", "b", "c", "d"], appliedPlaceIds: ["a", "b", "c"] };
  /** 화면이 하는 일을 그대로 흉내낸다 — 선택이 바뀔 때마다 통과시킨다 */
  const walk = (selections: string[][]) =>
    selections.reduce<typeof undo | null>(
      (state, selection) => selectionUndoAfterChange(state, selection),
      undo,
    );

  it("적용 직후에는 남아 있다", () => {
    expect(walk([["a", "b", "c"]])).toEqual(undo);
  });

  it("하나를 끄면 버린다", () => {
    expect(walk([["a", "b", "c"], ["a", "b"]])).toBeNull();
  });

  /** 이 경우가 앞 회차에서 되살아났다 */
  it("껐다 다시 켜서 같은 집합으로 돌아와도 되살아나지 않는다", () => {
    expect(walk([["a", "b", "c"], ["a", "b"], ["a", "b", "c"]])).toBeNull();
  });

  it("다른 같은 크기 집합을 거쳐 돌아와도 되살아나지 않는다", () => {
    expect(walk([["a", "b", "c"], ["a", "b", "z"], ["a", "b", "c"]])).toBeNull();
  });

  it("한 번 버린 뒤에는 어떤 선택으로도 돌아오지 않는다", () => {
    expect(walk([["a", "b", "c"], [], ["a", "b", "c"], ["a", "b", "c"]])).toBeNull();
  });

  /** 실행 뒤에는 화면이 null 로 바꾸므로 통과시켜도 그대로 없다 */
  it("실행 뒤에는 다시 노출되지 않는다", () => {
    expect(selectionUndoAfterChange(null, ["a", "b", "c", "d"])).toBeNull();
  });
});
