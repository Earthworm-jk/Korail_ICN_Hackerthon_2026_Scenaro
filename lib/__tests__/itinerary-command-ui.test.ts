import { describe, expect, it } from "vitest";
import {
  commandInputUnavailable,
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
