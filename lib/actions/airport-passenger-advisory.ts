"use server";

import { z } from "zod";
import snapshot from "../../data/airport-passenger-forecast-snapshot.json";
import { flightMode } from "../env";
import {
  evaluateAirportPassengerAdvisory,
  forecastDayOffset,
  materializeAirportPassengerSnapshot,
  type AirportPassengerAdvisory,
  type AirportPassengerProfile,
  type AirportPassengerPoint,
} from "../airport-passenger-advisory";
import { lookupLivePassengerForecast } from "../adapters/airport-passenger-live";

const Input = z.object({
  arrival: z.object({ selectedAt: z.string(), slackMinutes: z.number().nullable(), terminal: z.string().optional() }),
  departure: z.object({ selectedAt: z.string(), slackMinutes: z.number().nullable(), terminal: z.string().optional() }),
});

export type AirportPassengerAdvisoryPair = {
  arrival: AirportPassengerAdvisory;
  departure: AirportPassengerAdvisory;
};

export async function getAirportPassengerAdvisories(raw: z.input<typeof Input>): Promise<AirportPassengerAdvisoryPair> {
  const input = Input.parse(raw);
  const now = new Date();
  const offsets = new Set<0 | 1>();
  const snapshotDates: string[] = [];
  for (const selectedAt of [input.arrival.selectedAt, input.departure.selectedAt]) {
    const date = selectedAt.slice(0, 10);
    const offset = forecastDayOffset(date, now);
    if (offset !== null) {
      offsets.add(offset);
      snapshotDates.push(date);
    }
  }
  const snapshotPoints = materializeAirportPassengerSnapshot(
    snapshot.profiles as AirportPassengerProfile[],
    snapshotDates,
  );

  let livePoints: AirportPassengerPoint[] = [];
  if (flightMode() === "live") {
    try {
      livePoints = (await Promise.all([...offsets].map((offset) => lookupLivePassengerForecast(offset)))).flat();
    } catch {
      // 항공편 조회와 같은 계약: 키·네트워크·파싱 오류는 결정적 스냅샷으로 폴백한다.
    }
  }
  const evaluate = (direction: "arrival" | "departure", values: typeof input.arrival) => {
    const evaluationInput = {
      direction,
      selectedAt: values.selectedAt,
      selectedSlackMinutes: values.slackMinutes,
      terminal: values.terminal,
    };
    const live = livePoints.length > 0
      ? evaluateAirportPassengerAdvisory({ ...evaluationInput, points: livePoints, source: "live", now })
      : null;
    // API가 성공해도 선택 터미널·시간대 레코드가 비어 있을 수 있다. 그 방향만 픽스처로
    // 다시 평가해 일부 응답이 전체 폴백 사다리를 끊지 않게 한다.
    return live && live.status !== "unavailable"
      ? live
      : evaluateAirportPassengerAdvisory({ ...evaluationInput, points: snapshotPoints, source: "snapshot", now });
  };

  return {
    arrival: evaluate("arrival", input.arrival),
    departure: evaluate("departure", input.departure),
  };
}
