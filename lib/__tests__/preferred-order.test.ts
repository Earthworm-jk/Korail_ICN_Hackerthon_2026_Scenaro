import { describe, expect, it } from "vitest";
import { planItinerary, type PlanRequest } from "../actions/itinerary";
import type { ItineraryResult, PreferredOrderOutcome } from "../engine/types";

/**
 * #145 같은 날 방문 순서 소프트 선호 — 계약 회귀
 *
 * 실험(`honored` 85.1%)이 게이트를 넘어 A안(쌍 선호)으로 확정된 기능이다. 방문일(#139)과
 * 같은 축이며 **하드 강제(D안)를 되살리지 않는다** — 못 지켜도 일정은 나오고 순위만 밀린다.
 *
 * 실험에서 확인된 성질을 그대로 계약으로 고정한다: 장소 수가 줄지 않고, 일정이 실패하지 않고,
 * 못 지키면 원래 순서로 남을 뿐이다.
 */

const ACTOR = "actor-kim-go-eun";

function request(overrides: Partial<PlanRequest> = {}): PlanRequest {
  return {
    arrivalAt: "2026-08-12T10:00:00+09:00",
    departureAt: "2026-08-14T18:00:00+09:00",
    airportReadyAt: "2026-08-12T12:00:00+09:00",
    airportArrivalDeadline: "2026-08-14T16:00:00+09:00",
    selectedActorIds: [ACTOR],
    selectedWorkIds: [],
    excludedPlaceIds: [],
    ...overrides,
  };
}

async function plan(overrides: Partial<PlanRequest> = {}) {
  const res = await planItinerary(request(overrides));
  if (!res.ok) throw new Error(`INVALID_REQUEST: ${JSON.stringify(res.fieldErrors)}`);
  if (res.result.status !== "planned") throw new Error("일정이 생성되지 않았다");
  return res.result;
}

type Planned = Extract<ItineraryResult, { status: "planned" }>;

/** 전체 방문 순서 — 날짜를 넘어 이어 붙인다 (판정 기준과 같은 방식) */
function visitOrder(result: Planned): string[] {
  return result.days.flatMap((day) => day.items.map((item) => item.placeId));
}

function outcomeOf(
  outcomes: PreferredOrderOutcome[] | undefined,
  first: string,
  second: string,
): PreferredOrderOutcome | undefined {
  return outcomes?.find((o) => o.firstPlaceId === first && o.secondPlaceId === second);
}

