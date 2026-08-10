import { describe, expect, it } from "vitest";
import { runVisitDateEdit } from "../actions/itinerary-command";
import { planItinerary, type PlanRequest } from "../actions/itinerary";
import { canEditVisitDate, panelDismissable } from "../itinerary-command-ui";
import { UNDO_POINT_KEYS, undoPointOf } from "../itinerary-undo";
import type { ItineraryResult } from "../engine/types";

/**
 * #109 날짜 선택 버튼·드래그 — 서버 액션과 편집 가능 조건
 *
 * 자연어와 **같은 실행기·같은 판정**을 쓰는지, 그리고 화면과 입력이 어긋난 구간에
 * 편집이 새어 나가지 않는지를 고정한다.
 */

const WORK_GOBLIN = "work-goblin";
const YEONGJIN = "place-yeongjin-beach";

function request(overrides: Partial<PlanRequest> = {}): PlanRequest {
  return {
    arrivalAt: "2026-08-12T10:00:00+09:00",
    departureAt: "2026-08-14T18:00:00+09:00",
    airportReadyAt: "2026-08-12T12:00:00+09:00",
    airportArrivalDeadline: "2026-08-14T16:00:00+09:00",
    selectedActorIds: [],
    selectedWorkIds: [WORK_GOBLIN],
    excludedPlaceIds: [],
    ...overrides,
  };
}

async function scheduled(): Promise<{ placeId: string; date: string }> {
  const res = await planItinerary(request());
  if (!res.ok || res.result.status !== "planned") throw new Error("기준 일정 없음");
  const day = res.result.days.find((d) => d.items.length > 0);
  if (!day) throw new Error("배치된 장소 없음");
  return { placeId: day.items[0].placeId, date: day.date };
}

