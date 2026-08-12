export const DEFAULT_AIRPORT_SLACK_MINUTES = 120;

export type AirportDirection = "arrival" | "departure";
export type AirportTerminal = "T1" | "T2";

export type AirportPassengerPoint = {
  date: string;
  hour: number;
  terminal: AirportTerminal;
  direction: AirportDirection;
  passengerCount: number;
};

export type AirportPassengerAdvisory = {
  direction: AirportDirection;
  status: "elevated" | "clear" | "unavailable" | "out_of_range";
  source: "live" | "snapshot" | "none";
  date: string;
  hour: number;
  terminal?: AirportTerminal;
  passengerCount?: number;
  elevatedThreshold?: number;
  key: string;
};

function kstDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function forecastDayOffset(date: string, now = new Date()): 0 | 1 | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const todayMs = Date.parse(`${kstDate(now)}T00:00:00+09:00`);
  const targetMs = Date.parse(`${date}T00:00:00+09:00`);
  const offset = Math.round((targetMs - todayMs) / 86_400_000);
  return offset === 0 || offset === 1 ? offset : null;
}

function percentile75(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.75) - 1] ?? null;
}

export function evaluateAirportPassengerAdvisory(input: {
  direction: AirportDirection;
  selectedAt: string;
  selectedSlackMinutes: number | null;
  terminal?: string;
  points: AirportPassengerPoint[];
  source: "live" | "snapshot";
  now?: Date;
}): AirportPassengerAdvisory {
  const date = input.selectedAt.slice(0, 10);
  const hour = Number(input.selectedAt.slice(11, 13));
  const terminal = input.terminal === "T1" || input.terminal === "T2" ? input.terminal : undefined;
  const base = {
    direction: input.direction,
    date,
    hour: Number.isInteger(hour) ? hour : 0,
    terminal,
  } as const;
  const keyBase = `${input.direction}:${date}:${hour}:${terminal ?? "ALL"}`;

  if (forecastDayOffset(date, input.now) === null) {
    return { ...base, status: "out_of_range", source: "none", key: `${keyBase}:out_of_range` };
  }

  const dayPoints = input.points.filter((point) =>
    point.date === date
    && point.direction === input.direction
    && (!terminal || point.terminal === terminal),
  );
  if (dayPoints.length === 0) {
    return { ...base, status: "unavailable", source: "none", key: `${keyBase}:unavailable` };
  }

  const countByHour = new Map<number, number>();
  for (const point of dayPoints) {
    countByHour.set(point.hour, (countByHour.get(point.hour) ?? 0) + point.passengerCount);
  }
  if (countByHour.size < 4) {
    return { ...base, status: "unavailable", source: "none", key: `${keyBase}:insufficient_data` };
  }
  const passengerCount = countByHour.get(hour);
  const elevatedThreshold = percentile75([...countByHour.values()]);
  if (passengerCount === undefined || elevatedThreshold === null) {
    return { ...base, status: "unavailable", source: "none", key: `${keyBase}:unavailable` };
  }

  // 공식 혼잡 등급이 아니다. 같은 날짜·방향·터미널 안에서 예상 승객 상위 시간대인지와
  // 사용자가 기본값보다 넉넉한 여유를 두었는지만 결합한 결정적 경고 신호다 (#177).
  const elevated = passengerCount >= elevatedThreshold
    && input.selectedSlackMinutes !== null
    && input.selectedSlackMinutes <= DEFAULT_AIRPORT_SLACK_MINUTES;
  return {
    ...base,
    status: elevated ? "elevated" : "clear",
    source: input.source,
    passengerCount,
    elevatedThreshold,
    key: `${keyBase}:${passengerCount}:${elevatedThreshold}:${input.selectedSlackMinutes ?? "none"}`,
  };
}
