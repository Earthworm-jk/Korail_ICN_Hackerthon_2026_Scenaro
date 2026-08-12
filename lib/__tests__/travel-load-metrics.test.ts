import { describe, expect, it } from "vitest";
import { itineraryMetrics, initialItineraryView, type ItineraryView } from "../itinerary-view";
import type { ItineraryMetrics, ItineraryResult } from "../engine/types";

/**
 * 이동 부담 수치의 출처 (#198 B)
 *
 * 고정하는 계약은 **없는 값을 화면에서 다시 세지 않는다**는 것이다. 재열람 스냅샷과 목업
 * 대안에는 `metrics`가 없는데, 그때 `rides.length`로 환승을 유추하면 #101이 갈라 놓은
 * 환승 대기·통과 정차 구분과 어긋난 숫자가 사실처럼 나간다.
 */

const METRICS: ItineraryMetrics = {
  totalTravelMinutes: 180,
  totalRailMinutes: 150,
  transferCount: 2,
  departureSlackMinutes: 90,
};

const planned = (metrics: ItineraryMetrics): ItineraryResult => ({
  status: "planned",
  days: [],
  rejectedPlaces: [],
  warnings: [],
  comparisonKeys: {
    selectionGroupCoverageCount: 0,
    selectedUnionPlaceCount: 0,
    activityWarningCount: 0,
    preferredDateMismatchCount: 0,
    preferredOrderMismatchCount: 0,
    totalTravelMinutes: metrics.totalTravelMinutes,
    transferCount: metrics.transferCount,
    slackSatisfied: true,
  },
  metrics,
} as unknown as ItineraryResult);

const view = (patch: Partial<ItineraryView>): ItineraryView => ({
  ...initialItineraryView,
  ...patch,
});

describe("#198 이동 부담 수치는 엔진 결과에만 있다", () => {
  it("엔진이 계산했으면 그 값을 그대로 쓴다", () => {
    expect(itineraryMetrics(view({ result: planned(METRICS) }))).toEqual(METRICS);
  });

  it("계산 결과가 없으면 null", () => {
    expect(itineraryMetrics(initialItineraryView)).toBeNull();
  });

  it("조건을 만족하는 일정이 없으면 null — 허위 수치를 만들지 않는다", () => {
    const empty = { status: "empty", days: [], rejectedPlaces: [] } as unknown as ItineraryResult;
    expect(itineraryMetrics(view({ result: empty }))).toBeNull();
  });

  it("재열람 스냅샷은 null — 저장 레코드에 metrics가 없다", () => {
    const reopened = { id: "saved-1", days: [] } as never;
    expect(itineraryMetrics(view({ result: planned(METRICS), reopened }))).toBeNull();
  });

  it("목업 대안은 null — 실제 시간표가 아니다", () => {
    const mock = { kind: "mock", id: "alt-1", days: [] } as never;
    expect(itineraryMetrics(view({ result: planned(METRICS), selectedAlt: mock }))).toBeNull();
  });

  it("검증된 공항버스 대안은 그 대안의 수치를 쓴다", () => {
    const swapped: ItineraryMetrics = { ...METRICS, transferCount: 0, totalTravelMinutes: 205 };
    const alt = {
      kind: "gateway_bus",
      id: "alt-bus",
      days: [],
      metrics: { ...swapped, totalGatewayMinutes: 70 },
    } as never;
    expect(itineraryMetrics(view({ result: planned(METRICS), selectedAlt: alt })))
      .toMatchObject({ transferCount: 0, totalTravelMinutes: 205 });
  });
});
