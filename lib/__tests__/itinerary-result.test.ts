import { describe, expect, it } from "vitest";
import type { ItineraryResult } from "../engine/types";

// PR #16 리뷰: 분기가 타입으로 구분되는지 컴파일 수준에서 고정하는 fixture.
// #14 ver.0.4 확정으로 필수 방문·방문일 고정이 제거되어 사용자 제약 실패(ok:false)
// 분기가 소멸했다 — 결과는 planned/empty 2분기이며 status가 유일한 판별자다.

const planned: ItineraryResult = {
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
          accessMinutes: 35,
        },
      ],
      regionWindows: [
        {
          stationId: "station-gangneung",
          regionId: "gangwon",
          startAt: "2026-08-12T14:59:00+09:00",
          endAt: "2026-08-13T00:00:00+09:00",
          availableMinutes: 361,
          startBoundary: "TRAIN_ARRIVAL",
          endBoundary: "DAY_END",
        },
      ],
    },
  ],
  rejectedPlaces: [],
  // #43: 경고는 제외가 아니라 배치 유지 + 방문 전 확인 안내
  warnings: [
    { code: "ACTIVITY_WINDOW_MISMATCH", placeId: "place-yeongjin-beach", detail: "CONSERVATIVE_BUFFER_MISMATCH" },
  ],
  selectionGroups: { requested: ["work"], covered: ["work"], uncovered: [] },
  comparisonKeys: {
    selectionGroupCoverageCount: 1,
    representativePlaceCount: 0,
    selectedUnionPlaceCount: 1,
    verifiedHoursMismatchCount: 1,
    preferredDateMismatchCount: 0,
    preferredOrderMismatchCount: 0,
    totalTravelMinutes: 168,
    transferCount: 0,
    slackSatisfied: true,
  },
  metrics: { totalTravelMinutes: 168, totalRailMinutes: 118, transferCount: 0, departureSlackMinutes: 180 },
};

const empty: ItineraryResult = {
  status: "empty",
  days: [],
  // #43: 운영시간 사유는 rejectedPlaces에 올 수 없다 — 열차·출국 마감뿐
  rejectedPlaces: [
    { code: "TRAIN_UNAVAILABLE", placeId: "place-woljeongsa-temple" },
  ],
  warnings: [],
  selectionGroups: {
    requested: ["work"],
    covered: [],
    uncovered: [{ group: "work", reasons: ["TRAIN_UNAVAILABLE"] }],
  },
};

describe("ItineraryResult 2분기 판별 (#14 ver.0.4 — 사용자 제약 실패 분기 소멸)", () => {
  it("planned에서만 comparisonKeys·metrics에 접근할 수 있다", () => {
    for (const r of [planned, empty]) {
      if (r.status === "planned") {
        expect(r.metrics.totalRailMinutes).toBeGreaterThan(0);
        expect(r.comparisonKeys.selectedUnionPlaceCount).toBeGreaterThan(0);
      }
    }
  });

  it("empty는 허위 metrics 없이 '조건을 만족하는 일정 없음'을 판별한다", () => {
    expect(empty.status).toBe("empty");
    expect(empty.days).toHaveLength(0);
    expect(empty.rejectedPlaces.length).toBeGreaterThan(0);
    expect("metrics" in empty).toBe(false);
  });

  it("status 외의 실패 판별자(ok 필드)는 존재하지 않는다", () => {
    expect("ok" in planned).toBe(false);
    expect("ok" in empty).toBe(false);
  });
});
