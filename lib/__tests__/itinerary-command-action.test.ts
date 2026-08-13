import { describe, expect, it } from "vitest";
import { runItineraryCommand } from "../actions/itinerary-command";
import { planItinerary } from "../actions/itinerary";
import type { PlanRequest } from "../actions/itinerary";

const request: PlanRequest = {
  arrivalAt: "2026-08-12T10:00:00+09:00",
  departureAt: "2026-08-14T18:00:00+09:00",
  airportReadyAt: "2026-08-12T12:00:00+09:00",
  airportArrivalDeadline: "2026-08-14T16:00:00+09:00",
  selectedActorIds: [],
  selectedWorkIds: ["work-goblin"],
  excludedPlaceIds: ["place-yeongjin-beach"],
};
const routeRequest: PlanRequest = {
  ...request,
  excludedPlaceIds: [
    "place-yeongjin-beach",
    "place-lala-muri",
    "place-unhyeongung-western-house",
    "place-woljeongsa-temple",
  ],
};

describe("#141 자연어 일정 조율 서버 액션", () => {
  it("키 없이도 대표 문장을 검증·재계산해 제안한다", async () => {
    const result = await runItineraryCommand({
      sentence: "영진해변을 둘째 날 일정에 넣어줘",
      request,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.interpretation).toEqual({
      source: "deterministic",
      fallbackReason: "NO_API_KEY",
    });
    expect(result.outcome.kind).toBe("proposal");
    if (result.outcome.kind !== "proposal") return;
    expect(result.outcome.nextRequest.preferredVisitDates).toEqual({
      "place-yeongjin-beach": "2026-08-13",
    });
    expect(result.outcome.nextRequest.excludedPlaceIds).not.toContain("place-yeongjin-beach");
    expect(result.outcome.proposal.requestedDate).toBe("2026-08-13");
    expect(result.outcome.nextResult.status).toBe("planned");
    expect(result.outcome.nextRequest.excludedPlaceIds).toEqual(
      expect.arrayContaining(result.outcome.proposal.displaced.map(({ placeId }) => placeId)),
    );
    expect(result.outcome.nextResult.rejectedPlaces.map(({ placeId }) => placeId)).not.toEqual(
      expect.arrayContaining(result.outcome.proposal.displaced.map(({ placeId }) => placeId)),
    );
  });

  it("같은 대표 문장을 세 번 실행해도 동일한 폴백 제안을 유지한다", async () => {
    const results = await Promise.all(
      Array.from({ length: 3 }, () => runItineraryCommand({
        sentence: "영진해변을 둘째 날 일정에 넣어줘",
        request,
      })),
    );

    for (const result of results) {
      expect(result.ok).toBe(true);
      if (!result.ok || result.outcome.kind !== "proposal") continue;
      expect(result.interpretation).toEqual({
        source: "deterministic",
        fallbackReason: "NO_API_KEY",
      });
      expect(result.outcome.nextRequest.preferredVisitDates).toEqual({
        "place-yeongjin-beach": "2026-08-13",
      });
      expect(result.outcome.nextResult.status).toBe("planned");
    }
  });

  it("변경 설명은 모델 호출 없이 부작용 없는 명령으로 돌려준다", async () => {
    const result = await runItineraryCommand({ sentence: "방금 무엇이 달라졌어?", request });
    expect(result).toMatchObject({
      ok: true,
      interpretation: { source: "deterministic" },
      outcome: { kind: "explain" },
    });
  });

  it("동선 추천은 검증된 미선택 후보만 최대 3곳 반환하고 일정은 바꾸지 않는다", async () => {
    const result = await runItineraryCommand({
      sentence: "둘째 날 동선에 맞는 다른 촬영지를 추천해줘",
      request: routeRequest,
    });

    expect(result.ok).toBe(true);
    if (!result.ok || result.outcome.kind !== "recommendations") return;
    expect(result.interpretation).toEqual({
      source: "deterministic",
      fallbackReason: "NO_API_KEY",
    });
    expect(result.outcome.targetDate).toBe("2026-08-13");
    expect(result.outcome.recommendations.length).toBeGreaterThan(0);
    expect(result.outcome.recommendations.length).toBeLessThanOrEqual(3);
    for (const recommendation of result.outcome.recommendations) {
      expect(routeRequest.excludedPlaceIds).toContain(recommendation.placeId);
      expect(recommendation.targetDate).toBe("2026-08-13");
      expect(["same_station", "same_region"]).toContain(recommendation.routeMatch);
    }
  });

  it("동일한 동선 추천을 세 번 실행해도 후보와 영향이 같다", async () => {
    const results = await Promise.all(Array.from({ length: 3 }, () => runItineraryCommand({
      sentence: "둘째 날 동선에 맞는 다른 촬영지를 추천해줘",
      request: routeRequest,
    })));
    expect(results.every((result) => result.ok && result.outcome.kind === "recommendations")).toBe(true);
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
  });

  it("클라이언트 입력 모양을 서버 경계에서 제한한다", async () => {
    const result = await runItineraryCommand({
      sentence: "영진해변을 둘째 날 일정에 넣어줘",
      request: { ...request, selectedWorkIds: Array.from({ length: 21 }, (_, i) => `work-${i}`) },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors).toHaveProperty("selectedWorkIds");
  });
});

/**
 * 재질문 연속성 — 끝단 (#171).
 *
 * 순수 함수 회귀(`itinerary-command-slots.test.ts`)가 조각 잇는 규칙을 고정한다면, 여기서는
 * **액션이 실제로 그 조각을 받아 명령을 완성하는지**를 고정한다. 둘 사이가 끊기면 규칙은
 * 맞는데 화면은 그대로 "어떤 장소인지 알려주세요"라고 답한다.
 */
describe("#171 재질문에서 얻은 조각을 다음 발화에 잇는다", () => {
  it("첫 턴은 날짜를 되묻고, 다음 턴에 쓸 조각을 함께 준다", async () => {
    const result = await runItineraryCommand({ sentence: "영진해변을 넣어줘", request });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome.kind).toBe("clarify");
    if (result.outcome.kind !== "clarify") return;
    expect(result.outcome.pendingSlots).toEqual({
      requested: "day",
      intent: "add_place",
      placeName: "영진해변",
    });
  });

  /** 조각을 안 넘기면 지금(고장난) 동작 그대로다 — 이 대비가 회귀의 값이다 */
  it("조각 없이 둘째 날만 말하면 여전히 되묻는다", async () => {
    const result = await runItineraryCommand({ sentence: "둘째 날", request });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome.kind).toBe("clarify");
  });

  it("조각을 넘기면 둘째 날만 말해도 제안까지 간다", async () => {
    const first = await runItineraryCommand({ sentence: "영진해변을 넣어줘", request });
    expect(first.ok).toBe(true);
    if (!first.ok || first.outcome.kind !== "clarify") return;

    const second = await runItineraryCommand({
      sentence: "둘째 날",
      request,
      pendingSlots: first.outcome.pendingSlots,
    });

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.outcome.kind).toBe("proposal");
    if (second.outcome.kind !== "proposal") return;
    expect(second.outcome.nextRequest.preferredVisitDates).toEqual({
      "place-yeongjin-beach": "2026-08-13",
    });
  });

  /**
   * 옮기기와 넣기는 되묻는 문구가 같지만 완성할 명령이 다르다 (#171). 조각에 그 구분이
   * 없으면 "넣어줘"라고 한 요청이 옮기기로 완성돼, 일정에 없는 장소라며 다시 되묻는다.
   */
  it("옮기기와 넣기를 구분해 기억한다", async () => {
    const move = await runItineraryCommand({ sentence: "영진해변을 옮겨줘", request });
    expect(move.ok).toBe(true);
    if (!move.ok || move.outcome.kind !== "clarify") return;
    expect(move.outcome.pendingSlots?.intent).toBe("move_place");

    const add = await runItineraryCommand({ sentence: "영진해변을 넣어줘", request });
    expect(add.ok).toBe(true);
    if (!add.ok || add.outcome.kind !== "clarify") return;
    expect(add.outcome.pendingSlots?.intent).toBe("add_place");
  });

  /**
   * PR #175 리뷰 — 날짜가 섞인 **다른** 요청도 해석에 실패한다. 그때 옛 장소를 붙이면
   * 사용자가 말하지 않은 이동이 조용히 성공한다. 재질문 사유 코드는 둘이 같으므로
   * 발화 모양으로 갈라야 한다.
   */
  it("날짜가 섞인 다른 요청에는 옛 조각을 붙이지 않는다", async () => {
    const result = await runItineraryCommand({
      sentence: "둘째 날 일정 설명해줘",
      request,
      pendingSlots: { requested: "day", intent: "add_place", placeName: "영진해변" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome.kind).not.toBe("proposal");
  });

  /** 새 문장이 스스로 읽히면 옛 조각이 끼어들면 안 된다 */
  it("조각이 있어도 새 요청이 읽히면 그쪽을 따른다", async () => {
    const result = await runItineraryCommand({
      sentence: "월정사를 셋째 날 일정에 넣어줘",
      request,
      pendingSlots: { requested: "day", intent: "add_place", placeName: "영진해변" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok || result.outcome.kind !== "proposal") return;
    expect(Object.keys(result.outcome.nextRequest.preferredVisitDates ?? {}))
      .toEqual(["place-woljeongsa-temple"]);
  });
});

/**
 * 개수 목표 끝단 (#171 6번).
 *
 * 순수 회귀가 "무엇을 빼자"까지 고정한다면, 여기서는 **엔진이 실제로 다시 계산해 가능한
 * 안을 골랐는지**를 고정한다. 둘 사이가 끊기면 제안은 나오는데 적용하면 안 되는 안이 된다.
 */
describe("#171 개수 목표", () => {
  it("현재 안보다 적은 수로 줄인 안을 계산해 제안한다", async () => {
    const result = await runItineraryCommand({ sentence: "3곳만 남겨줘", request });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome.kind).toBe("goal_proposal");
    if (result.outcome.kind !== "goal_proposal") return;

    expect(result.outcome.targetPlaceCount).toBe(3);
    expect(result.outcome.nextResult.status).toBe("planned");
    // 제안은 현재 안보다 적어야 한다 — 목표가 그것이다
    expect(result.outcome.keepPlaceIds.length).toBeLessThanOrEqual(3);
    expect(result.outcome.keepPlaceIds.length).toBeGreaterThan(0);
  });

  /** 무엇을 잃는지 보여주지 않고 적용하면 모른 채 진행하게 된다 (#84) */
  it("맞바꿈을 함께 낸다", async () => {
    const result = await runItineraryCommand({ sentence: "3곳만 남겨줘", request });
    expect(result.ok).toBe(true);
    if (!result.ok || result.outcome.kind !== "goal_proposal") return;

    expect(result.outcome.tradeOff.droppedPlaceIds.length).toBeGreaterThan(0);
    expect(typeof result.outcome.tradeOff.travelMinutesDelta).toBe("number");
  });

  it("같은 요청이면 같은 답이다", async () => {
    const first = await runItineraryCommand({ sentence: "3곳만 남겨줘", request });
    const second = await runItineraryCommand({ sentence: "3곳만 남겨줘", request });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    if (first.outcome.kind !== "goal_proposal" || second.outcome.kind !== "goal_proposal") return;
    expect(first.outcome.keepPlaceIds).toEqual(second.outcome.keepPlaceIds);
  });

  /**
   * PR #190 리뷰 1번 — **고정 장소가 지금 일정에 없는 경우.**
   *
   * 과선택이면 고른 곳 중 일부는 미배치다. 앞서는 `keep`을 배치된 곳에서만 만들어서,
   * 그 상태로 "꼭 유지"라고 하면 그 장소가 오히려 명시적으로 제외되는데 응답에는
   * `pinnedPlaceIds`가 남아 화면이 **"유지했습니다"라고 거짓을 말했다.**
   */
  /**
   * PR #190 리뷰 1번 — **고정 장소가 지금 일정에 없는 경우.**
   *
   * 과선택이면 고른 곳 중 일부는 미배치다. 앞서는 `keep`을 배치된 곳에서만 만들어서,
   * 그 상태로 "꼭 유지"라고 하면 그 장소가 오히려 **명시적으로 제외**되는데 응답의
   * `pinnedPlaceIds`에는 남아 화면이 **"유지했습니다"라고 거짓을 말했다.**
   *
   * 앞선 테스트는 고정 문장을 아예 보내지 않아 이 경로를 지나가지 못했다.
   */
  describe("고정 장소는 약속대로 남는다", () => {
    /** 이 요청에서 라라무리는 선택돼 있지만 일정에 배치되지 못한다 */
    const unscheduled = { id: "place-lala-muri", name: "라라무리" };

    it("전제 확인 — 고정할 장소가 실제로 미배치다", async () => {
      const base = await planItinerary(request);
      expect(base.ok).toBe(true);
      if (!base.ok || base.result.status !== "planned") return;
      const scheduled = base.result.days.flatMap((day) => day.items.map((item) => item.placeId));
      expect(scheduled).not.toContain(unscheduled.id);
      expect(base.result.rejectedPlaces.map(({ placeId }) => placeId)).toContain(unscheduled.id);
    });

    it("미배치 장소를 고정하면 결과에 실제로 들어간다", async () => {
      const result = await runItineraryCommand({
        sentence: `3곳만 남겨줘 ${unscheduled.name}은 꼭 남겨줘`,
        request,
      });
      expect(result.ok).toBe(true);
      if (!result.ok || result.outcome.kind !== "goal_proposal") return;

      expect(result.outcome.pinnedPlaceIds).toContain(unscheduled.id);
      // 수정 전에는 이 줄이 깨졌다 — 고정이라 말하고 결과에서는 뺐다
      expect(result.outcome.keepPlaceIds).toContain(unscheduled.id);
      expect(result.outcome.nextRequest.excludedPlaceIds).not.toContain(unscheduled.id);
    });

    it("개수 목표도 함께 지킨다", async () => {
      const result = await runItineraryCommand({
        sentence: `3곳만 남겨줘 ${unscheduled.name}은 꼭 남겨줘`,
        request,
      });
      if (!result.ok || result.outcome.kind !== "goal_proposal") return;
      expect(result.outcome.keepPlaceIds).toHaveLength(3);
    });

    /** 고정을 지키지 못하는 안은 버린다 — 못 지킬 약속은 아예 하지 않는다 */
    it("응답의 고정 목록은 언제나 결과에 포함된다", async () => {
      for (const sentence of ["3곳만 남겨줘", `2곳만 남겨줘 ${unscheduled.name}은 꼭 남겨줘`]) {
        const result = await runItineraryCommand({ sentence, request });
        if (!result.ok || result.outcome.kind !== "goal_proposal") continue;
        const keep = new Set(result.outcome.keepPlaceIds);
        expect(
          result.outcome.pinnedPlaceIds.every((id) => keep.has(id)),
          `"${sentence}" 의 고정은 결과에 있어야 한다`,
        ).toBe(true);
      }
    });
  });

  it("이미 목표 이하면 제안하지 않는다", async () => {
    const result = await runItineraryCommand({ sentence: "50곳만 남겨줘", request });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome.kind).not.toBe("goal_proposal");
  });
});
