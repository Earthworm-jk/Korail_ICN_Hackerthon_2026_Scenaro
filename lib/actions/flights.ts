"use server";
/**
 * 항공편 조회 (REQ-SRCH-001, API_SPEC 3.2)
 * live 모드(키 존재)면 실호출 1건을 시도하고, 5초 초과·오류 시 스냅샷으로 폴백한다
 * (REQ-DATA-003, NFR-DEMO-001). 사용자에게 오류를 던지지 않는다 — source로 폴백 여부만 알린다.
 */
import { flightMode } from "../env";
import { loadRepositories } from "../repositories/json";
import { lookupLiveFlight } from "../adapters/flights-live";

export type FlightInfo = {
  flightNo: string;
  direction: "arrival" | "departure";
  scheduledAt: string; // 예정 시각
  estimatedAt?: string; // 변경(예상) 시각 — live 조회 시
  status?: string; // 운항 상태 문구 — live 조회 시
  terminal?: string;
};

export async function getFlightInfo(
  flightNo: string,
  direction: "arrival" | "departure",
): Promise<
  | { ok: true; flight: FlightInfo; source: "live" | "snapshot" }
  | { ok: false; reason: "FLIGHT_NOT_FOUND" }
> {
  const q = flightNo.trim();
  if (!q) return { ok: false, reason: "FLIGHT_NOT_FOUND" };

  if (flightMode() === "live") {
    try {
      const live = await lookupLiveFlight(q, direction);
      if (live.ok) return { ok: true, flight: live.flight, source: "live" };
      // 실호출은 성공했지만 미검색 — 데모 스냅샷 편명일 수 있으므로 스냅샷도 확인한다
    } catch {
      // 타임아웃·네트워크·키 오류 — 스냅샷 폴백 (API_SPEC 3.3: 오류를 사용자에게 던지지 않음)
    }
  }

  const flight = loadRepositories().flights.find(
    (f) => f.direction === direction && f.flightNo.toLowerCase() === q.toLowerCase(),
  );
  if (!flight) return { ok: false, reason: "FLIGHT_NOT_FOUND" };
  const { flightNo: no, scheduledAt, terminal } = flight;
  return { ok: true, flight: { flightNo: no, direction, scheduledAt, terminal }, source: "snapshot" };
}
