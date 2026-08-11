import { describe, expect, it } from "vitest";
import { allStationIdsOf, itineraryRowsOf, rowKey, shouldNoteAirportRail, stationIdsOf } from "../itinerary-rows";
import type { DayPlan, GatewayRide, RegionWindow } from "../engine/types";

/** #146 2절 — 하루를 시각순 줄로 펼친다 */

const place = (placeId: string, hhmm: string) => ({
  placeId,
  arriveAt: `2026-08-12T${hhmm}:00.000Z`,
  departAt: `2026-08-12T${hhmm}:00.000Z`,
  accessMinutes: 10,
});

const ride = (trainNo: string, hhmm: string, from = "s1", to = "s2") => ({
  trainNo,
  fromStationId: from,
  toStationId: to,
  departAt: `2026-08-12T${hhmm}:00.000Z`,
  arriveAt: `2026-08-12T${hhmm}:00.000Z`,
});

const day = (over: Partial<DayPlan> = {}): DayPlan => ({
  date: "2026-08-12", items: [], rides: [], regionWindows: [], ...over,
});

describe("#146 시각순 줄", () => {
  it("장소와 이동을 한 줄씩 시각순으로 세운다", () => {
    const rows = itineraryRowsOf(day({
      items: [place("p2", "05:00"), place("p1", "01:00")],
      rides: [ride("T1", "03:00")],
    }));
    expect(rows.map(rowKey)).toEqual([
      "place:p1", "train:T1:2026-08-12T03:00:00.000Z", "place:p2",
    ]);
  });

  // 사람은 이동한 뒤에 도착한다 — 같은 분에 걸리면 이동이 먼저다
  it("같은 시각이면 이동을 앞에 둔다", () => {
    const rows = itineraryRowsOf(day({
      items: [place("p1", "03:00")],
      rides: [ride("T1", "03:00")],
    }));
    expect(rows[0].kind).toBe("train");
  });

  it("같은 시각·같은 종류는 사전순으로 고정한다", () => {
    const rows = itineraryRowsOf(day({ items: [place("pB", "03:00"), place("pA", "03:00")] }));
    expect(rows.map(rowKey)).toEqual(["place:pA", "place:pB"]);
  });

  it("공항 진입 구간도 같은 줄로 들어간다", () => {
    const rows = itineraryRowsOf(day({
      items: [place("p1", "05:00")],
      gatewayLegs: [{
        id: "g1", kind: "gateway_bus", routeId: "r1",
        fromStationId: "s0", toStationId: "s1",
        fromName: { ko: "공항", en: "Airport" }, toName: { ko: "서울역", en: "Seoul" },
        serviceName: { ko: "버스", en: "Bus" }, operator: { ko: "운영", en: "Op" },
        departAt: "2026-08-12T01:00:00.000Z", arriveAt: "2026-08-12T02:00:00.000Z",
      } as never],
    }));
    expect(rows.map((r) => r.kind)).toEqual(["gateway", "place"]);
  });


  it("그 날 거치는 역을 결정적으로 모은다", () => {
    const ids = stationIdsOf(day({
      rides: [ride("T1", "01:00", "sB", "sA"), ride("T2", "02:00", "sA", "sC")],
    }));
    expect(ids).toEqual(["sA", "sB", "sC"]);
  });
});

