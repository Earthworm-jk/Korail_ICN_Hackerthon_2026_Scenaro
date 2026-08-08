"use server";
/**
 * 항공편 조회 (REQ-SRCH-001) — P0는 스냅샷 조회, 실호출+폴백은 P1 (REQ-DATA-003)
 */
import { loadRepositories } from "../repositories/json";

export type FlightInfo = {
  flightNo: string;
  direction: "arrival" | "departure";
  scheduledAt: string;
  terminal?: string;
};

export async function getFlightInfo(
  flightNo: string,
  direction: "arrival" | "departure",
): Promise<
  | { ok: true; flight: FlightInfo; source: "snapshot" }
  | { ok: false; reason: "FLIGHT_NOT_FOUND" }
> {
  const q = flightNo.trim().toLowerCase();
  const flight = loadRepositories().flights.find(
    (f) => f.direction === direction && f.flightNo.toLowerCase() === q,
  );
  if (!flight) return { ok: false, reason: "FLIGHT_NOT_FOUND" };
  const { flightNo: no, scheduledAt, terminal } = flight;
  return { ok: true, flight: { flightNo: no, direction, scheduledAt, terminal }, source: "snapshot" };
}
