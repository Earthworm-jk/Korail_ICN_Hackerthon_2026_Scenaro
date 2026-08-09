import { describe, expect, it } from "vitest";
import { classifyRegionWindow } from "../engine/region-windows";
import { planItinerary, type PlanRequest } from "../actions/itinerary";
import type { RegionWindow } from "../engine/types";

/**
 * 창의 성격 판정 (#101)
 *
 * "서울역 권역 · 약 54분 활용 가능"은 사실이 아니다. 그 54분은 공항철도 도착과 KTX
 * 출발 사이의 환승 대기이고, 접근시간 왕복과 엔진 버퍼 때문에 아무것도 배치되지 않는다.
 * 쓸 수 없는 시간을 활용 가능이라고 부르는 것이 오해의 원인이었다.
 */

const window = (
  startBoundary: RegionWindow["startBoundary"],
  endBoundary: RegionWindow["endBoundary"],
  startAt = "2026-08-12T04:01:00.000Z",
  endAt = "2026-08-12T04:55:00.000Z",
) => ({ startAt, endAt, startBoundary, endBoundary });

describe("환승 대기와 체류 구분 (#101)", () => {
  it("열차 도착에서 열차 출발까지 방문이 없으면 환승 대기다", () => {
    expect(classifyRegionWindow(window("TRAIN_ARRIVAL", "TRAIN_DEPARTURE"), []))
      .toBe("transfer_wait");
  });

  it("공항 진입편 도착도 같은 규칙이다 — 공항철도든 검증 공항버스든", () => {
    expect(classifyRegionWindow(window("GATEWAY_ARRIVAL", "TRAIN_DEPARTURE"), []))
      .toBe("transfer_wait");
  });

  it("열차 사이라도 방문이 배치돼 있으면 쓰고 있는 시간이다", () => {
    const kind = classifyRegionWindow(window("TRAIN_ARRIVAL", "TRAIN_DEPARTURE"), [
      { arriveAt: "2026-08-12T04:10:00.000Z", departAt: "2026-08-12T04:40:00.000Z" },
    ]);
    expect(kind).toBe("stay");
  });

  it("창 밖의 방문은 세지 않는다", () => {
    const kind = classifyRegionWindow(window("TRAIN_ARRIVAL", "TRAIN_DEPARTURE"), [
      { arriveAt: "2026-08-12T06:00:00.000Z", departAt: "2026-08-12T07:00:00.000Z" },
    ]);
    expect(kind).toBe("transfer_wait");
  });

  it("일부만 걸쳐도 방문이 있는 것으로 본다", () => {
    const kind = classifyRegionWindow(window("TRAIN_ARRIVAL", "TRAIN_DEPARTURE"), [
      { arriveAt: "2026-08-12T04:40:00.000Z", departAt: "2026-08-12T05:30:00.000Z" },
    ]);
    expect(kind).toBe("stay");
  });

  it("여행 시작·마감 경계의 빈 창은 환승이 아니다", () => {
    expect(classifyRegionWindow(window("AIRPORT_READY", "TRAIN_DEPARTURE"), []))
      .toBe("stay");
    expect(classifyRegionWindow(window("TRAIN_ARRIVAL", "AIRPORT_DEADLINE"), []))
      .toBe("stay");
  });

  it("자정 분할로 이어지는 창도 환승으로 치지 않는다", () => {
    expect(classifyRegionWindow(window("DAY_START", "TRAIN_DEPARTURE"), []))
      .toBe("stay");
    expect(classifyRegionWindow(window("TRAIN_ARRIVAL", "DAY_END"), []))
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

    const classified = res.result.days.flatMap((day) =>
      day.regionWindows.map((w) => ({
        stationId: w.stationId,
        minutes: w.availableMinutes,
        kind: classifyRegionWindow(w, day.items),
      })));

    // 이 시드에는 환승 대기가 실제로 존재한다 — 분기가 죽은 코드가 아니다
    const waits = classified.filter((w) => w.kind === "transfer_wait");
    expect(waits.length).toBeGreaterThan(0);
    expect(waits.some((w) => w.stationId === "station-seoul")).toBe(true);

    // 환승 대기로 판정된 창에는 방문이 하나도 없어야 한다
    for (const day of res.result.days) {
      for (const w of day.regionWindows) {
        if (classifyRegionWindow(w, day.items) !== "transfer_wait") continue;
        const overlapping = day.items.filter(
          (item) => Date.parse(item.arriveAt) < Date.parse(w.endAt)
            && Date.parse(item.departAt) > Date.parse(w.startAt),
        );
        expect(overlapping, `${day.date} ${w.stationId}`).toEqual([]);
      }
    }
  });

  it("방문이 배치된 권역 창은 환승으로 오분류되지 않는다", async () => {
    const res = await planItinerary(base);
    if (!res.ok || res.result.status !== "planned") return;
    for (const day of res.result.days) {
      for (const item of day.items) {
        const holding = day.regionWindows.filter(
          (w) => Date.parse(item.arriveAt) < Date.parse(w.endAt)
            && Date.parse(item.departAt) > Date.parse(w.startAt),
        );
        for (const w of holding) {
          expect(classifyRegionWindow(w, day.items), `${day.date} ${w.stationId}`).toBe("stay");
        }
      }
    }
  });
});
