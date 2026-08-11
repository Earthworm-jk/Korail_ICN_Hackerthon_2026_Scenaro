import { describe, expect, it } from "vitest";
import { runVisitOrderEdit } from "../actions/itinerary-command";
import { planItinerary, type PlanRequest } from "../actions/itinerary";
import { planRequestForOrder } from "../itinerary-command-executor";

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
