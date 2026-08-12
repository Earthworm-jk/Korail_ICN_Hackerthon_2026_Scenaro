import { afterEach, describe, expect, it, vi } from "vitest";
import { getAirportPassengerAdvisories } from "../actions/airport-passenger-advisory";

vi.mock("../env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../env")>()),
  flightMode: vi.fn(() => "snapshot" as const),
}));

afterEach(() => vi.useRealTimers());

describe("getAirportPassengerAdvisories — 공유 데모 픽스처", () => {
  it("D-day 상위 시간대·기본 여유 선택에 입국 경고를 반환한다", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-12T03:00:00Z"));
    const result = await getAirportPassengerAdvisories({
      arrival: { selectedAt: "2026-08-12T12:00", slackMinutes: 120 },
      departure: { selectedAt: "2026-08-14T16:00", slackMinutes: 120 },
    });
    expect(result.arrival.passengerCount).toBe(2640);
    expect(result.arrival.elevatedThreshold).toBe(2310);
    expect(result.arrival).toMatchObject({ status: "elevated", source: "snapshot" });
    expect(result.departure).toMatchObject({ status: "out_of_range", source: "none" });
  });
});
