import { describe, expect, it } from "vitest";
import {
  airportLegsOf,
  itineraryRowsOf,
  regionWindowPresentationOf,
  rowKey,
  shouldNoteAirportRail,
  stationIdsOf,
} from "../itinerary-rows";
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

});

describe("#101 — 권역 창 화면 표시", () => {
  const transferWindow: RegionWindow = {
    stationId: "s1",
    regionId: "r1",
    startAt: "2026-08-12T11:30:00.000Z",
    endAt: "2026-08-12T13:00:00.000Z",
    // 활동 시간대는 21:00 KST(12:00Z)에 끝나므로 30분만 남는다.
    availableMinutes: 30,
    startBoundary: "TRAIN_ARRIVAL",
    endBoundary: "TRAIN_DEPARTURE",
  };
  const rides = [
    {
      ...ride("T1", "10:00", "s0", "s1"),
      arriveAt: transferWindow.startAt,
    },
    {
      ...ride("T2", "13:00", "s1", "s2"),
      departAt: transferWindow.endAt,
    },
  ];

  it("환승에는 활동시간으로 잘리지 않은 실제 다음 열차 간격을 표시한다", () => {
    expect(regionWindowPresentationOf(transferWindow, day({ rides }))).toEqual({
      kind: "transfer_wait",
      minutes: 90,
      startAt: transferWindow.startAt,
      endAt: transferWindow.endAt,
    });
  });

  it("일반 체류에는 엔진의 보수 활동 가능 시간을 그대로 표시한다", () => {
    const stayWindow = { ...transferWindow, startBoundary: "DAY_START" as const };
    expect(regionWindowPresentationOf(stayWindow, day({ rides }))).toEqual({
      kind: "stay",
      minutes: 30,
      // 분량과 같은 기준으로 자른 구간 — 20:30에서 시작해 21:00에 끝난다
      startAt: "2026-08-12T20:30:00+09:00",
      endAt: "2026-08-12T21:00:00+09:00",
    });
  });

  /**
   * QA 실측: 1일차에 강릉역에 도착해 다음 열차까지 머무는 창이 자정에서 잘려 2일차 조각이
   * 00:00에 시작했다. 분량은 09:00-21:00으로 클리핑한 값이라 `00:00 · 약 3시간 23분`으로
   * 읽혔고 "00:00부터 3시간 23분"으로 오해됐다. 두 값이 같은 기준을 쓰는지 고정한다.
   */
  it("자정에서 잘린 체류 창은 활동 시작 이후를 구간으로 보여준다", () => {
    const afterMidnight: RegionWindow = {
      stationId: "s1",
      regionId: "r1",
      startAt: "2026-08-13T00:00:00+09:00",
      endAt: "2026-08-13T12:23:00+09:00",
      availableMinutes: 203, // 09:00 - 12:23
      startBoundary: "DAY_START",
      endBoundary: "TRAIN_DEPARTURE",
    };
    const presentation = regionWindowPresentationOf(afterMidnight, day({ rides: [] }));
    expect(presentation.kind).toBe("stay");
    expect(presentation.startAt).toBe("2026-08-13T09:00:00+09:00");
    expect(presentation.endAt).toBe("2026-08-13T12:23:00+09:00");
  });

  it("같은 열차의 연속 구간은 환승이 아니라 통과 정차로 표시한다", () => {
    const sameTrain = rides.map((item) => ({ ...item, trainNo: "T1" }));
    const presentation = regionWindowPresentationOf(
      transferWindow,
      day({ rides: sameTrain }),
    );
    expect(presentation).toEqual({
      kind: "through_stop",
      minutes: 90,
      startAt: transferWindow.startAt,
      endAt: transferWindow.endAt,
    });
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

describe("#146 — 그 날 공항 진입 구간", () => {
  const airports = new Set(["ST-AIRPORT"]);
  const gateway = (from: string, to: string, hhmm: string): GatewayRide => ({
    id: `g-${from}-${to}`, routeId: "r-1", direction: "outbound", mode: "airport_bus",
    scheduleKind: "observed_snapshot",
    fromStationId: from, toStationId: to,
    fromName: { ko: from, en: from }, toName: { ko: to, en: to },
    serviceName: { ko: "공항버스 6001", en: "Airport bus 6001" },
    operator: { ko: "운영사", en: "Operator" },
    departAt: `2026-08-12T${hhmm}:00.000Z`, arriveAt: `2026-08-12T${hhmm}:00.000Z`,
    sourceUrls: ["https://example.test"], verifiedAt: "2026-08-01", recheckRequired: true,
  });

  /** 공항 진입은 여행 전체에 걸리는 정보라 가운데 날에는 없다 */
  it("공항을 지나지 않는 날에는 아무것도 없다", () => {
    expect(airportLegsOf(day({ rides: [ride("T1", "01:00")] }), airports)).toEqual([]);
  });

  it("공항으로 가는 열차 구간을 잡는다", () => {
    const legs = airportLegsOf(
      day({ rides: [ride("AREX", "05:00", "s1", "ST-AIRPORT")] }), airports);
    expect(legs).toHaveLength(1);
    expect(legs[0].kind).toBe("rail");
    expect(legs[0].direction).toBe("to_airport");
    expect(legs[0].serviceName).toEqual({ ko: "AREX", en: "AREX" });
  });

  it("공항에서 나오는 방향도 구분한다", () => {
    const legs = airportLegsOf(
      day({ rides: [ride("AREX", "05:00", "ST-AIRPORT", "s1")] }), airports);
    expect(legs[0].direction).toBe("from_airport");
  });

  // 철도는 rides에, 검증 버스는 gatewayLegs에 있다 — 사용자에겐 같은 질문의 답이다
  it("열차와 버스를 한 목록으로 합치고 시각순으로 세운다", () => {
    const legs = airportLegsOf(day({
      rides: [ride("AREX", "09:00", "ST-AIRPORT", "s1")],
      gatewayLegs: [gateway("ST-AIRPORT", "s2", "07:00")],
    }), airports);
    expect(legs.map((leg) => leg.kind)).toEqual(["bus", "rail"]);
  });

  it("공항역 목록이 비면 열차 구간은 잡지 않는다", () => {
    const legs = airportLegsOf(
      day({ rides: [ride("AREX", "05:00", "s1", "ST-AIRPORT")] }), new Set());
    expect(legs).toEqual([]);
  });

  /**
   * **버스는 정의상 공항 진입 구간이다.** 소속 검사에 걸어 두면 공항역 메타데이터가
   * 비었을 때 공항을 어떻게 드나드는지 말할 수단이 통째로 사라진다.
   */
  it("공항역 목록이 비어도 버스 구간은 남는다", () => {
    const legs = airportLegsOf(
      day({ rides: [], gatewayLegs: [gateway("ST-AIRPORT", "s2", "07:00")] }), new Set());
    expect(legs).toHaveLength(1);
    expect(legs[0].kind).toBe("bus");
  });

  /**
   * 방향은 엔진 계약(`outbound`=공항 이탈, `inbound`=공항 귀환)을 그대로 옮긴다.
   * 좌표로 다시 추론하면 **메타데이터가 비었을 때 귀환 구간이 반대로 표시된다.**
   */
  it("공항역 목록이 비어도 inbound는 공항으로 간다", () => {
    const inbound = { ...gateway("s2", "ST-AIRPORT", "07:00"), direction: "inbound" as const };
    const legs = airportLegsOf(day({ rides: [], gatewayLegs: [inbound] }), new Set());
    expect(legs[0].direction).toBe("to_airport");
  });

  it("outbound는 공항에서 나온다", () => {
    const outbound = { ...gateway("ST-AIRPORT", "s2", "07:00"), direction: "outbound" as const };
    const legs = airportLegsOf(day({ rides: [], gatewayLegs: [outbound] }), new Set());
    expect(legs[0].direction).toBe("from_airport");
  });

  it("버스 노선명은 다국어 그대로 옮긴다", () => {
    const legs = airportLegsOf(
      day({ rides: [], gatewayLegs: [gateway("ST-AIRPORT", "s2", "07:00")] }), airports);
    expect(legs[0].serviceName).toEqual({ ko: "공항버스 6001", en: "Airport bus 6001" });
  });
});
