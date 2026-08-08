import { describe, expect, it } from "vitest";
import { buildMockAlternatives } from "../alternatives-mock";
import type { DayPlan } from "../engine/types";

// #14 ⑨ 선행 UI용 mock — 전체 교체 형태와 결정성만 고정한다 (개수·다양성 최종 기준은 엔진 계약)

const days: DayPlan[] = [
  {
    date: "2026-08-12",
    rides: [
      {
        trainNo: "801",
        fromStationId: "seoul",
        toStationId: "gangneung",
        departAt: "2026-08-12T04:40:00.000Z",
        arriveAt: "2026-08-12T06:40:00.000Z",
      },
    ],
    items: [
      {
        placeId: "gyeongpo",
        arriveAt: "2026-08-12T07:10:00.000Z",
        departAt: "2026-08-12T09:10:00.000Z",
        accessMinutes: 25,
      },
      {
        placeId: "jumunjin",
        arriveAt: "2026-08-12T10:00:00.000Z",
        departAt: "2026-08-12T11:00:00.000Z",
        accessMinutes: 45,
      },
    ],
    regionWindows: [],
  },
  { date: "2026-08-13", rides: [], items: [], regionWindows: [] },
];

describe("buildMockAlternatives", () => {
  it("열차가 있는 날에만 +60/+120분 대안을 만든다", () => {
    const alts = buildMockAlternatives(days);
    expect(alts.map((a) => a.id)).toEqual(["mock-2026-08-12-60", "mock-2026-08-12-120"]);
  });

  it("대안은 부분 패치가 아니라 전체 일정이며 대상 날짜만 이동한다", () => {
    const [alt60] = buildMockAlternatives(days);
    expect(alt60.days).toHaveLength(2);
    expect(alt60.days[0].rides[0].departAt).toBe("2026-08-12T05:40:00.000Z");
    expect(alt60.days[0].items[0].arriveAt).toBe("2026-08-12T08:10:00.000Z");
    expect(alt60.days[1]).toEqual(days[1]); // 다른 날짜는 그대로
    expect(days[0].rides[0].departAt).toBe("2026-08-12T04:40:00.000Z"); // 원본 불변
  });

  it("+120분 대안은 장소 2곳 이상일 때 마지막 장소를 제외하고 effects에 알린다", () => {
    const [alt60, alt120] = buildMockAlternatives(days);
    expect(alt60.effects.excludedPlaceIds).toEqual([]);
    expect(alt120.effects.excludedPlaceIds).toEqual(["jumunjin"]);
    expect(alt120.days[0].items.map((i) => i.placeId)).toEqual(["gyeongpo"]);
    expect(alt120.effects.localUseDeltaMinutes).toBe(-120);
  });

  it("동일 입력에는 동일 대안 — 결정적", () => {
    expect(buildMockAlternatives(days)).toEqual(buildMockAlternatives(days));
  });
});
