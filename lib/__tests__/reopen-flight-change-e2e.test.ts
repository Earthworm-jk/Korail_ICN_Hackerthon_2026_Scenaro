/**
 * 저장 → 다시 열기 → 항공편 변경 → 재계산 E2E (#6 품질·시연).
 *
 * 로드맵의 최종 MVP 완료 기준에서 **`다시 연 일정에서 항공편 변경과 재계산`이 유일하게
 * 비어 있던 인증·저장 항목**이다. 저장·목록·다시 열기는 PR #74로 닫혔는데, 다시 연
 * 뒤에 조건을 바꾸는 경로는 검증된 적이 없다.
 *
 * 이 경로가 특히 조용히 깨진다. 재열람 중에는 **자동 재계산이 꺼져 있어서**
 * (`autoPlanDecision` → `skip`) 조건만 바꾸고 아무 일도 안 일어나면 화면은 저장 당시
 * 일정을 그대로 보여준다 — 사용자는 **바뀐 항공편이 반영된 일정을 보고 있다고 믿는다.**
 * 실패가 아니라 침묵이라 더 나쁘다.
 */
import { describe, expect, it } from "vitest";
import { planItinerary, type PlanRequest } from "../actions/itinerary";
import { getCandidatePlaces } from "../actions/places";
import { excludedPlaceIdsFrom, initialCandidateIds } from "../candidates";
import { autoPlanDecision } from "../auto-plan";
import {
  constraintsFromTripInputs,
  tripInputsFromConstraints,
  SAVED_SCHEMA_VERSION,
  type SavedItineraryStub,
} from "../saved-itineraries-stub";
import {
  displayedDays,
  initialItineraryView,
  reduceItineraryView,
  type ItineraryView,
} from "../itinerary-view";

const SELECTION = { selectedActorIds: ["actor-kim-go-eun"], selectedWorkIds: ["work-goblin"] };

const FIRST_TRIP = {
  arrivalAt: "2026-08-12T10:00:00+09:00",
  departureAt: "2026-08-14T18:00:00+09:00",
  airportReadyAt: "2026-08-12T12:00:00+09:00",
  airportArrivalDeadline: "2026-08-14T16:00:00+09:00",
};

/** 하루를 "역 · 장소들"로 눌러 비교한다 — 무엇이 바뀌었는지 눈으로 읽히게 */
const shapeOf = (days: ReturnType<typeof displayedDays>) =>
  (days ?? []).map((day) => day.items.map((item) => item.placeId).join(","));

async function firstPlan() {
  const data = await getCandidatePlaces(SELECTION);
  const selected = new Set(initialCandidateIds(data.candidates));
  const request: PlanRequest = {
    ...FIRST_TRIP,
    ...SELECTION,
    excludedPlaceIds: excludedPlaceIdsFrom(data.candidates, selected),
  };
  const action = await planItinerary(request);
  if (!action.ok || action.result.status !== "planned") throw new Error("첫 계획 실패");
  return { request, result: action.result };
}

/** 화면이 저장하는 모양 그대로 — 저장 당시 조건과 일정을 함께 담는다 */
function savedRecordFrom(request: PlanRequest, days: SavedItineraryStub["days"]): SavedItineraryStub {
  return {
    id: "saved-1",
    title: "강릉 2박 3일 · 김고은",
    savedAt: "2026-08-12T11:00:00+09:00",
    days,
    constraints: request,
    schemaVersion: SAVED_SCHEMA_VERSION,
    snapshotVersion: "unversioned",
    context: { actors: [], works: [] },
  };
}

/**
 * 지연 폭은 **2시간**이다. 처음에 4시간을 썼더니 일정이 아예 성립하지 않아
 * (`status: "empty"`) 테스트가 조기 반환으로 **빈 채 통과**했다 — 재열람 해제를
 * 뒤집어도 초록이었다. 이 파일에서 조기 반환을 쓰지 않는 이유다.
 */
const DELAY_HOURS = 2;

/** 항공 도착을 늦춘다 — 화면의 datetime-local 입력 왕복을 그대로 거친다 */
function delayedByHours(constraints: PlanRequest, hours: number): PlanRequest {
  const shift = (iso: string) => new Date(Date.parse(iso) + hours * 3_600_000).toISOString();
  const delayed: PlanRequest = {
    ...constraints,
    arrivalAt: shift(constraints.arrivalAt),
    airportReadyAt: shift(constraints.airportReadyAt),
  };
  return constraintsFromTripInputs(
    tripInputsFromConstraints(delayed),
    [...constraints.selectedActorIds],
    [...constraints.selectedWorkIds],
    [...constraints.excludedPlaceIds],
  );
}

