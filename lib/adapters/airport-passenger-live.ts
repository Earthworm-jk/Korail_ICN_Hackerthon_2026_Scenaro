import "server-only";

import { env } from "../env";
import { serviceKeyVariants, AirportApiError } from "./flights-live";
import type { AirportPassengerPoint, AirportTerminal } from "../airport-passenger-advisory";

const ENDPOINT = "https://apis.data.go.kr/B551177/passgrAnncmt/getPassgrAnncmt";
const TIMEOUT_MS = 5_000;
const CACHE_TTL_MS = 5 * 60_000;

type LivePassengerRecord = Record<string, unknown> & { adate?: unknown; atime?: unknown };
type FetchLike = (url: string, init: { signal: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;
type Deps = { fetchImpl?: FetchLike; timeoutMs?: number; now?: () => number; serviceKey?: string };

const cache = new Map<number, { at: number; points: AirportPassengerPoint[] }>();

export function clearLivePassengerForecastCache(): void {
  cache.clear();
}

function numberOf(record: LivePassengerRecord, key: string): number {
  const value = Number(record[key] ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function sum(record: LivePassengerRecord, keys: string[]): number {
  return keys.reduce((total, key) => total + numberOf(record, key), 0);
}

function normalizeDate(value: unknown): string | null {
  const digits = String(value ?? "").replaceAll("-", "");
  if (!/^\d{8}$/.test(digits)) return null;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

function normalizeHour(value: unknown): number | null {
  const digits = String(value ?? "").padStart(4, "0");
  const hour = Number(digits.slice(0, 2));
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : null;
}

function point(
  date: string,
  hour: number,
  terminal: AirportTerminal,
  direction: "arrival" | "departure",
  passengerCount: number,
): AirportPassengerPoint | null {
  return passengerCount > 0 ? { date, hour, terminal, direction, passengerCount } : null;
}

/**
 * 2025-11 응답 변경 후 T1 출국장은 t1dg1..6이다. T2와 입국장은 기존 합계 필드를
 * 유지한다. 입국은 입국장 동·서(또는 1·2) 출현 인원만 합쳐 심사장과 중복 집계하지 않는다.
 */
export function normalizePassengerRecords(records: LivePassengerRecord[]): AirportPassengerPoint[] {
  return records.flatMap((record) => {
    const date = normalizeDate(record.adate);
    const hour = normalizeHour(record.atime);
    if (!date || hour === null) return [];
    return [
      point(date, hour, "T1", "arrival", sum(record, ["t1sum1", "t1sum2"])),
      point(date, hour, "T2", "arrival", sum(record, ["t2sum1", "t2sum2"])),
      point(date, hour, "T1", "departure", sum(record, ["t1dg1", "t1dg2", "t1dg3", "t1dg4", "t1dg5", "t1dg6"]) || sum(record, ["t1sum5", "t1sum6", "t1sum7", "t1sum8"])),
      point(date, hour, "T2", "departure", sum(record, ["t2dg1", "t2dg2"]) || sum(record, ["t2sum3", "t2sum4"])),
    ].filter((value): value is AirportPassengerPoint => value !== null);
  });
}

function extractRecords(payload: unknown): LivePassengerRecord[] {
  const response = (payload as {
    response?: { header?: { resultCode?: string; resultMsg?: string }; body?: { items?: unknown } };
  }).response;
  const code = response?.header?.resultCode;
  if (code !== "00") {
    const message = response?.header?.resultMsg ?? "unknown airport passenger API error";
    throw new AirportApiError(message, /SERVICE.?[ _]?KEY|등록되지 않은|UNREGISTERED/i.test(message));
  }
  const items = response?.body?.items;
  if (Array.isArray(items)) return items as LivePassengerRecord[];
  const nested = (items as { item?: unknown } | undefined)?.item;
  return Array.isArray(nested) ? nested as LivePassengerRecord[] : nested ? [nested as LivePassengerRecord] : [];
}

export async function lookupLivePassengerForecast(
  dayOffset: 0 | 1,
  deps: Deps = {},
): Promise<AirportPassengerPoint[]> {
  const key = deps.serviceKey ?? env.AIRPORT_API_KEY;
  if (!key) throw new AirportApiError("AIRPORT_API_KEY missing", true);
  const now = deps.now ?? Date.now;
  const cached = cache.get(dayOffset);
  if (cached && now() - cached.at < CACHE_TTL_MS) return cached.points;

  const fetchImpl = deps.fetchImpl ?? (fetch as unknown as FetchLike);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? TIMEOUT_MS);
  try {
    let lastKeyError: AirportApiError | null = null;
    for (const variant of serviceKeyVariants(key)) {
      const url = `${ENDPOINT}?serviceKey=${variant}&type=json&numOfRows=48&pageNo=1&selectdate=${dayOffset}`;
      try {
        const response = await fetchImpl(url, { signal: controller.signal });
        if (!response.ok) throw new AirportApiError(`HTTP ${response.status}`, false);
        const points = normalizePassengerRecords(extractRecords(await response.json()));
        cache.set(dayOffset, { at: now(), points });
        return points;
      } catch (error) {
        if (error instanceof AirportApiError && error.isKeyError) {
          lastKeyError = error;
          continue;
        }
        throw error;
      }
    }
    throw lastKeyError ?? new AirportApiError("no service key variant worked", true);
  } finally {
    clearTimeout(timer);
  }
}
