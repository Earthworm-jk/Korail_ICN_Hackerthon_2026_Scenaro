import { describe, expect, it } from "vitest";
import { runVisitOrderEdit } from "../actions/itinerary-command";
import { planItinerary, type PlanRequest } from "../actions/itinerary";
import { planRequestForOrder, proposalForOrder } from "../itinerary-command-executor";
import type { DayPlan, ItineraryResult } from "../engine/types";

/**
 * #145 같은 날 방문 순서 — 서버 액션과 요청 패치
 *
 * 엔진 계약(PR #153)은 `[먼저, 나중]` 쌍을 소프트 선호로 받는다. 화면이 그 쌍을 만들어
 * 보내는 경로가 **날짜 조율과 같은 실행기·같은 판정**을 쓰는지 고정한다.
 */

const WORK_GOBLIN = "work-goblin";

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

/** 같은 날에 둘 이상 앉은 날에서 앞뒤 두 장소를 고른다 */
async function samedayPair(): Promise<{ first: string; second: string }> {
  const res = await planItinerary(request());
  if (!res.ok || res.result.status !== "planned") throw new Error("기준 일정 없음");
  const day = res.result.days.find((d) => d.items.length >= 2);
  if (!day) throw new Error("같은 날 두 곳인 날이 없음");
  return { first: day.items[0].placeId, second: day.items[1].placeId };
}

describe("요청 패치", () => {
  it("쌍을 얹는다", () => {
    const patched = planRequestForOrder("a", "b", request());
    expect(patched.preferredOrder).toEqual([["a", "b"]]);
  });

  /**
   * 쌓기만 하면 `A→B`와 `B→A`가 함께 남아 엔진이 순환으로 거부한다. 사용자는 방금 끈 것과
   * 무관한 오류를 보게 되므로, 같은 두 장소를 다루는 기존 쌍은 방향과 무관하게 걷어낸다.
   */
  it("같은 두 장소의 기존 쌍은 방향과 무관하게 걷어낸다", () => {
    const once = planRequestForOrder("a", "b", request());
    const twice = planRequestForOrder("b", "a", once);
    expect(twice.preferredOrder).toEqual([["b", "a"]]);
  });

  it("다른 쌍은 그대로 둔다", () => {
    const first = planRequestForOrder("a", "b", request());
    const second = planRequestForOrder("c", "d", first);
    expect(second.preferredOrder).toEqual([["a", "b"], ["c", "d"]]);
  });

  /** 제외가 선호보다 우선이라(엔진 계약) 제외된 채로 두면 쌍이 통째로 버려진다 */
  it("순서를 요청한 장소는 제외에서 뺀다", () => {
    const patched = planRequestForOrder("a", "b", request({ excludedPlaceIds: ["a", "z"] }));
    expect(patched.excludedPlaceIds).toEqual(["z"]);
  });
});