describe("#109 서버 액션 — 자연어와 같은 경로", () => {
  it("일정에 있는 장소를 다른 날짜로 옮긴다", async () => {
    const { placeId, date } = await scheduled();
    const target = ["2026-08-12", "2026-08-13", "2026-08-14"].find((d) => d !== date)!;
    const res = await runVisitDateEdit({ placeId, targetDate: target, request: request() });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.outcome.kind).toBe("proposal");
    expect(res.outcome.proposal.placeId).toBe(placeId);
    expect(res.outcome.proposal.requestedDate).toBe(target);
    // 판정 셋 중 하나로만 나온다 — 자연어와 같은 계약이다
    expect(["ready", "needs_confirmation", "impossible"])
      .toContain(res.outcome.proposal.decision);
  });

  it("일정에 없는 검증 후보는 추가로 처리한다", async () => {
    const res = await runVisitDateEdit({
      placeId: YEONGJIN, targetDate: "2026-08-13", request: request(),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // baseline에 영진해변이 없으므로 추가다 — 결과가 나오면 그 날짜에 들어가야 한다
    expect(res.outcome.proposal.placeId).toBe(YEONGJIN);
    if (res.outcome.proposal.decision !== "impossible") {
      expect(res.outcome.nextRequest.preferredVisitDates?.[YEONGJIN]).toBe("2026-08-13");
    }
  });

  it("적용 결과에는 재계산된 일정과 diff가 함께 온다", async () => {
    const res = await runVisitDateEdit({
      placeId: YEONGJIN, targetDate: "2026-08-13", request: request(),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.outcome.nextResult.status).toBe("planned");
    expect(res.outcome.diff).toBeDefined();
    expect(res.outcome.summary).toBeDefined();
  });

  it.each([
    ["여행 범위 밖 날짜", { placeId: YEONGJIN, targetDate: "2026-09-01" }],
    ["형식이 아닌 날짜", { placeId: YEONGJIN, targetDate: "2026/08/13" }],
    ["빈 장소 ID", { placeId: "", targetDate: "2026-08-13" }],
    ["미등록 장소", { placeId: "place-unknown-id", targetDate: "2026-08-13" }],
  ])("잘못된 입력은 INVALID_REQUEST다 (%s)", async (_label, input) => {
    const res = await runVisitDateEdit({ ...input, request: request() });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("INVALID_REQUEST");
  });

  it("같은 입력은 같은 판정을 낸다", async () => {
    const input = { placeId: YEONGJIN, targetDate: "2026-08-13", request: request() };
    const first = await runVisitDateEdit(input);
    const second = await runVisitDateEdit(input);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});

describe("#109 편집 가능 조건 — 화면과 입력이 어긋나면 막는다", () => {
  const ok = {
    updating: false,
    commandDisabled: false,
    hasDisplayedDays: true,
    needsSelection: false,
    requiresAdjustment: false,
  };

  it("모든 조건이 맞으면 허용한다", () => {
    expect(canEditVisitDate(ok)).toBe(true);
  });

  // 선택이 바뀐 뒤 재계산이 끝나기 전에는 직전 일정이 화면에 남아 있다.
  // 그때 편집하면 이미 바뀐 선택 집합을 기준으로 요청이 나가 기준 상태가 섞인다.
  it.each([
    ["갱신 중", { updating: true }],
    ["명령 패널 비활성", { commandDisabled: true }],
    ["표시할 일정 없음", { hasDisplayedDays: false }],
    ["선택이 비어 있음", { needsSelection: true }],
    ["과선택 조정 필요", { requiresAdjustment: true }],
  ])("%s이면 막는다", (_label, override) => {
    expect(canEditVisitDate({ ...ok, ...override })).toBe(false);
  });
});

describe("#151 조율 패널 닫기 조건", () => {
  // 확인을 기다리는 제안이 떠 있으면 닫지 않는다 — 닫는 순간 무엇을 승인하려던 것인지 사라진다
  it.each([
    ["피드백 없음", null, true],
    ["적용 완료", { kind: "proposal", applied: true }, true],
    ["확인 대기", { kind: "proposal", applied: false }, false],
    ["추천 목록", { kind: "recommendations" }, false],
    ["재질문", { kind: "clarify" }, true],
    ["오류", { kind: "error" }, true],
  ])("%s → %s", (_label, feedback, expected) => {
    expect(panelDismissable(feedback as never)).toBe(expected);
  });
});

describe("#109 되돌리기 지점 — 빠뜨린 필드는 조용히 안 돌아온다", () => {
  const base = {
    selectedPlaceIds: new Set(["a", "b"]),
    preferredVisitDates: { a: "2026-08-13" } as Record<string, string>,
    result: { status: "empty", days: [], rejectedPlaces: [], warnings: [],
      selectionGroups: { requested: [], covered: [], uncovered: [] } } as ItineraryResult,
    selectedAlt: null,
    diff: null,
    settledSelectionKey: "a|b",
    saveStatus: "saved" as const,
    themeExperience: { status: "unavailable" },
    themeMapVisible: true,
  };

  it("복원해야 하는 필드를 하나도 빠뜨리지 않는다", () => {
    const point = undoPointOf(base);
    expect(point).not.toBeNull();
    // 저장 상태를 빠뜨렸던 것이 PR #150 리뷰에서 잡힌 자리다
    expect(Object.keys(point!).sort()).toEqual([...UNDO_POINT_KEYS].sort());
  });

  it("저장 상태와 테마 표시를 함께 담는다", () => {
    const point = undoPointOf(base)!;
    expect(point.saveStatus).toBe("saved");
    expect(point.themeMapVisible).toBe(true);
    expect(point.themeExperience).toEqual({ status: "unavailable" });
  });

  // 참조를 그대로 들면 이후 편집이 스냅샷까지 바꿔 되돌리기가 현재 상태를 복원한다
  it("선택과 선호를 복사해 담는다", () => {
    const point = undoPointOf(base)!;
    base.selectedPlaceIds.add("c");
    base.preferredVisitDates.b = "2026-08-14";
    expect(point.selectedPlaceIds.has("c")).toBe(false);
    expect(point.preferredVisitDates.b).toBeUndefined();
  });

  it("아직 일정이 없으면 되돌릴 지점도 없다", () => {
    expect(undoPointOf({ ...base, result: null })).toBeNull();
  });
});
