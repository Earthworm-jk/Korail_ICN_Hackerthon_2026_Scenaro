import { describe, expect, it } from "vitest";
import {
  banner,
  displayedDays,
  initialItineraryView,
  reduceItineraryView,
  rejectedPlaces,
  showEmpty,
  type ItineraryView,
  type ItineraryViewEvent,
} from "../itinerary-view";
import {
  constraintsFromTripInputs,
  tripInputsFromConstraints,
  type SavedItineraryStub,
} from "../saved-itineraries-stub";
import type { ItineraryResult } from "../engine/types";

// PR #35 리뷰 3 — 저장→편집→재열람→재계산 상태 전이와 constraints 왕복을 고정한다

const dayA = { date: "2026-08-12", rides: [], items: [] };
const dayB = { date: "2026-08-13", rides: [], items: [] };

const plannedA: ItineraryResult = {
  status: "planned", days: [dayA], rejectedPlaces: [],
  comparisonKeys: {
    relevanceKey: { selectedWorkPlaceCount: 1, actorOtherWorkPlaceCount: 0 },
    visitablePlaceCount: 1, totalRailMinutes: 100, transferCount: 0, slackSatisfied: true,
  },
  metrics: { totalTravelMinutes: 150, totalRailMinutes: 100, transferCount: 0, departureSlackMinutes: 180 },
};
const plannedB: ItineraryResult = { ...plannedA, days: [dayB] };
const empty: ItineraryResult = { status: "empty", days: [], rejectedPlaces: [{ code: "TRAIN_UNAVAILABLE", placeId: "p1" }] };

const constraintsA = constraintsFromTripInputs(
  { arrivalAt: "2026-08-12T10:00", departureAt: "2026-08-14T18:00", exitOffsetMin: 120, departureBufferMinutes: 120 },
  ["actor-kim-goeun"], ["work-goblin"], ["place-x"],
);

const recordA: SavedItineraryStub = {
  id: "stub-1", title: "A", savedAt: "2026-08-08T18:00:00.000Z",
  days: [dayA], constraints: constraintsA, schemaVersion: 1, snapshotVersion: "unversioned",
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

describe("결과 화면 상태 전이", () => {
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
