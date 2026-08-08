import { describe, expect, it } from "vitest";
import { buildRegionWindows } from "../engine/region-windows";
import type { TrainRide } from "../engine/types";

// #33 확정 계약 — 합성 fixture 단위 테스트 (실데이터 회귀는 region-windows-seed.test.ts로 분리)
// 산식: 날짜별 max(0, min(endAt, 21:00 KST) - max(startAt, 09:00 KST)), 접근·체류·여유 미차감

const stations = [
  { id: "icn", regionId: "seoul_metro", isAirport: true },
  { id: "seoul", regionId: "seoul_metro" },
  { id: "gangneung", regionId: "gangwon" },
];

const ride = (
  trainNo: string,
  from: string,
  to: string,
  departAt: string,
  arriveAt: string,
): TrainRide => ({ trainNo, fromStationId: from, toStationId: to, departAt, arriveAt });

describe("buildRegionWindows (#33)", () => {
  it("하루 복수 역·동일 역 재방문을 배열 순서로 표현하고 공항역 체류는 창을 만들지 않는다", () => {
    const windows = buildRegionWindows({
      rides: [
        ride("AREX-1", "icn", "seoul", "2026-08-12T10:18:00+09:00", "2026-08-12T11:01:00+09:00"),
        ride("K1", "seoul", "gangneung", "2026-08-12T13:55:00+09:00", "2026-08-12T15:54:00+09:00"),
        ride("K2", "gangneung", "seoul", "2026-08-12T18:00:00+09:00", "2026-08-12T20:00:00+09:00"),
        ride("AREX-2", "seoul", "icn", "2026-08-12T20:30:00+09:00", "2026-08-12T21:13:00+09:00"),
      ],
      airportReadyAt: "2026-08-12T10:00:00+09:00",
      airportArrivalDeadline: "2026-08-12T21:30:00+09:00",
      startStationId: "icn",
      stations,
    });

    expect(windows.map((w) => [w.stationId, w.startBoundary, w.endBoundary, w.availableMinutes]))
      .toEqual([
        ["seoul", "GATEWAY_ARRIVAL", "TRAIN_DEPARTURE", 174], // 11:01-13:55
        ["gangneung", "TRAIN_ARRIVAL", "TRAIN_DEPARTURE", 126], // 15:54-18:00
        ["seoul", "TRAIN_ARRIVAL", "TRAIN_DEPARTURE", 30], // 20:00-20:30 (21:00 클리핑 전 구간)
      ]);
    // 공항역(icn) 체류 3곳(출발 대기·귀국 후)은 창이 아니다
    expect(windows.some((w) => w.stationId === "icn")).toBe(false);
  });

  it("자정을 넘는 체류는 KST 자정에서 분할하고 경계를 DAY_START/DAY_END로 표시한다", () => {
    const windows = buildRegionWindows({
      rides: [
        ride("K1", "seoul", "gangneung", "2026-08-12T13:55:00+09:00", "2026-08-12T15:54:00+09:00"),
        ride("K2", "gangneung", "seoul", "2026-08-14T08:10:00+09:00", "2026-08-14T10:19:00+09:00"),
      ],
      airportReadyAt: "2026-08-12T12:00:00+09:00",
      airportArrivalDeadline: "2026-08-14T16:30:00+09:00",
      startStationId: "seoul",
      stations,
    });

    const gangneung = windows.filter((w) => w.stationId === "gangneung");
    expect(gangneung.map((w) => [w.startBoundary, w.endBoundary, w.availableMinutes])).toEqual([
      ["TRAIN_ARRIVAL", "DAY_END", 306], // 15:54-21:00
      ["DAY_START", "DAY_END", 720], // 09:00-21:00 온전한 하루
      // 마지막 날 00:00-08:10 구간은 활동시간(09:00) 이전 0분 창 — 출력하지 않는다 (PR #45 리뷰)
    ]);
    // 각 창은 단일 KST 날짜에 속한다 (자정 분할 불변식)
    for (const w of windows) {
      const dateOf = (iso: string) =>
        new Date(Date.parse(iso) + 9 * 3600_000).toISOString().slice(0, 10);
      const endDate = dateOf(new Date(Date.parse(w.endAt) - 1).toISOString());
      expect(dateOf(w.startAt)).toBe(endDate);
    }
  });

  it("열차가 없으면 시작·종료가 AIRPORT_READY → AIRPORT_DEADLINE 단일 창이다 (관문역 출발 여정)", () => {
    const windows = buildRegionWindows({
      rides: [],
      airportReadyAt: "2026-08-12T10:00:00+09:00",
      airportArrivalDeadline: "2026-08-12T16:30:00+09:00",
      startStationId: "seoul",
      stations,
    });
    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({
      stationId: "seoul",
      regionId: "seoul_metro",
      startBoundary: "AIRPORT_READY",
      endBoundary: "AIRPORT_DEADLINE",
      availableMinutes: 390, // 10:00-16:30
    });
  });

  it("활동시간 밖(심야) 0분 창은 출력하지 않는다 (PR #45 리뷰 — 활용 가능한 창만 반환)", () => {
    const windows = buildRegionWindows({
      rides: [
        ride("K1", "seoul", "gangneung", "2026-08-12T19:00:00+09:00", "2026-08-12T21:30:00+09:00"),
      ],
      airportReadyAt: "2026-08-12T18:00:00+09:00",
      airportArrivalDeadline: "2026-08-12T23:00:00+09:00",
      startStationId: "seoul",
      stations,
    });
    // 강릉 도착(21:30)-마감(23:00) 구간은 활동시간 밖 — 창 자체를 만들지 않는다
    expect(windows.some((w) => w.stationId === "gangneung")).toBe(false);
    for (const w of windows) expect(w.availableMinutes).toBeGreaterThan(0);
  });

  it("동일 입력에는 동일 출력 — 결정적", () => {
    const params = {
      rides: [
        ride("K1", "seoul", "gangneung", "2026-08-12T13:55:00+09:00", "2026-08-12T15:54:00+09:00"),
      ],
      airportReadyAt: "2026-08-12T12:00:00+09:00",
      airportArrivalDeadline: "2026-08-12T21:00:00+09:00",
      startStationId: "seoul",
      stations,
    };
    expect(buildRegionWindows(params)).toEqual(buildRegionWindows(params));
  });
});
