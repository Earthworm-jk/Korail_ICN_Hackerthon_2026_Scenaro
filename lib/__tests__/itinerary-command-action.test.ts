import { describe, expect, it } from "vitest";
import { runItineraryCommand } from "../actions/itinerary-command";
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

  it("클라이언트 입력 모양을 서버 경계에서 제한한다", async () => {
    const result = await runItineraryCommand({
      sentence: "영진해변을 둘째 날 일정에 넣어줘",
      request: { ...request, selectedWorkIds: Array.from({ length: 21 }, (_, i) => `work-${i}`) },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors).toHaveProperty("selectedWorkIds");
  });
});