describe("방문 순서 소프트 선호", () => {
  describe("입력 계약", () => {
    it("선호가 없으면 출력 필드 자체가 없다", async () => {
      const result = await plan();
      expect(result.preferredOrderOutcomes).toBeUndefined();
    });

    it("같은 장소를 두 번 적은 쌍은 거부한다", async () => {
      const [placeId] = visitOrder(await plan());
      const res = await planItinerary(request({ preferredOrder: [[placeId, placeId]] }));
      expect(res.ok).toBe(false);
    });

    it("같은 쌍을 두 번 보내면 거부한다", async () => {
      const [first, second] = visitOrder(await plan());
      const res = await planItinerary(request({
        preferredOrder: [[first, second], [first, second]],
      }));
      expect(res.ok).toBe(false);
    });

    /**
     * PR #153 리뷰 3번 — 길이 2만 막으면 `A→B, B→C, C→A`가 통과한다. 드래그를 여러 번 하면
     * 이런 쌍이 쌓일 수 있고, 지금 막지 않으면 모순된 요청을 그대로 받아 버린다.
     */
    it("길이 3 순환도 거부한다", async () => {
      const order = visitOrder(await plan());
      if (order.length < 3) return;
      const [a, b, c] = order;
      const res = await planItinerary(request({
        preferredOrder: [[a, b], [b, c], [c, a]],
      }));
      expect(res.ok).toBe(false);
    });

    /**
     * PR #153 리뷰 2번 — 공개 Action은 엔진의 RangeError를 밖으로 새게 하면 안 된다.
     * 미등록 ID와 등록됐지만 비후보인 ID를 나눠 확인한다.
     */
    it("알 수 없는 장소 ID는 INVALID_REQUEST로 정규화된다", async () => {
      const [placed] = visitOrder(await plan());
      const res = await planItinerary(request({
        preferredOrder: [[placed, "place-does-not-exist"]],
      }));
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.code).toBe("INVALID_REQUEST");
      expect(res.fieldErrors.preferredOrder).toContain("unknown place id");
    });

    it("등록됐지만 이 선택의 후보가 아닌 장소도 INVALID_REQUEST다", async () => {
      const [placed] = visitOrder(await plan());
      const { loadRepositories } = await import("../repositories/json");
      const { getCandidatePlaces } = await import("../actions/places");
      const { candidates } = await getCandidatePlaces({
        selectedActorIds: [ACTOR], selectedWorkIds: [],
      });
      const candidateIds = new Set(candidates.map(({ id }) => id));
      const nonCandidate = loadRepositories().places
        .map(({ id }) => id)
        .find((id) => !candidateIds.has(id));
      if (nonCandidate === undefined) return;

      const res = await planItinerary(request({
        preferredOrder: [[placed, nonCandidate]],
      }));
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.code).toBe("INVALID_REQUEST");
      expect(res.fieldErrors.preferredOrder).toContain("not a candidate place id");
    });

    /**
     * 제외 우선 경계 (PR #153 리뷰).
     *
     * 순서를 조율한 뒤 장소를 선택 해제하는 흐름이 실제로 있다. 그때 이미 무효가 된 선호
     * 때문에 재계산이 통째로 실패하면 안 된다 — 의미 검사는 제외를 걷어낸 뒤에 건다.
     */
    describe("제외가 순환 검사보다 우선", () => {
      it("역쌍 중 한 장소를 제외하면 요청이 성공하고 선호가 남지 않는다", async () => {
        const [first, second] = visitOrder(await plan());
        const res = await planItinerary(request({
          excludedPlaceIds: [second],
          preferredOrder: [[first, second], [second, first]],
        }));
        expect(res.ok).toBe(true);
        if (!res.ok || res.result.status !== "planned") return;
        expect(res.result.preferredOrderOutcomes).toBeUndefined();
      });

      it("3-순환 중 한 장소를 제외하면 남은 비순환 쌍만 처리한다", async () => {
        const order = visitOrder(await plan());
        if (order.length < 3) return;
        const [a, b, c] = order;
        const res = await planItinerary(request({
          excludedPlaceIds: [c],
          preferredOrder: [[a, b], [b, c], [c, a]],
        }));
        expect(res.ok).toBe(true);
        if (!res.ok || res.result.status !== "planned") return;
        // c가 낀 두 쌍은 버려지고 (a,b)만 남는다
        const keys = (res.result.preferredOrderOutcomes ?? [])
          .map((o) => `${o.firstPlaceId}|${o.secondPlaceId}`);
        expect(keys).toEqual([`${a}|${b}`]);
      });

      it("제외하지 않으면 같은 입력이 여전히 순환 오류다", async () => {
        const order = visitOrder(await plan());
        if (order.length < 3) return;
        const [a, b, c] = order;
        const res = await planItinerary(request({
          preferredOrder: [[a, b], [b, c], [c, a]],
        }));
        expect(res.ok).toBe(false);
      });
    });

    /** (A,B)와 (B,A)가 함께 오면 어느 쪽도 지킬 수 없다 — 조용히 하나를 버리지 않는다 */
    it("서로 모순되는 쌍은 거부한다", async () => {
      const [first, second] = visitOrder(await plan());
      const res = await planItinerary(request({
        preferredOrder: [[first, second], [second, first]],
      }));
      expect(res.ok).toBe(false);
    });
  });

  describe("반영 결과", () => {
    it("이미 그 순서인 쌍은 honored이고 일정이 그대로다", async () => {
      const baseline = await plan();
      const order = visitOrder(baseline);
      expect(order.length).toBeGreaterThanOrEqual(2);

      const [first, second] = order;
      const result = await plan({ preferredOrder: [[first, second]] });

      expect(outcomeOf(result.preferredOrderOutcomes, first, second)?.outcome).toBe("honored");
      expect(visitOrder(result)).toEqual(order);
    });

    /**
     * PR #153 리뷰 1번 — `honored`든 `adjusted`든 통과하는 테스트는 비교 키가 아예 안 읽히는
     * 결함을 못 잡는다. **실제로 승자를 바꾸는 쌍이 하나라도 있어야 한다**를 건다.
     */
    it("순서 요청이 실제 일정 순서를 바꾼다 — 같은 날 인접 쌍 중 최소 하나", async () => {
      const baseline = await plan();
      const before = visitOrder(baseline);

      const adjacentPairs = baseline.days.flatMap((day) =>
        day.items.slice(0, -1).map((item, index) =>
          [item.placeId, day.items[index + 1].placeId] as const),
      );
      expect(adjacentPairs.length).toBeGreaterThan(0);

      let flipped = 0;
      for (const [first, second] of adjacentPairs) {
        // 뒤집어 요청 — 지켜지면 방문 순서가 실제로 달라져야 한다
        const result = await plan({ preferredOrder: [[second, first]] });
        if (outcomeOf(result.preferredOrderOutcomes, second, first)?.outcome !== "honored") continue;
        const after = visitOrder(result);
        expect(after.indexOf(second)).toBeLessThan(after.indexOf(first));
        if (JSON.stringify(after) !== JSON.stringify(before)) flipped += 1;
      }
      // 실험에서 인접 교환은 20/21이 지켜졌다. 하나도 안 바뀌면 키가 안 읽히는 것이다
      expect(flipped).toBeGreaterThan(0);
    }, 60000);

    it("뒤집어 요청하면 honored이거나 adjusted이고, 둘 중 무엇이든 일정은 선다", async () => {
      const baseline = await plan();
      const order = visitOrder(baseline);
      const [first, second] = order;

      const result = await plan({ preferredOrder: [[second, first]] });
      const outcome = outcomeOf(result.preferredOrderOutcomes, second, first)?.outcome;

      expect(outcome === "honored" || outcome === "adjusted").toBe(true);
      // honored면 실제로 뒤집혀 있어야 하고, adjusted면 원래 순서가 남아야 한다
      const after = visitOrder(result);
      const positions = (ids: string[]) => [ids.indexOf(second), ids.indexOf(first)];
      const [secondAt, firstAt] = positions(after);
      expect(outcome === "honored" ? secondAt < firstAt : secondAt > firstAt).toBe(true);
    });

    /**
     * 실험의 핵심 발견 — 순서 요청이 일정을 망가뜨리지 않는다. 시행 47건에서 장소 수가 준
     * 경우 0건, 일정이 아예 안 선 경우 0건이었다. 그 성질을 계약으로 고정한다.
     */
    it("순서를 요청해도 방문 장소가 줄지 않는다", async () => {
      const baseline = await plan();
      const order = visitOrder(baseline);
      const [first, second] = order;

      const result = await plan({ preferredOrder: [[second, first]] });
      expect(visitOrder(result).length).toBeGreaterThanOrEqual(order.length);
    });

    it("일정에 못 들어간 장소가 낀 쌍은 unplaced다", async () => {
      const baseline = await plan();
      const placed = new Set(visitOrder(baseline));
      const { getCandidatePlaces } = await import("../actions/places");
      const { candidates } = await getCandidatePlaces({
        selectedActorIds: [ACTOR], selectedWorkIds: [],
      });
      const missing = candidates.map(({ id }) => id).find((id) => !placed.has(id));
      if (missing === undefined) return; // 후보가 전부 배치된 조건이면 이 경우가 없다

      const [anyPlaced] = visitOrder(baseline);
      const result = await plan({ preferredOrder: [[anyPlaced, missing]] });
      expect(outcomeOf(result.preferredOrderOutcomes, anyPlaced, missing)?.outcome).toBe("unplaced");
    });

    it("제외한 장소가 낀 쌍은 결과 목록에서 빠진다 — 제외가 선호보다 우선", async () => {
      const baseline = await plan();
      const order = visitOrder(baseline);
      const [first, second] = order;

      const result = await plan({
        excludedPlaceIds: [second],
        preferredOrder: [[first, second]],
      });
      expect(outcomeOf(result.preferredOrderOutcomes, first, second)).toBeUndefined();
    });

    it("결과 목록이 쌍 사전순이다 — 같은 입력이 같은 순서로 나온다", async () => {
      const order = visitOrder(await plan());
      if (order.length < 3) return;
      const [a, b, c] = order;

      const result = await plan({ preferredOrder: [[b, c], [a, b]] });
      const keys = (result.preferredOrderOutcomes ?? []).map((o) => `${o.firstPlaceId}|${o.secondPlaceId}`);
      expect(keys).toEqual([...keys].sort((x, y) => x.localeCompare(y, "en")));
    });
  });

  describe("비교 키", () => {
    it("순서를 지킬수록 mismatch가 작다 — 방문일 키와 섞이지 않는다", async () => {
      const order = visitOrder(await plan());
      const [first, second] = order;

      const kept = await plan({ preferredOrder: [[first, second]] });
      expect(kept.comparisonKeys.preferredOrderMismatchCount).toBe(0);
      // 방문일 축은 건드리지 않는다
      expect(kept.comparisonKeys.preferredDateMismatchCount).toBe(0);
    });

    it("선호가 없으면 mismatch가 0이다", async () => {
      const result = await plan();
      expect(result.comparisonKeys.preferredOrderMismatchCount).toBe(0);
    });
  });

  it("같은 입력이면 같은 결과다 — 순서 선호가 결정성을 깨지 않는다", async () => {
    const order = visitOrder(await plan());
    const [first, second] = order;
    const input = { preferredOrder: [[second, first]] as ReadonlyArray<readonly [string, string]> };

    const a = await plan(input);
    const b = await plan(input);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
