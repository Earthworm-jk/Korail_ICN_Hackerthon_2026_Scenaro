import { describe, expect, it } from "vitest";
import type { ItineraryResult } from "../engine/types";

// PR #16 리뷰: 세 분기가 타입으로 구분되는지 컴파일 수준에서 고정하는 fixture.
// 이 파일이 typecheck를 통과한다는 것 자체가 계약 검증이다.

const planned: ItineraryResult = {
  ok: true,
  status: "planned",
  days: [
    {
      date: "2026-08-12",
      rides: [
        {
          trainNo: "801",
          fromStationId: "station-seoul",
          toStationId: "station-gangneung",
          departAt: "2026-08-12T13:01:00+09:00",
          arriveAt: "2026-08-12T14:59:00+09:00",
        },
      ],
      items: [
        {
          placeId: "place-yeongjin-beach",
          arriveAt: "2026-08-12T15:45:00+09:00",
          departAt: "2026-08-12T16:45:00+09:00",
          accessMinutesLabel: "역-장소 접근 25분 추정",
        },
      ],
    },
  ],
  rejectedPlaces: [],
  comparisonKeys: {
    relevanceKey: { selectedWorkPlaceCount: 1, actorOtherWorkPlaceCount: 0 },
    visitablePlaceCount: 1,
    totalRailMinutes: 118,
    transferCount: 0,
    slackSatisfied: true,
  },
  metrics: { totalTravelMinutes: 168, totalRailMinutes: 118, transferCount: 0, departureSlackMinutes: 180 },
};

const empty: ItineraryResult = {
  ok: true,
  status: "empty",
  days: [],
  rejectedPlaces: [
    { code: "ACTIVITY_WINDOW_MISMATCH", placeId: "place-jukrim-cathedral", detail: "UNVERIFIED_HOURS" },
  ],
};

const failed: ItineraryResult = {
  ok: false,
  reason: { code: "USER_CONSTRAINT_INFEASIBLE", constraintType: "PINNED_DATE", targetId: "place-oak-valley" },
};

describe("ItineraryResult 세 분기 판별 (PR #16 계약)", () => {
  it("planned에서만 comparisonKeys·metrics에 접근할 수 있다", () => {
    for (const r of [planned, empty, failed]) {
      if (r.ok && r.status === "planned") {
        expect(r.metrics.totalRailMinutes).toBeGreaterThan(0);
        expect(r.comparisonKeys.visitablePlaceCount).toBeGreaterThan(0);
      }
    }
  });

  it("empty는 허위 metrics 없이 '일정 없음'을 판별한다", () => {
    expect(empty.ok && empty.status === "empty").toBe(true);
    expect(empty.days).toHaveLength(0);
    expect(empty.rejectedPlaces.length).toBeGreaterThan(0);
    expect("metrics" in empty).toBe(false);
  });

  it("실패는 기존 일정 유지 분기(ok:false)로만 표현된다", () => {
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.reason.constraintType).toBe("PINNED_DATE");
    }
  });
});
