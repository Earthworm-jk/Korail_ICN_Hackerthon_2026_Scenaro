import { afterEach, describe, expect, it, vi } from "vitest";
import { getAirportPassengerAdvisories } from "../actions/airport-passenger-advisory";

vi.mock("../env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../env")>()),
  flightMode: vi.fn(() => "snapshot" as const),
}));

afterEach(() => vi.useRealTimers());

describe("getAirportPassengerAdvisories — 공유 데모 픽스처", () => {
  it("실행 날짜에 맞춰 D-day와 D+1의 전 터미널 폴백을 만든다", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T03:00:00Z"));
    const result = await getAirportPassengerAdvisories({
      arrival: { selectedAt: "2026-08-13T12:00", slackMinutes: 120 },
      departure: { selectedAt: "2026-08-14T16:00", slackMinutes: 120, terminal: "T2" },
    });
    expect(result.arrival.passengerCount).toBe(2640);
    expect(result.arrival).toMatchObject({ status: "elevated", source: "snapshot" });
    expect(result.departure).toMatchObject({
      status: "elevated",
      source: "snapshot",
      passengerCount: 1120,
      terminal: "T2",
    });
  });
});
