import { beforeEach, describe, expect, it } from "vitest";
import {
  clearLivePassengerForecastCache,
  lookupLivePassengerForecast,
  normalizePassengerRecords,
} from "../adapters/airport-passenger-live";

describe("normalizePassengerRecords — 승객예고 응답 정규화", () => {
  it("입국장 인원과 변경 후 출국장 필드를 터미널·방향별로 나눈다", () => {
    expect(normalizePassengerRecords([{
      adate: "20260812",
      atime: "1000",
      t1eg1: 40,
      t1eg2: 60,
      t1eg3: 80,
      t1eg4: 120,
      t2eg1: 30,
      t2eg2: 40,
      t1dg1: 10,
      t1dg2: 20,
      t1dg3: 30,
      t1dg4: 40,
      t1dg5: 50,
      t1dg6: 60,
      t2dg1: 70,
      t2dg2: 80,
    }])).toEqual([
      { date: "2026-08-12", hour: 10, terminal: "T1", direction: "arrival", passengerCount: 300 },
      { date: "2026-08-12", hour: 10, terminal: "T2", direction: "arrival", passengerCount: 70 },
      { date: "2026-08-12", hour: 10, terminal: "T1", direction: "departure", passengerCount: 210 },
      { date: "2026-08-12", hour: 10, terminal: "T2", direction: "departure", passengerCount: 150 },
    ]);
  });

  it("T1 출국장 변경 전 합계 필드도 폴백으로 읽는다", () => {
    expect(normalizePassengerRecords([{
      adate: "2026-08-12",
      atime: 900,
      t1sum5: 100,
      t1sum6: 200,
      t1sum7: 300,
      t1sum8: 400,
    }])).toContainEqual({
      date: "2026-08-12",
      hour: 9,
      terminal: "T1",
      direction: "departure",
      passengerCount: 1000,
    });
  });
});

describe("lookupLivePassengerForecast", () => {
  beforeEach(() => clearLivePassengerForecastCache());

  it("공식 D/D+1 파라미터와 JSON 응답을 사용한다", async () => {
    let seenUrl = "";
    const points = await lookupLivePassengerForecast(1, {
      serviceKey: "test-key",
      fetchImpl: async (url) => {
        seenUrl = url;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            response: {
              header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
              body: { items: [{ adate: "20260813", atime: "1600", t1dg1: 900 }] },
            },
          }),
        };
      },
    });
    expect(seenUrl).toContain("passgrAnncmt/getPassgrAnncmt");
    expect(seenUrl).toContain("selectdate=1");
    expect(seenUrl).toContain("type=json");
    expect(points).toContainEqual({
      date: "2026-08-13",
      hour: 16,
      terminal: "T1",
      direction: "departure",
      passengerCount: 900,
    });
  });

  it("KST 자정을 넘기면 5분 이내여도 전날 캐시를 재사용하지 않는다", async () => {
    let fetchCount = 0;
    let timestamp = Date.parse("2026-08-12T14:59:00Z"); // KST 23:59
    const fetchImpl = async () => {
      fetchCount += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          response: {
            header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
            body: { items: [{ adate: fetchCount === 1 ? "20260812" : "20260813", atime: "1000", t1sum1: 100 }] },
          },
        }),
      };
    };

    await lookupLivePassengerForecast(0, { serviceKey: "test-key", fetchImpl, now: () => timestamp });
    timestamp = Date.parse("2026-08-12T15:01:00Z"); // KST 00:01, two minutes later
    const next = await lookupLivePassengerForecast(0, { serviceKey: "test-key", fetchImpl, now: () => timestamp });

    expect(fetchCount).toBe(2);
    expect(next[0]?.date).toBe("2026-08-13");
  });
});
