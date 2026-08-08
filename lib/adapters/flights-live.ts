import "server-only";
/**
 * 인천공항 여객기 운항 현황 "상세조회" 실호출 어댑터 (#46, API_SPEC 2.1, REQ-DATA-003)
 *
 * - 유일한 런타임 실호출. 5초 초과 또는 오류 시 호출부(Action)가 스냅샷으로 폴백한다.
 * - #46 확정: 주간 현황(StatusOfPassengerFlightsDSOdp — 편명·날짜 필터 없음) 대신
 *   상세조회(StatusOfPassengerFlightsDeOdp)를 사용한다. `searchday`(D-3~D+6)와
 *   `flight_id`로 필터해 해당 편만 받는다 (2026-08-08 실측: totalCount 1).
 * - 포털 인증키는 단일 발급형이라 Encoding/Decoding 구분이 없다(포털 안내: "구동되는 키를
 *   사용"). 키가 %를 포함하면 인코딩형으로 보고 원형을 먼저 쓰고, 인증 오류면 반대 형태로
 *   1회 재시도한다.
 * - live 정상 응답(200)이지만 해당 편명이 없으면 NOT_FOUND — 오류 폴백과 구분한다 (#46).
 */
import { env } from "../env";
import type { FlightInfo } from "../actions/flights";

const ENDPOINT = "https://apis.data.go.kr/B551177/StatusOfPassengerFlightsDeOdp";
const OPERATIONS = {
  arrival: "getPassengerArrivalsDeOdp",
  departure: "getPassengerDeparturesDeOdp",
} as const;
const TIMEOUT_MS = 5_000; // API_SPEC 2.1 — 이 시간 안에 못 받으면 스냅샷 폴백
const CACHE_TTL_MS = 5 * 60_000; // 같은 편 재클릭 시 재호출 방지 (일 500건 쿼터 보호)
const MAX_ROWS = 50; // 편명 필터 후 코드셰어 변형까지 수용

export type LiveFlightRecord = {
  flightId: string;
  scheduleDateTime: string; // yyyyMMddHHmm (KST)
  estimatedDateTime?: string | null;
  remark?: string | null; // 도착·착륙·지연·결항 등 — 운항 전이면 null
  terminalid?: string | null; // P01·P02·P03
  codeshare?: string | null; // Master | Slave
};

export type LiveLookupResult =
  | { ok: true; flight: FlightInfo }
  | { ok: false; reason: "NOT_FOUND" };

export class AirportApiError extends Error {
  constructor(message: string, readonly isKeyError: boolean) {
    super(message);
    this.name = "AirportApiError";
  }
}

/** 단일 발급 키 → 시도 순서. % 포함이면 인코딩형(원형 우선), 아니면 평문(인코딩형 후순위) */
export function serviceKeyVariants(key: string): string[] {
  const variants = [key];
  try {
    const alternate = key.includes("%") ? decodeURIComponent(key) : encodeURIComponent(key);
    if (alternate !== key) variants.push(alternate);
  } catch {
    // 잘못된 % 시퀀스 — 원형만 시도
  }
  return variants;
}

