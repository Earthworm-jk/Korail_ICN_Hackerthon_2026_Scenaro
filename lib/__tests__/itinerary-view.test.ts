import { describe, expect, it } from "vitest";
import {
  banner,
  displayedDays,
  displayedSelectionCapacity,
  initialItineraryView,
  itineraryWarnings,
  reduceItineraryView,
  rejectedPlaces,
  showEmpty,
  themeChipState,
  type ItineraryView,
  type ItineraryViewEvent,
} from "../itinerary-view";
import {
  constraintsFromTripInputs,
  SAVED_SCHEMA_VERSION,
  tripInputsFromConstraints,
  type SavedItineraryStub,
} from "../saved-itineraries-stub";
import type { ItineraryResult } from "../engine/types";

// PR #35 리뷰 3 — 저장→편집→재열람→재계산 상태 전이와 constraints 왕복을 고정한다

const dayA = { date: "2026-08-12", rides: [], items: [], regionWindows: [] };
const dayB = { date: "2026-08-13", rides: [], items: [], regionWindows: [] };

const plannedA: ItineraryResult = {
  status: "planned", days: [dayA], rejectedPlaces: [], warnings: [],
  selectionGroups: { requested: ["work"], covered: ["work"], uncovered: [] },
  comparisonKeys: {
    selectionGroupCoverageCount: 1, selectedUnionPlaceCount: 1,
    activityWarningCount: 0, preferredDateMismatchCount: 0, preferredOrderMismatchCount: 0, totalTravelMinutes: 150, transferCount: 0, slackSatisfied: true,
  },
  metrics: { totalTravelMinutes: 150, totalRailMinutes: 100, transferCount: 0, departureSlackMinutes: 180 },
};
const plannedB: ItineraryResult = { ...plannedA, days: [dayB] };
const empty: ItineraryResult = {
  status: "empty",
  days: [],
  rejectedPlaces: [{ code: "TRAIN_UNAVAILABLE", placeId: "p1" }],
  warnings: [],
  selectionGroups: {
    requested: ["work"], covered: [],
    uncovered: [{ group: "work", reasons: ["TRAIN_UNAVAILABLE"] }],
  },
};

const constraintsA = constraintsFromTripInputs(
  { arrivalAt: "2026-08-12T10:00", departureAt: "2026-08-14T18:00", airportReadyAt: "2026-08-12T12:00", airportArrivalDeadline: "2026-08-14T16:00" },
  ["actor-kim-goeun"], ["work-goblin"], ["place-x"],
);

const recordA: SavedItineraryStub = {
  id: "stub-1", title: "A", savedAt: "2026-08-08T18:00:00.000Z",
  days: [dayA], constraints: constraintsA, schemaVersion: SAVED_SCHEMA_VERSION, snapshotVersion: "unversioned",
  context: { actors: [{ id: "actor-kim-goeun", name: { ko: "김고은", en: "Kim Go-eun" } }], works: [] },
};

function run(events: ItineraryViewEvent[], from: ItineraryView = initialItineraryView): ItineraryView {
  return events.reduce(reduceItineraryView, from);
}

describe("constraints 왕복 (재열람 복원 경로)", () => {
  it("저장 constraints → 입력 필드 → constraints가 완전 동일하다 — 재열람 후 재계산은 저장 당시 조건을 쓴다", () => {
    const inputs = tripInputsFromConstraints(constraintsA);
    const rebuilt = constraintsFromTripInputs(
      inputs,
      constraintsA.selectedActorIds,
      constraintsA.selectedWorkIds,
      constraintsA.excludedPlaceIds,
    );
    expect(rebuilt).toEqual(constraintsA);
  });
});

describe("경고 보존 (#43 경고 누락 0건 — PR #44 리뷰 2)", () => {
  const warning = { code: "ACTIVITY_WINDOW_MISMATCH" as const, placeId: "p-warned", detail: "UNVERIFIED_HOURS" as const };

  it("경고 있는 일정을 저장하고 재열람해도 경고가 유지된다", () => {
    const recordWithWarnings: SavedItineraryStub = { ...recordA, warnings: [warning] };
    const reopened = reduceItineraryView(initialItineraryView, { type: "REOPEN", record: recordWithWarnings });
    expect(itineraryWarnings(reopened)).toEqual([warning]);
  });

  it("경고 필드가 없는 기존 레코드는 빈 배열로 취급한다 — 호환", () => {
    const reopened = reduceItineraryView(initialItineraryView, { type: "REOPEN", record: recordA });
    expect(itineraryWarnings(reopened)).toEqual([]);
  });
});

