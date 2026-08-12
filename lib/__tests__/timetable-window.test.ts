import { describe, expect, it } from "vitest";
import { loadRepositories } from "../repositories/json";
import { loadTimetableWindow } from "../timetable-window";

/**
 * 수록 범위는 화면이 고를 수 있는 날짜의 상한·하한이다 (#160 · QA 실측)
 *
 * 값을 화면에 박아 두면 스냅샷을 갱신할 때마다 어긋난다 — 실제로 기본 날짜가 하드코딩된
 * 탓에 시연 날짜가 지난 날로 남았다. 그래서 스냅샷에서 파생하고, 그 파생이 깨지지 않게
 * 고정한다.
 */
describe("열차 수록 범위", () => {
  const window = loadTimetableWindow();
  const dates = [...new Set(loadRepositories().trainLegs.map((leg) => leg.departAt.slice(0, 10)))].sort();

  it("스냅샷의 실제 최소·최대 날짜와 같다", () => {
    expect(window.firstDate).toBe(dates[0]);
    expect(window.lastDate).toBe(dates[dates.length - 1]);
  });

  /**
   * 빈 날이 생기면 그 앞뒤로 열차 공백이 하루를 넘고, #178 심야 침묵 하한이 그 공백에서
   * 파생돼 판정이 뒤틀린다. 실제로 08-15를 비운 판에서 engine.test.ts가 이를 잡았다.
   */
  it("수록 날짜에 빈 날이 없다 — 심야 판정 파생이 공백을 타지 않아야 한다", () => {
    const missing: string[] = [];
    for (let i = 1; i < dates.length; i += 1) {
      const previous = Date.parse(`${dates[i - 1]}T00:00:00+09:00`);
      const current = Date.parse(`${dates[i]}T00:00:00+09:00`);
      const gapDays = Math.round((current - previous) / 86_400_000);
      for (let d = 1; d < gapDays; d += 1) {
        missing.push(new Date(previous + d * 86_400_000).toISOString().slice(0, 10));
      }
    }
    expect(missing).toEqual([]);
  });

  it("공항철도가 수록 범위의 첫날과 마지막날 모두에 있다 — 진입·복귀 수단이 있어야 한다", () => {
    const airportLegs = loadRepositories().trainLegs.filter(
      (leg) => leg.fromStationId.includes("incheon-airport") || leg.toStationId.includes("incheon-airport"),
    );
    const days = new Set(airportLegs.map((leg) => leg.departAt.slice(0, 10)));
    expect(days.has(window.lastDate)).toBe(true);
    expect([...days].some((day) => day <= window.firstDate)).toBe(true);
  });
});