/** "202608080025" → "2026-08-08T00:25:00+09:00" (API 시각은 KST 고정) */
export function parseAirportDateTime(value: string | null | undefined): string | null {
  if (!value || !/^\d{12}$/.test(value)) return null;
  const [y, mo, d, h, mi] = [
    value.slice(0, 4), value.slice(4, 6), value.slice(6, 8), value.slice(8, 10), value.slice(10, 12),
  ];
  const iso = `${y}-${mo}-${d}T${h}:${mi}:00+09:00`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

/** UI datetime-local(KST)의 날짜부 → searchday. 형식 밖이면 null(라이브 조회 불가) */
export function toSearchday(dateOrDateTime: string | undefined): string | null {
  const date = dateOrDateTime?.slice(0, 10);
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return date.replaceAll("-", "");
}

const TERMINAL_LABELS: Record<string, string> = {
  P01: "T1",
  P02: "T1 탑승동",
  P03: "T2",
};

export function terminalLabel(terminalid: string | null | undefined): string | undefined {
  if (!terminalid) return undefined;
  return TERMINAL_LABELS[terminalid] ?? terminalid;
}

/**
 * 편명 매칭 — 정확 일치 우선, 없으면 코드셰어 접미사 한 글자 허용(KE852 ↔ KE852Y).
 * 다건이면 Master 우선 → 예정 시각 오름차순 첫 건 (결정적).
 */
export function pickFlight(
  records: LiveFlightRecord[],
  flightNo: string,
): LiveFlightRecord | null {
  const query = flightNo.trim().toUpperCase();
  if (!query) return null;
  const exact = records.filter((r) => r.flightId.toUpperCase() === query);
  const suffixed = exact.length > 0
    ? exact
    : records.filter((r) => {
        const id = r.flightId.toUpperCase();
        return id.length === query.length + 1 && id.startsWith(query) && /[A-Z]$/.test(id);
      });
  if (suffixed.length === 0) return null;
  return [...suffixed].sort((a, b) =>
    (a.codeshare === "Master" ? 0 : 1) - (b.codeshare === "Master" ? 0 : 1)
    || a.scheduleDateTime.localeCompare(b.scheduleDateTime, "en")
    || a.flightId.localeCompare(b.flightId, "en"),
  )[0];
}

export function toFlightInfo(
  record: LiveFlightRecord,
  requestedFlightNo: string,
  direction: "arrival" | "departure",
): FlightInfo | null {
  const scheduledAt = parseAirportDateTime(record.scheduleDateTime);
  if (!scheduledAt) return null;
  const estimatedAt = parseAirportDateTime(record.estimatedDateTime) ?? undefined;
  return {
    flightNo: requestedFlightNo.trim().toUpperCase(),
    direction,
    scheduledAt,
    estimatedAt,
    status: record.remark || undefined,
    terminal: terminalLabel(record.terminalid),
  };
}

type FetchLike = (url: string, init: { signal: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

type Deps = { fetchImpl?: FetchLike; timeoutMs?: number; now?: () => number; serviceKey?: string };

const cache = new Map<string, { at: number; records: LiveFlightRecord[] }>();

/** 테스트 전용 — 모듈 캐시 초기화 */
export function clearLiveFlightCache(): void {
  cache.clear();
}

function extractRecords(payload: unknown): LiveFlightRecord[] {
  const response = (payload as { response?: { header?: { resultCode?: string; resultMsg?: string }; body?: { items?: unknown } } }).response;
  const code = response?.header?.resultCode;
  if (code !== "00") {
    const message = response?.header?.resultMsg ?? "unknown airport API error";
    throw new AirportApiError(message, /SERVICE.?[ _]?KEY|등록되지 않은|UNREGISTERED/i.test(message));
  }
  const items = response?.body?.items;
  return Array.isArray(items) ? (items as LiveFlightRecord[]) : [];
}

async function fetchRecords(
  direction: "arrival" | "departure",
  flightNo: string,
  searchday: string,
  deps: Deps,
): Promise<LiveFlightRecord[]> {
  const key = deps.serviceKey ?? env.AIRPORT_API_KEY;
  if (!key) throw new AirportApiError("AIRPORT_API_KEY missing", true);
  const now = deps.now ?? Date.now;
  const cacheKey = `${direction}:${flightNo.trim().toUpperCase()}:${searchday}`;
  const cached = cache.get(cacheKey);
  if (cached && now() - cached.at < CACHE_TTL_MS) return cached.records;

  const fetchImpl = deps.fetchImpl ?? (fetch as unknown as FetchLike);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? TIMEOUT_MS);
  try {
    let lastKeyError: AirportApiError | null = null;
    for (const variant of serviceKeyVariants(key)) {
      const query = `serviceKey=${variant}&type=json&numOfRows=${MAX_ROWS}&pageNo=1`
        + `&searchday=${searchday}&flight_id=${encodeURIComponent(flightNo.trim().toUpperCase())}`;
      const url = `${ENDPOINT}/${OPERATIONS[direction]}?${query}`;
      try {
        const response = await fetchImpl(url, { signal: controller.signal });
        if (!response.ok) throw new AirportApiError(`HTTP ${response.status}`, false);
        const records = extractRecords(await response.json());
        cache.set(cacheKey, { at: now(), records });
        return records;
      } catch (error) {
        // 키 형태 문제일 때만 반대 형태로 재시도 — 타임아웃·네트워크는 즉시 폴백
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

/**
 * 실호출 1건 (#46) — searchday는 조회일 기준 D-3~D+6.
 * 실패(타임아웃·네트워크·키·파싱)는 throw하고 호출부가 스냅샷으로 폴백한다.
 * 200 + 편명 없음은 NOT_FOUND로 반환해 오류 폴백과 구분한다.
 */
export async function lookupLiveFlight(
  flightNo: string,
  direction: "arrival" | "departure",
  searchday: string,
  deps: Deps = {},
): Promise<LiveLookupResult> {
  const records = await fetchRecords(direction, flightNo, searchday, deps);
  const record = pickFlight(records, flightNo);
  const flight = record ? toFlightInfo(record, flightNo, direction) : null;
  return flight ? { ok: true, flight } : { ok: false, reason: "NOT_FOUND" };
}
