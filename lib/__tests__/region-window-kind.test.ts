import { describe, expect, it } from "vitest";
import { classifyRegionWindow } from "../engine/region-windows";
import { planItinerary, type PlanRequest } from "../actions/itinerary";
import type { RegionWindow, TrainRide } from "../engine/types";

/**
 * 창의 성격 판정 (#101)
 *
 * "서울역 권역 · 약 54분 활용 가능"은 사실이 아니다. 그 54분은 공항철도 도착과 KTX
 * 출발 사이의 환승 대기이고, 접근시간 왕복과 엔진 버퍼 때문에 아무것도 배치되지 않는다.
 * 쓸 수 없는 시간을 활용 가능이라고 부르는 것이 오해의 원인이었다.
 *
 * 다만 같은 열차의 중간역 정차를 환승이라 부르는 것도 거짓이다 (PR #107 리뷰).
 */

const STATION = "station-seoul";
const START = "2026-08-12T04:01:00.000Z";
const END = "2026-08-12T04:55:00.000Z";

const window = (
  startBoundary: RegionWindow["startBoundary"],
  endBoundary: RegionWindow["endBoundary"],
  startAt = START,
  endAt = END,
) => ({ stationId: STATION, startAt, endAt, startBoundary, endBoundary });

const ride = (
  trainNo: string,
  fromStationId: string,
  toStationId: string,
  departAt: string,
  arriveAt: string,
): TrainRide => ({ trainNo, fromStationId, toStationId, departAt, arriveAt });

/** 창 앞뒤에 서로 다른 열차가 붙은 기본 배치 */
const transferRides = [
  ride("00801", "station-incheon-airport-t1", STATION, "2026-08-12T03:18:00.000Z", START),
  ride("00033", STATION, "station-busan", END, "2026-08-12T06:59:00.000Z"),
];

/** 같은 열차가 중간역에 서는 배치 — 내리지 않는다 */
const throughRides = [
  ride("00503", "station-yongsan", STATION, "2026-08-12T03:18:00.000Z", START),
  ride("00503", STATION, "station-jeonju", END, "2026-08-12T06:59:00.000Z"),
];

describe("환승 대기·통과 정차·체류 구분 (#101)", () => {
  it("서로 다른 열차 사이의 빈 창은 환승 대기다", () => {
    expect(classifyRegionWindow(window("TRAIN_ARRIVAL", "TRAIN_DEPARTURE"), [], transferRides))
      .toBe("transfer_wait");
  });

  it("같은 열차번호의 연속 leg 사이 빈 창은 환승이 아니다 — 통과 정차다", () => {
    expect(classifyRegionWindow(window("TRAIN_ARRIVAL", "TRAIN_DEPARTURE"), [], throughRides))
      .toBe("through_stop");
  });

  it("공항 진입편에서 열차로 갈아타는 것은 언제나 환승이다", () => {
    // 공항철도·검증 공항버스는 rides(열차)에 없으므로 편성 비교 대상이 아니다
    expect(classifyRegionWindow(window("GATEWAY_ARRIVAL", "TRAIN_DEPARTURE"), [], []))
      .toBe("transfer_wait");
  });

  it("열차 사이라도 방문이 배치돼 있으면 쓰고 있는 시간이다", () => {
    const kind = classifyRegionWindow(window("TRAIN_ARRIVAL", "TRAIN_DEPARTURE"), [
      { arriveAt: "2026-08-12T04:10:00.000Z", departAt: "2026-08-12T04:40:00.000Z" },
    ], transferRides);
    expect(kind).toBe("stay");
  });

  it("창 밖의 방문은 세지 않는다", () => {
    const kind = classifyRegionWindow(window("TRAIN_ARRIVAL", "TRAIN_DEPARTURE"), [
      { arriveAt: "2026-08-12T06:00:00.000Z", departAt: "2026-08-12T07:00:00.000Z" },
    ], transferRides);
    expect(kind).toBe("transfer_wait");
  });

  it("일부만 걸쳐도 방문이 있는 것으로 본다", () => {
    const kind = classifyRegionWindow(window("TRAIN_ARRIVAL", "TRAIN_DEPARTURE"), [
      { arriveAt: "2026-08-12T04:40:00.000Z", departAt: "2026-08-12T05:30:00.000Z" },
    ], transferRides);
    expect(kind).toBe("stay");
  });

  it("여행 시작·마감 경계의 빈 창은 환승이 아니다", () => {
    expect(classifyRegionWindow(window("AIRPORT_READY", "TRAIN_DEPARTURE"), [], transferRides))
      .toBe("stay");
    expect(classifyRegionWindow(window("TRAIN_ARRIVAL", "AIRPORT_DEADLINE"), [], transferRides))
      .toBe("stay");
  });

  it("자정 분할로 이어지는 창도 환승으로 치지 않는다", () => {
    expect(classifyRegionWindow(window("DAY_START", "TRAIN_DEPARTURE"), [], transferRides))
      .toBe("stay");
    expect(classifyRegionWindow(window("TRAIN_ARRIVAL", "DAY_END"), [], transferRides))
      .toBe("stay");
  });

  it("앞뒤 편성을 찾지 못하면 주장하지 않는다", () => {
    expect(classifyRegionWindow(window("TRAIN_ARRIVAL", "TRAIN_DEPARTURE"), [], []))
      .toBe("stay");
    // 도착편만 있고 출발편을 못 찾는 경우도 마찬가지다
    expect(classifyRegionWindow(window("TRAIN_ARRIVAL", "TRAIN_DEPARTURE"), [], [transferRides[0]]))
      .toBe("stay");
  });

  it("다른 역의 같은 시각 편성을 잘못 집지 않는다", () => {
    const elsewhere = [
      ride("00801", "station-busan", "station-gangneung", "2026-08-12T03:18:00.000Z", START),
      ride("00801", "station-gangneung", "station-jinbu", END, "2026-08-12T06:59:00.000Z"),
    ];
    expect(classifyRegionWindow(window("TRAIN_ARRIVAL", "TRAIN_DEPARTURE"), [], elsewhere))
      .toBe("stay");
  });
});