describe("#6 다시 연 일정에서 항공편 변경과 재계산", () => {
  it("재열람 중에는 자동 재계산이 저장 일정을 덮지 않는다", () => {
    expect(
      autoPlanDecision({ onPlacesStep: true, hasCandidates: true, reopened: true, selectedCount: 5 }),
    ).toBe("skip");
  });

  it("다시 연 뒤 항공편을 늦추면 새 일정이 나오고 재열람이 풀린다", async () => {
    const { request, result } = await firstPlan();
    const saved = savedRecordFrom(request, result.days);

    // 저장 뒤 다른 조건으로 계산해 둔 상태에서 저장본을 다시 연다 — 실제 사용 순서다.
    // 화면의 추천과 저장본이 같으면 "저장본을 보여준다"를 증명하지 못한다.
    const changed = delayedByHours(saved.constraints, DELAY_HOURS);
    expect(changed.arrivalAt).not.toBe(saved.constraints.arrivalAt);
    const changedAction = await planItinerary(changed);
    if (!changedAction.ok) throw new Error("변경 계산 실패");
    if (changedAction.result.status !== "planned") {
      throw new Error(`변경 계산이 planned 가 아니다: ${changedAction.result.status}`);
    }
    expect(shapeOf(changedAction.result.days)).not.toEqual(shapeOf(saved.days));

    let view: ItineraryView = reduceItineraryView(initialItineraryView, {
      type: "PLAN_SUCCESS",
      result: changedAction.result,
    });

    // 다시 열기 — 추천이 아니라 저장 당시 일정을 보여준다
    view = reduceItineraryView(view, { type: "REOPEN", record: saved });
    expect(view.reopened).not.toBeNull();
    expect(shapeOf(displayedDays(view))).toEqual(shapeOf(saved.days));

    // 항공편 지연을 반영해 재계산
    view = reduceItineraryView(view, { type: "PLAN_START" });
    view = reduceItineraryView(view, { type: "PLAN_SUCCESS", result: changedAction.result });

    // 재열람이 풀려야 새 일정이 보인다 — 안 풀리면 저장 당시 일정이 계속 보인다
    expect(view.reopened).toBeNull();
    expect(shapeOf(displayedDays(view))).toEqual(shapeOf(changedAction.result.days));
    expect(shapeOf(displayedDays(view))).not.toEqual(shapeOf(saved.days));
  });

  it("저장 레코드는 재계산에 영향을 받지 않는다", async () => {
    const { request, result } = await firstPlan();
    const saved = savedRecordFrom(request, result.days);
    const before = JSON.stringify(saved);

    let view: ItineraryView = reduceItineraryView(initialItineraryView, {
      type: "PLAN_SUCCESS",
      result,
    });
    view = reduceItineraryView(view, { type: "REOPEN", record: saved });
    const action = await planItinerary(delayedByHours(saved.constraints, DELAY_HOURS));
    if (!action.ok || action.result.status !== "planned") throw new Error("재계산 실패");
    const after = reduceItineraryView(view, { type: "PLAN_SUCCESS", result: action.result });

    expect(after.reopened).toBeNull();
    // 저장본은 화면 상태와 별개다 — 재계산이 레코드를 건드리면 목록의 일정이 바뀐다
    expect(JSON.stringify(saved)).toBe(before);
  });

  /**
   * 재계산이 실패하면 **다시 연 일정이 그대로 남아야 한다.** 여기서 화면을 비우면
   * 사용자는 저장해 둔 일정까지 잃은 것처럼 본다.
   */
  it("재계산이 실패해도 다시 연 일정은 그대로 남는다", async () => {
    const { request, result } = await firstPlan();
    const saved = savedRecordFrom(request, result.days);

    let view: ItineraryView = reduceItineraryView(initialItineraryView, {
      type: "PLAN_SUCCESS",
      result,
    });
    view = reduceItineraryView(view, { type: "REOPEN", record: saved });
    view = reduceItineraryView(view, { type: "PLAN_START" });
    view = reduceItineraryView(view, { type: "PLAN_FAILED" });

    expect(view.reopened).not.toBeNull();
    expect(view.planError).toBe("unexpected");
    expect(shapeOf(displayedDays(view))).toEqual(shapeOf(saved.days));
  });

  /** 조건이 아예 성립하지 않는 변경도 저장 일정을 지우지 않는다 */
  it("불가능한 변경은 사유를 남기고 다시 연 일정을 유지한다", async () => {
    const { request, result } = await firstPlan();
    const saved = savedRecordFrom(request, result.days);

    let view: ItineraryView = reduceItineraryView(initialItineraryView, {
      type: "PLAN_SUCCESS",
      result,
    });
    view = reduceItineraryView(view, { type: "REOPEN", record: saved });

    // 도착이 출국보다 늦다 — 성립할 수 없는 조건
    const impossible: PlanRequest = { ...saved.constraints, arrivalAt: saved.constraints.departureAt };
    const action = await planItinerary(impossible);
    view = reduceItineraryView(view, { type: "PLAN_START" });
    view = action.ok && action.result.status === "planned"
      ? reduceItineraryView(view, { type: "PLAN_SUCCESS", result: action.result })
      : reduceItineraryView(view, { type: "PLAN_INVALID" });

    expect(view.reopened).not.toBeNull();
    expect(shapeOf(displayedDays(view))).toEqual(shapeOf(saved.days));
  });
});