describe("#155 리뷰 1 — 그 날 거치는 역", () => {
  const gateway = (from: string, to: string): GatewayRide => ({
    id: `g-${from}-${to}`,
    routeId: "r-1",
    direction: "outbound",
    mode: "airport_bus",
    scheduleKind: "observed_snapshot",
    fromStationId: from,
    toStationId: to,
    fromName: { ko: from, en: from },
    toName: { ko: to, en: to },
    serviceName: { ko: "공항버스", en: "Airport bus" },
    operator: { ko: "운영사", en: "Operator" },
    departAt: "2026-08-12T09:00:00.000Z",
    arriveAt: "2026-08-12T10:00:00.000Z",
    sourceUrls: ["https://example.test"],
    verifiedAt: "2026-08-01",
    recheckRequired: true,
  });
  const window = (stationId: string): RegionWindow => ({
    stationId,
    regionId: `rg-${stationId}`,
    startAt: "2026-08-12T12:00:00.000Z",
    endAt: "2026-08-12T14:00:00.000Z",
    availableMinutes: 120,
    startBoundary: "TRAIN_ARRIVAL",
    endBoundary: "DAY_END",
  });

  it("열차 출도착역을 모은다", () => {
    expect(stationIdsOf(day({ rides: [ride("T1", "01:00")] }))).toEqual(["s1", "s2"]);
  });

  /**
   * 열차만 보면 **공항버스로만 진입하는 날의 관문역이 통째로 빠진다.**
   * 그 날 짐을 맡길 곳을 묻는 화면에서 정작 그 역이 없어진다.
   */
  it("열차가 없어도 공항 진입 구간의 역을 포함한다", () => {
    const d = day({ rides: [], gatewayLegs: [gateway("ST-AIRPORT", "ST-SEOUL")] });
    expect(stationIdsOf(d)).toEqual(["ST-AIRPORT", "ST-SEOUL"]);
  });

  /** 자정 분할로 그 날 탑승은 없지만 권역 체류 창만 이어지는 날이 있다 */
  it("체류 창만 있는 날에도 그 역을 포함한다", () => {
    expect(stationIdsOf(day({ rides: [], regionWindows: [window("ST-GANG")] }))).toEqual(["ST-GANG"]);
  });

  it("셋이 겹쳐도 한 번만 세고 순서는 결정적이다", () => {
    const d = day({
      rides: [ride("T1", "01:00")],
      gatewayLegs: [gateway("s2", "ST-AIRPORT")],
      regionWindows: [window("s1")],
    });
    expect(stationIdsOf(d)).toEqual(["s1", "s2", "ST-AIRPORT"]);
  });

  it("일정 전체 합집합은 날짜별 기준을 그대로 합친다", () => {
    const first = day({ date: "2026-08-12", rides: [ride("T1", "01:00")] });
    const second = day({ date: "2026-08-13", rides: [], regionWindows: [window("ST-GANG")] });
    expect(allStationIdsOf([first, second])).toEqual(["s1", "s2", "ST-GANG"]);
  });
});

describe("#146 — 공항철도 이용 명시", () => {
  const airports = new Set(["ST-AIRPORT"]);
  const leg = (from: string, to: string) => ({ fromStationId: from, toStationId: to });

  /**
   * 대안이 없으면 `GatewayAlternatives`가 `null`을 반환해 선택기가 통째로 사라진다.
   * 그러면 사용자는 **무엇으로 공항을 드나드는지 알 길이 없다.**
   */
  it("버스 대안이 없으면 공항 구간에 사실을 적는다", () => {
    expect(shouldNoteAirportRail({
      hasBusAlternative: false, airportStationIds: airports, ride: leg("ST-AIRPORT", "ST-SEOUL"),
    })).toBe(true);
  });

  it("도착이 공항이어도 마찬가지다", () => {
    expect(shouldNoteAirportRail({
      hasBusAlternative: false, airportStationIds: airports, ride: leg("ST-SEOUL", "ST-AIRPORT"),
    })).toBe(true);
  });

  // 선택기가 화면에 떠 있으면 사용자가 이미 안다 — 같은 말을 두 번 하지 않는다
  it("버스 대안이 있으면 적지 않는다", () => {
    expect(shouldNoteAirportRail({
      hasBusAlternative: true, airportStationIds: airports, ride: leg("ST-AIRPORT", "ST-SEOUL"),
    })).toBe(false);
  });

  it("공항을 지나지 않는 구간에는 적지 않는다", () => {
    expect(shouldNoteAirportRail({
      hasBusAlternative: false, airportStationIds: airports, ride: leg("ST-SEOUL", "ST-GANG"),
    })).toBe(false);
  });

  it("공항역 목록이 비면 아무 구간에도 적지 않는다", () => {
    expect(shouldNoteAirportRail({
      hasBusAlternative: false, airportStationIds: new Set(), ride: leg("ST-AIRPORT", "ST-SEOUL"),
    })).toBe(false);
  });
});
