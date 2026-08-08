import { describe, expect, it } from "vitest";
import { loadRepositories } from "../repositories/json";
import { generateItinerary } from "../engine";

// #33 — 김고은 실데이터 회귀 (합성 fixture 계약 테스트와 분리, 시드 갱신 시 함께 갱신)

const KST_OFFSET = 9 * 3600_000;
const kstDate = (iso: string) =>
  new Date(Date.parse(iso) + KST_OFFSET).toISOString().slice(0, 10);

describe("regionWindows — 김고은 시드 회귀 (#33)", () => {
  const repos = loadRepositories();
  const result = generateItinerary(
    {
      arrivalAt: "2026-08-12T10:00:00+09:00",
      departureAt: "2026-08-14T18:00:00+09:00",
      airportReadyAt: "2026-08-12T12:00:00+09:00",
      airportArrivalDeadline: "2026-08-14T16:00:00+09:00",
      selectedActorIds: ["actor-kim-go-eun"],
      selectedWorkIds: [],
      excludedPlaceIds: [],
      maxPlacesPerDay: 3,
      dailySlackMinutes: 120,
    },
    repos,
  );

  it("planned 결과의 모든 날짜에 regionWindows가 있고 시간순이다", () => {
    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.days.length).toBeGreaterThan(0);
    const allWindows = result.days.flatMap((day) => day.regionWindows);
    expect(allWindows.length).toBeGreaterThan(0);
    for (const day of result.days) {
      const starts = day.regionWindows.map((w) => Date.parse(w.startAt));
      expect([...starts].sort((a, b) => a - b)).toEqual(starts);
      // 창은 시작 날짜(KST) 기준으로 그 날에 귀속된다
      for (const w of day.regionWindows) expect(kstDate(w.startAt)).toBe(day.date);
    }
  });

  it("공항역 체류 창이 없고, 관문 진입 창은 GATEWAY_ARRIVAL로 시작한다", () => {
    if (result.status !== "planned") return;
    const airportIds = new Set(
      repos.stations.filter((s) => s.isAirport).map((s) => s.id),
    );
    const allWindows = result.days.flatMap((day) => day.regionWindows);
    expect(allWindows.some((w) => airportIds.has(w.stationId))).toBe(false);
    expect(allWindows[0].startBoundary).toBe("GATEWAY_ARRIVAL"); // 공항철도 진입 후 첫 창
  });

  it("availableMinutes는 확정 산식(09:00-21:00 클리핑)과 일치하고 여유·접근을 재차감하지 않는다", () => {
    if (result.status !== "planned") return;
    for (const w of result.days.flatMap((day) => day.regionWindows)) {
      const date = kstDate(w.startAt);
      const clipStart = Math.max(Date.parse(w.startAt), Date.parse(`${date}T09:00:00+09:00`));
      const clipEnd = Math.min(Date.parse(w.endAt), Date.parse(`${date}T21:00:00+09:00`));
      expect(w.availableMinutes).toBe(Math.max(0, Math.round((clipEnd - clipStart) / 60_000)));
    }
  });

  it("마지막 창은 출국 마감 이후 시간을 활용 가능으로 계산하지 않는다", () => {
    if (result.status !== "planned") return;
    const allWindows = result.days.flatMap((day) => day.regionWindows);
    const last = allWindows.at(-1)!;
    expect(Date.parse(last.endAt)).toBeLessThanOrEqual(Date.parse("2026-08-14T16:00:00+09:00"));
  });
});
