import { describe, expect, it } from "vitest";
import { itineraryRowsOf, rowKey, stationIdsOf } from "../itinerary-rows";
import type { DayPlan } from "../engine/types";

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