describe("결과 화면 상태 전이", () => {
  it("과선택 수치와 저장 판정은 추천 원본이 아니라 화면의 전체 교체 대안을 따른다", () => {
    const selected = ["p1", "p2"];
    const recommendedDay = {
      ...dayA,
      items: [{
        placeId: "p1",
        arriveAt: "2026-08-12T01:00:00.000Z",
        departAt: "2026-08-12T02:00:00.000Z",
        accessMinutes: 10,
      }],
    };
    const alternativeDay = {
      ...dayB,
      items: [
        ...recommendedDay.items,
        {
          placeId: "p2",
          arriveAt: "2026-08-13T03:00:00.000Z",
          departAt: "2026-08-13T04:00:00.000Z",
          accessMinutes: 10,
        },
      ],
    };
    const recommended = run([{
      type: "PLAN_SUCCESS",
      result: { ...plannedA, days: [recommendedDay] },
    }]);
    expect(displayedSelectionCapacity(recommended, selected)).toMatchObject({
      schedulableCount: 1,
      requiresAdjustment: true,
    });

    const withAlternative = reduceItineraryView(recommended, {
      type: "SELECT_ALT",
      alt: {
        kind: "mock",
        id: "mock-capacity",
        date: "2026-08-13",
        shiftMinutes: 0,
        days: [alternativeDay],
        effects: { localUseDeltaMinutes: 0, excludedPlaceIds: [] },
      },
    });
    expect(displayedSelectionCapacity(withAlternative, selected)).toMatchObject({
      schedulableCount: 2,
      requiresAdjustment: false,
    });
  });

  it("empty와 재열람에는 과선택 미리보기 수치를 표시하지 않는다", () => {
    const emptied = run([{ type: "PLAN_SUCCESS", result: empty }]);
    expect(displayedSelectionCapacity(emptied, ["p1"])).toBeNull();

    const reopened = reduceItineraryView(initialItineraryView, { type: "REOPEN", record: recordA });
    expect(displayedSelectionCapacity(reopened, ["p1"])).toBeNull();
  });

  it("공항버스 대안 후속 응답은 기존 추천을 유지한 채 additive로 붙는다", () => {
    const afterPlan = run([{ type: "PLAN_SUCCESS", result: plannedA }]);
    const enriched = reduceItineraryView(afterPlan, {
      type: "GATEWAY_ALTERNATIVES_SUCCESS",
      alternatives: [],
    });
    expect(enriched.result).toEqual(plannedA);
    expect(displayedDays(enriched)).toEqual([dayA]);
  });

  it("저장 A → 편집 B 계산 → A 재열람: 화면은 A, 재계산 성공 시 재열람 해제 후 새 결과", () => {
    const afterB = run([{ type: "PLAN_START" }, { type: "PLAN_SUCCESS", result: plannedB }]);
    const reopenedA = reduceItineraryView(afterB, { type: "REOPEN", record: recordA });
    expect(displayedDays(reopenedA)).toEqual([dayA]); // B가 아니라 저장본 A
    expect(banner(reopenedA)).toBe("reopened");

    const recalced = run([{ type: "PLAN_START" }, { type: "PLAN_SUCCESS", result: plannedA }], reopenedA);
    expect(recalced.reopened).toBeNull();
    expect(displayedDays(recalced)).toEqual([dayA]);
  });

  it("empty 상태에서 재열람하면 empty 패널·사유 목록이 숨고 저장 일정만 보인다", () => {
    const emptied = run([{ type: "PLAN_START" }, { type: "PLAN_SUCCESS", result: empty }]);
    expect(showEmpty(emptied)).toBe(true);

    const reopened = reduceItineraryView(emptied, { type: "REOPEN", record: recordA });
    expect(showEmpty(reopened)).toBe(false);
    expect(rejectedPlaces(reopened)).toEqual([]);
    expect(displayedDays(reopened)).toEqual([dayA]);
  });

  it("계산 실패는 기존 화면을 유지한다 — 재열람 중 실패해도 저장 일정 유지", () => {
    const reopened = reduceItineraryView(initialItineraryView, { type: "REOPEN", record: recordA });
    const failed = run([{ type: "PLAN_START" }, { type: "PLAN_FAILED" }], reopened);
    expect(failed.planError).toBe("unexpected");
    expect(displayedDays(failed)).toEqual([dayA]);
  });

  it("대안 선택은 재열람을 해제하고, 재계산 성공은 대안을 해제한다", () => {
    const alt = {
      kind: "mock" as const,
      id: "mock-1", date: "2026-08-12", shiftMinutes: 60, days: [dayB],
      effects: { localUseDeltaMinutes: -60, excludedPlaceIds: [] },
    };
    const reopened = reduceItineraryView(initialItineraryView, { type: "REOPEN", record: recordA });
    const withAlt = reduceItineraryView(reopened, { type: "SELECT_ALT", alt });
    expect(withAlt.reopened).toBeNull();
    expect(displayedDays(withAlt)).toEqual([dayB]);
    expect(banner(withAlt)).toBe("swapped");

    const recalced = run([{ type: "PLAN_START" }, { type: "PLAN_SUCCESS", result: plannedA }], withAlt);
    expect(recalced.selectedAlt).toBeNull();
    expect(banner(recalced)).toBeNull();
  });
});

