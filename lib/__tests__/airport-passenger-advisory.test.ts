import { describe, expect, it } from "vitest";
import {
  evaluateAirportPassengerAdvisory,
  forecastDayOffset,
  type AirportPassengerPoint,
} from "../airport-passenger-advisory";

const NOW = new Date("2026-08-12T03:00:00Z"); // KST 2026-08-12 12:00
const points: AirportPassengerPoint[] = [
  { date: "2026-08-12", hour: 9, terminal: "T1", direction: "arrival", passengerCount: 500 },
  { date: "2026-08-12", hour: 10, terminal: "T1", direction: "arrival", passengerCount: 700 },
  { date: "2026-08-12", hour: 11, terminal: "T1", direction: "arrival", passengerCount: 1200 },
  { date: "2026-08-12", hour: 12, terminal: "T1", direction: "arrival", passengerCount: 900 },
  { date: "2026-08-12", hour: 8, terminal: "T2", direction: "arrival", passengerCount: 100 },
  { date: "2026-08-12", hour: 9, terminal: "T2", direction: "arrival", passengerCount: 200 },
  { date: "2026-08-12", hour: 10, terminal: "T2", direction: "arrival", passengerCount: 250 },
  { date: "2026-08-12", hour: 11, terminal: "T2", direction: "arrival", passengerCount: 300 },
];

describe("forecastDayOffset — 승객예고 유효 범위", () => {
  it("KST 기준 오늘과 내일만 허용한다", () => {
    expect(forecastDayOffset("2026-08-12", NOW)).toBe(0);
    expect(forecastDayOffset("2026-08-13", NOW)).toBe(1);
    expect(forecastDayOffset("2026-08-14", NOW)).toBeNull();
    expect(forecastDayOffset("2026-08-11", NOW)).toBeNull();
  });
});

describe("evaluateAirportPassengerAdvisory — #177 사용자 선택 보호", () => {
  it("상위 시간대이고 선택 여유가 기본값 이하면 경고한다", () => {
    expect(evaluateAirportPassengerAdvisory({
      direction: "arrival",
      selectedAt: "2026-08-12T11:00",
      selectedSlackMinutes: 120,
      terminal: "T1",
      points,
      source: "snapshot",
      now: NOW,
    })).toMatchObject({ status: "elevated", passengerCount: 1200, elevatedThreshold: 900 });
  });

  it("사용자가 기본값보다 넉넉히 잡으면 같은 승객 신호에도 알리지 않는다", () => {
    expect(evaluateAirportPassengerAdvisory({
      direction: "arrival",
      selectedAt: "2026-08-12T11:00",
      selectedSlackMinutes: 150,
      terminal: "T1",
      points,
      source: "snapshot",
      now: NOW,
    }).status).toBe("clear");
  });

  it("터미널을 알면 해당 터미널끼리만 비교한다", () => {
    expect(evaluateAirportPassengerAdvisory({
      direction: "arrival",
      selectedAt: "2026-08-12T11:00",
      selectedSlackMinutes: 120,
      terminal: "T2",
      points,
      source: "snapshot",
      now: NOW,
    })).toMatchObject({ status: "elevated", passengerCount: 300, elevatedThreshold: 250 });
  });

  it("D+2 이후에는 픽스처가 있어도 미래 혼잡을 추정하지 않는다", () => {
    expect(evaluateAirportPassengerAdvisory({
      direction: "departure",
      selectedAt: "2026-08-14T16:00",
      selectedSlackMinutes: 120,
      points: [{ date: "2026-08-14", hour: 16, terminal: "T1", direction: "departure", passengerCount: 9999 }],
      source: "snapshot",
      now: NOW,
    }).status).toBe("out_of_range");
  });

  it("시간대 표본이 부족하면 혼잡으로 분류하지 않는다", () => {
    expect(evaluateAirportPassengerAdvisory({
      direction: "arrival",
      selectedAt: "2026-08-12T10:00",
      selectedSlackMinutes: 90,
      terminal: "T2",
      points: points.filter((point) => point.terminal === "T2").slice(0, 3),
      source: "snapshot",
      now: NOW,
    }).status).toBe("unavailable");
  });
});