describe("서버 액션", () => {
  it("같은 날 두 장소의 순서를 요청하면 제안을 만든다", async () => {
    const { first, second } = await samedayPair();
    const res = await runVisitOrderEdit({ firstPlaceId: second, secondPlaceId: first, request: request() });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.outcome.proposal.kind).toBe("order");
    expect(res.outcome.proposal.orderPair).toEqual([second, first]);
    // 엔진이 그 쌍을 어떻게 처리했는지 반드시 실린다 — 화면이 조정 여부를 말해야 한다
    expect(["honored", "adjusted", "unplaced"]).toContain(res.outcome.proposal.orderOutcome);
  });

  /**
   * 순서는 소프트 선호라 못 지켜도 일정이 실패하지 않는다(#145 2절). 날짜 축의
   * `date_adjusted`가 순서 제안에 새어 나가면 확인 창이 날짜를 말하는데 순서 제안에는
   * 날짜가 없어 문장이 무너진다.
   */
  it("순서 제안은 날짜 조정 사유를 달지 않는다", async () => {
    const { first, second } = await samedayPair();
    const res = await runVisitOrderEdit({ firstPlaceId: second, secondPlaceId: first, request: request() });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.outcome.proposal.reasons).not.toContain("date_adjusted");
  });

  it("조정됐으면 사유로 알린다", async () => {
    const { first, second } = await samedayPair();
    const res = await runVisitOrderEdit({ firstPlaceId: second, secondPlaceId: first, request: request() });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { proposal } = res.outcome;
    expect(proposal.reasons.includes("order_adjusted")).toBe(proposal.orderOutcome === "adjusted");
  });

  /**
   * 순서는 소프트 선호라 못 지켜도 일정이 나온다. 날짜 판정을 그대로 재사용하면
   * "요청한 날짜에 앉았는가" 축이 새어 나와, 순서만 바꿨는데 `현재 조건에서는 넣을 수
   * 없습니다`가 뜬다 — 실제로 그렇게 떴다. `impossible`은 그 장소가 일정에서 아예
   * 빠졌을 때만이다.
   */
  it("순서를 못 지켜도 불가능으로 판정하지 않는다", async () => {
    const { first, second } = await samedayPair();
    const res = await runVisitOrderEdit({ firstPlaceId: second, secondPlaceId: first, request: request() });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { proposal, nextResult } = res.outcome;
    const placed = nextResult.status === "planned"
      && nextResult.days.some((day) => day.items.some((item) => item.placeId === second));
    // 그 장소가 일정에 남아 있으면 불가능일 수 없다
    if (placed) expect(proposal.decision).not.toBe("impossible");
    // 남아 있으면 어느 날에 앉았는지도 말할 수 있어야 한다
    if (placed) expect(proposal.scheduledDate).toBeTruthy();
  });

  /**
   * 부작용을 날짜 경로에서 빌려 오면 안 된다 (PR #170 리뷰).
   *
   * `proposalForPlaces`는 `preferredDateOutcomes`로 배치 여부를 가르는데 순서 요청은
   * `preferredVisitDates`를 넣지 않는다. 그래서 그 배열이 비고 함수가 곧장
   * `impossible()`로 빠져 **`displaced`가 빈 값으로 돌아왔다** — 사유가 없으니 `ready`가
   * 되고, 선택한 장소가 빠져도 확인 없이 적용된다.
   *
   * 여기서 고정하는 것은 **`ready`이면 요청 밖에서 나빠진 것이 하나도 없다**는 관계다.
   */
  it("자동 적용되는 제안에는 요청 밖 손실이 없다", async () => {
    const { first, second } = await samedayPair();
    const res = await runVisitOrderEdit({ firstPlaceId: second, secondPlaceId: first, request: request() });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { proposal, nextResult } = res.outcome;

    // 실제로 빠진 장소를 엔진 결과에서 직접 센다 — 제안이 스스로 보고한 값을 믿지 않는다
    const beforeAction = await planItinerary(request());
    if (!beforeAction.ok || beforeAction.result.status !== "planned") return;
    const beforeIds = new Set(beforeAction.result.days.flatMap((d) => d.items.map((i) => i.placeId)));
    const afterIds = new Set(nextResult.status === "planned"
      ? nextResult.days.flatMap((d) => d.items.map((i) => i.placeId)) : []);
    const dropped = [...beforeIds].filter((id) => !afterIds.has(id) && id !== first && id !== second);

    if (proposal.decision === "ready") {
      expect(dropped).toEqual([]);
      expect(proposal.reasons).toEqual([]);
    } else {
      // 빠진 것이 있으면 제안이 그것을 그대로 들고 있어야 확인 창이 말할 수 있다
      expect(proposal.displaced.map((d) => d.placeId).sort()).toEqual(dropped.sort());
    }
  });

  it("같은 장소를 앞뒤로 두면 입력에서 막는다", async () => {
    const { first } = await samedayPair();
    const res = await runVisitOrderEdit({ firstPlaceId: first, secondPlaceId: first, request: request() });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("INVALID_REQUEST");
  });

  it("같은 입력은 같은 결과다", async () => {
    const { first, second } = await samedayPair();
    const input = { firstPlaceId: second, secondPlaceId: first, request: request() };
    const a = await runVisitOrderEdit(input);
    const b = await runVisitOrderEdit(input);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

/**
 * 판정을 함수 단위로 고정한다.
 *
 * 실제 시드에서는 순서 요청으로 장소가 빠지는 경우가 나오지 않아(전 변형에서 8 -> 8)
 * 종단 테스트로는 이 결함을 잡을 수 없다. 그래서 빠지는 상황을 직접 만들어 넣는다.
 */
describe("판정 — 요청 밖 손실", () => {
  const day = (date: string, placeIds: string[]): DayPlan => ({
    date,
    rides: [],
    regionWindows: [],
    items: placeIds.map((placeId) => ({
      placeId,
      arriveAt: `${date}T01:00:00.000Z`,
      departAt: `${date}T02:00:00.000Z`,
      accessMinutes: 20,
    })),
  });

  const planned = (days: DayPlan[]): ItineraryResult => ({
    status: "planned",
    days,
    rejectedPlaces: [],
    warnings: [],
    selectionGroups: { requested: [], covered: [], uncovered: [] },
    comparisonKeys: {
      selectionGroupCoverageCount: 0,
      selectedUnionPlaceCount: 0,
      verifiedHoursMismatchCount: 0,
      preferredDateMismatchCount: 0,
      preferredOrderMismatchCount: 0,
      totalTravelMinutes: 0,
      transferCount: 0,
      slackSatisfied: true,
    },
    metrics: {
      totalTravelMinutes: 0,
      totalRailMinutes: 0,
      transferCount: 0,
      departureSlackMinutes: 0,
    },
  });

  /**
   * 이것이 PR #170 리뷰가 막은 결함이다. 부작용을 날짜 경로에서 빌려 오면
   * `preferredDateOutcomes`가 비어 있어 그 함수가 `impossible()`로 빠지고,
   * `displaced`가 통째로 빈 값으로 돌아온다 — 사유가 없으니 `ready`가 되어
   * **선택한 장소가 빠져도 확인 없이 적용된다.**
   */
  it("순서를 바꾸며 다른 장소가 빠지면 확인을 받는다", () => {
    const before = planned([day("2026-08-13", ["a", "b", "c"])]);
    const after = planned([day("2026-08-13", ["b", "a"])]); // c가 빠졌다
    const proposal = proposalForOrder("b", "a", before, after);

    expect(proposal.decision).toBe("needs_confirmation");
    expect(proposal.reasons).toContain("places_displaced");
    expect(proposal.displaced.map(({ placeId }) => placeId)).toEqual(["c"]);
  });

  it("빠진 것이 없으면 바로 적용한다", () => {
    const before = planned([day("2026-08-13", ["a", "b"])]);
    const after = planned([day("2026-08-13", ["b", "a"])]);
    const proposal = proposalForOrder("b", "a", before, after);

    expect(proposal.decision).toBe("ready");
    expect(proposal.reasons).toEqual([]);
  });

  /**
   * PR #170 리뷰 2가 막은 결함이다.
   *
   * 두 대상을 `dropped`에서 통째로 뺐더니 `secondPlaceId`가 빠진 경우가 어디에도
   * 안 걸렸다 — `firstPlaceId`는 위에서 `impossible`로 잡히지만 두 번째는 사유가
   * 없어져 `ready`가 되고, **사용자가 고른 카드가 사라졌는데 확인 없이 적용된다.**
   */
  it("순서 요청의 두 번째 대상이 빠지면 확인을 받는다", () => {
    const before = planned([day("2026-08-13", ["a", "b", "c"])]);
    const after = planned([day("2026-08-13", ["a", "c"])]); // b(두 번째 대상)가 빠졌다
    const proposal = proposalForOrder("a", "b", before, after);

    expect(proposal.decision).toBe("needs_confirmation");
    expect(proposal.reasons).toContain("places_displaced");
    expect(proposal.displaced.map(({ placeId }) => placeId)).toContain("b");
  });

  /** 첫 대상이 빠지면 요청 자체가 성립하지 않는다 — 그건 위에서 `impossible`이다 */
  it("첫 대상이 빠지면 불가능이다", () => {
    const before = planned([day("2026-08-13", ["a", "b"])]);
    const after = planned([day("2026-08-13", ["b"])]);
    const proposal = proposalForOrder("a", "b", before, after);

    expect(proposal.decision).toBe("impossible");
  });

  /** 같은 날 안에서 자리만 바뀌면 날짜가 그대로라 `moved`에 잡히지 않는다 */
  it("요청한 두 장소가 움직인 것은 사유가 아니다", () => {
    const before = planned([day("2026-08-13", ["a", "b"]), day("2026-08-14", ["c"])]);
    const after = planned([day("2026-08-13", ["b", "a"]), day("2026-08-14", ["c"])]);
    const proposal = proposalForOrder("b", "a", before, after);

    expect(proposal.reasons).not.toContain("places_moved");
  });
});