// PR #99 리뷰 — #85 즉시 재계산의 상태 전이 3건
describe("즉시 재계산 상태 전이 (#85)", () => {
  it("재계산 중에도 직전 일정이 그대로 보인다 — 화면이 비지 않는다", () => {
    const planning = run([{ type: "PLAN_SUCCESS", result: plannedA }, { type: "PLAN_START" }]);
    expect(planning.planning).toBe(true);
    expect(displayedDays(planning)).toEqual([dayA]);
  });

  it("재계산 중에 경고·제외 사유·배너도 함께 유지된다 — 일정만 남고 경고가 사라지지 않는다", () => {
    const withWarning: ItineraryResult = {
      ...plannedA,
      warnings: [
        { code: "ACTIVITY_WINDOW_MISMATCH", placeId: "p1", detail: "CONSERVATIVE_BUFFER_MISMATCH" },
      ],
      rejectedPlaces: [{ code: "TRAIN_UNAVAILABLE", placeId: "p2" }],
    };
    const planning = run([{ type: "PLAN_SUCCESS", result: withWarning }, { type: "PLAN_START" }]);
    expect(itineraryWarnings(planning)).toHaveLength(1);
    expect(rejectedPlaces(planning)).toHaveLength(1);

    const reopenedThenPlanning = run([{ type: "REOPEN", record: recordA }, { type: "PLAN_START" }]);
    expect(displayedDays(reopenedThenPlanning)).toEqual([dayA]);
    expect(banner(reopenedThenPlanning)).toBe("reopened");
  });

  it("재계산 중에도 empty 판정을 유지한다 — 직전 결론이 조용히 사라지지 않는다", () => {
    const planning = run([{ type: "PLAN_SUCCESS", result: empty }, { type: "PLAN_START" }]);
    expect(showEmpty(planning)).toBe(true);
  });

  it("1곳 → 0곳: 직전 일정을 남기지 않는다 — 남으면 그대로 저장된다", () => {
    const planned = run([{ type: "PLAN_SUCCESS", result: plannedA }]);
    expect(displayedDays(planned)).toEqual([dayA]);

    const cleared = reduceItineraryView(planned, { type: "SELECTION_CLEARED" });
    expect(displayedDays(cleared)).toBeNull();
    expect(showEmpty(cleared)).toBe(false);
    expect(rejectedPlaces(cleared)).toEqual([]);
    expect(itineraryWarnings(cleared)).toEqual([]);
    expect(banner(cleared)).toBeNull();
  });

  it("계산 중에 0곳이 되면 진행 표시까지 내린다 — 응답은 호출부가 버린다", () => {
    const cleared = run([
      { type: "PLAN_SUCCESS", result: plannedA },
      { type: "PLAN_START" },
      { type: "SELECTION_CLEARED" },
    ]);
    expect(cleared.planning).toBe(false);
    expect(cleared.result).toBeNull();
    expect(displayedDays(cleared)).toBeNull();
  });

  it("0곳 상태에서는 저장 대상 일정이 없다", () => {
    const cleared = run([{ type: "PLAN_SUCCESS", result: plannedA }, { type: "SELECTION_CLEARED" }]);
    expect(displayedSelectionCapacity(cleared, ["place-x"])).toBeNull();
  });
});

describe("PR #156 리뷰 4 — themeChipState", () => {
  it("조회 전에는 모른다", () => {
    expect(themeChipState(null)).toBe("unknown");
  });

  // 스냅샷 자체가 없는 것과 "추천이 없다"는 다른 사실이다
  it("스냅샷이 없으면 없다고 하지 않는다", () => {
    expect(themeChipState({ status: "unavailable" })).toBe("unknown");
  });

  it("기준을 통과한 권역이 없으면 없음이다", () => {
    expect(themeChipState({ status: "none" })).toBe("none");
  });

  /** `point`는 지도용 좌표다 — 없어도 추천은 있다 */
  it("좌표가 없어도 ok면 추천이 있다", () => {
    expect(themeChipState({ status: "ok" })).toBe("available");
  });
});