describe("실시드 회귀 — 서울역 빈 체류의 정체 (#101)", () => {
  const base: PlanRequest = {
    arrivalAt: "2026-08-12T10:00:00+09:00",
    departureAt: "2026-08-14T18:00:00+09:00",
    airportReadyAt: "2026-08-12T12:00:00+09:00",
    airportArrivalDeadline: "2026-08-14T16:00:00+09:00",
    selectedActorIds: ["actor-kim-go-eun"],
    selectedWorkIds: [],
    excludedPlaceIds: [],
  };

  it("방문 0곳인 서울역 창이 환승 대기로 판정된다", async () => {
    const res = await planItinerary(base);
    expect(res.ok).toBe(true);
    if (!res.ok || res.result.status !== "planned") return;
    const allRides = res.result.days.flatMap((day) => day.rides);

    const classified = res.result.days.flatMap((day) =>
      day.regionWindows.map((w) => ({
        stationId: w.stationId,
        kind: classifyRegionWindow(w, day.items, allRides),
      })));

    // 이 시드에는 환승 대기가 실제로 존재한다 — 분기가 죽은 코드가 아니다
    const waits = classified.filter((w) => w.kind === "transfer_wait");
    expect(waits.length).toBeGreaterThan(0);
    expect(waits.some((w) => w.stationId === "station-seoul")).toBe(true);

    // 환승 대기로 판정된 창에는 방문이 하나도 없어야 한다
    for (const day of res.result.days) {
      for (const w of day.regionWindows) {
        if (classifyRegionWindow(w, day.items, allRides) !== "transfer_wait") continue;
        const overlapping = day.items.filter(
          (item) => Date.parse(item.arriveAt) < Date.parse(w.endAt)
            && Date.parse(item.departAt) > Date.parse(w.startAt),
        );
        expect(overlapping, `${day.date} ${w.stationId}`).toEqual([]);
      }
    }
  });

  it("환승 대기로 판정된 창의 앞뒤는 서로 다른 열차다", async () => {
    const res = await planItinerary(base);
    if (!res.ok || res.result.status !== "planned") return;
    const allRides = res.result.days.flatMap((day) => day.rides);

    for (const day of res.result.days) {
      for (const w of day.regionWindows) {
        if (classifyRegionWindow(w, day.items, allRides) !== "transfer_wait") continue;
        const arriving = allRides.find(
          (r) => r.toStationId === w.stationId
            && Date.parse(r.arriveAt) === Date.parse(w.startAt));
        const departing = allRides.find(
          (r) => r.fromStationId === w.stationId
            && Date.parse(r.departAt) === Date.parse(w.endAt));
        // 공항 진입편은 rides에 없으므로 도착편을 못 찾는 것이 정상이다
        if (!arriving || !departing) continue;
        expect(arriving.trainNo, `${day.date} ${w.stationId}`).not.toBe(departing.trainNo);
      }
    }
  });

  it("방문이 배치된 권역 창은 환승으로 오분류되지 않는다", async () => {
    const res = await planItinerary(base);
    if (!res.ok || res.result.status !== "planned") return;
    const allRides = res.result.days.flatMap((day) => day.rides);
    for (const day of res.result.days) {
      for (const item of day.items) {
        const holding = day.regionWindows.filter(
          (w) => Date.parse(item.arriveAt) < Date.parse(w.endAt)
            && Date.parse(item.departAt) > Date.parse(w.startAt),
        );
        for (const w of holding) {
          expect(classifyRegionWindow(w, day.items, allRides), `${day.date} ${w.stationId}`)
            .toBe("stay");
        }
      }
    }
  });
});
