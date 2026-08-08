"use server";
/**
 * 항공편 조회 (#46, REQ-SRCH-001, API_SPEC 3.2)
 *
 * 흐름(#46 확정):
 * - 키 없음 → 외부 호출 없이 즉시 스냅샷
 * - 키 있음 → 상세조회 실호출 1건 (searchday D-3~D+6, 조회 버튼에서만 — 일정 계산 중 재호출 없음)
 * - 5초 초과·네트워크·non-2xx·파싱 오류 → 스냅샷 폴백 (사용자에게 오류를 던지지 않음)
 * - live 정상 응답 + 해당 편명 없음 → FLIGHT_NOT_FOUND (오류 폴백과 구분, 스냅샷 미확인)
 * - 스냅샷에도 없으면 FLIGHT_NOT_FOUND → 직접 시각 입력 유지
 */
import { flightMode } from "../env";
import { loadRepositories } from "../repositories/json";
import { lookupLiveFlight, toSearchday } from "../adapters/flights-live";

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
  /** 조회 날짜(YYYY-MM-DD 또는 datetime-local) — 없으면 라이브 조회 없이 스냅샷만 */
  date?: string,
): Promise<
  | { ok: true; flight: FlightInfo; source: "live" | "snapshot" }
  | { ok: false; reason: "FLIGHT_NOT_FOUND" }
> {
  const q = flightNo.trim();
  if (!q) return { ok: false, reason: "FLIGHT_NOT_FOUND" };

  const searchday = toSearchday(date);
  if (flightMode() === "live" && searchday) {
    try {
      const live = await lookupLiveFlight(q, direction, searchday);
      if (live.ok) return { ok: true, flight: live.flight, source: "live" };
      // live가 정상적으로 "없다"고 답함 — 스냅샷을 확인하지 않고 미검색으로 구분 (#46)
      return { ok: false, reason: "FLIGHT_NOT_FOUND" };
    } catch {
      // 타임아웃·네트워크·키·파싱 오류 — 스냅샷 폴백 (API_SPEC 3.3)
    }
  }

  const flight = loadRepositories().flights.find(
    (f) => f.direction === direction && f.flightNo.toLowerCase() === q.toLowerCase(),
  );
  if (!flight) return { ok: false, reason: "FLIGHT_NOT_FOUND" };
  const { flightNo: no, scheduledAt, terminal } = flight;
  return { ok: true, flight: { flightNo: no, direction, scheduledAt, terminal }, source: "snapshot" };
}
