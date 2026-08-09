import { describe, expect, it } from "vitest";
import { loadRailGeometry, RailGeometrySnapshot } from "../rail-geometry";
import { loadStationCoordinates } from "../station-coordinates";
import { loadRepositories } from "../repositories/json";
import { project } from "../korea-map-projection";
import { railRouteSegments, routePairKey } from "../map-route";

/**
 * 실제 철로 선형 스냅샷 계약 (#14 v0.6 지도 4단계)
 *
 * 지키는 것 세 가지:
 *   1. 선로 위 역 앵커가 실제 역 좌표와 붙어 있다 — 어긋나면 선이 역을 비껴간다.
 *   2. 열차 스냅샷의 모든 OD가 축 안에 있다 — 조용히 폴백으로 떨어지는 구간이 없어야 한다.
 *   3. 축이 없어도 선은 남는다 — 데이터가 빠졌다고 화면에서 동선이 사라지면 안 된다.
 */
describe("철로 선형 스냅샷", () => {
  const snapshot = loadRailGeometry();
  const stationById = new Map(
    loadStationCoordinates().stations.map((station) => [station.stationId, station]),
  );

  it("축 3개를 싣고, 앵커가 가리키는 역은 모두 시드에 있다", () => {
    expect(snapshot.lines.map((line) => line.id)).toEqual(["gangneung", "gyeongbu", "arex"]);
    const seedIds = new Set(loadRepositories().stations.map((station) => station.id));
    for (const line of snapshot.lines) {
      for (const anchor of line.stations) {
        expect(seedIds.has(anchor.stationId), `${line.id}/${anchor.stationId}`).toBe(true);
      }
    }
  });

  it("역 앵커가 실제 역 좌표에 붙어 있다", () => {
    // 이 좌표계에서 1px ≈ 2.55km(위도 37.5° 기준). 0.3px ≈ 770m — 실측 최대는 서울역 0.18px다.
    // 선로 위 최근접점과 역 중심의 차이라 0은 될 수 없고, 화면 축척에서 눈에 띄지도 않는다.
    const TOLERANCE_PX = 0.3;
    for (const line of snapshot.lines) {
      for (const anchor of line.stations) {
        const station = stationById.get(anchor.stationId);
        expect(station, `${line.id}/${anchor.stationId} 좌표`).toBeDefined();
        const at = project(station!.latitude, station!.longitude);
        const [x, y] = line.points[anchor.index];
        const distance = Math.hypot(at.x - x, at.y - y);
        expect(distance, `${line.id}/${anchor.stationId}`).toBeLessThan(TOLERANCE_PX);
      }
    }
  });

  it("열차 스냅샷의 모든 OD를 축이 덮는다", () => {
    const uncovered = loadRepositories()
      .trainLegs.map((leg) => [leg.fromStationId, leg.toStationId] as const)
      .filter(([from, to]) => {
        const segments = railRouteSegments([from, to], snapshot.lines);
        return !segments.some((segment) => segment.kind === "rail");
      });
    expect([...new Set(uncovered.map(([from, to]) => `${from}→${to}`))]).toEqual([]);
  });

  it("선형이 지도 표시 영역 안에 들어온다", () => {
    // 투영 상수가 어긋나면 선로만 화면 밖으로 밀려난다 — 역 점과 따로 노는 상태를 여기서 잡는다
    for (const line of snapshot.lines) {
      for (const [x, y] of line.points) {
        expect(x, `${line.id} x`).toBeGreaterThan(116);
        expect(x, `${line.id} x`).toBeLessThan(116 + 194);
        expect(y, `${line.id} y`).toBeGreaterThan(212);
        expect(y, `${line.id} y`).toBeLessThan(212 + 256);
      }
    }
  });

  it("앵커가 폴리라인 밖을 가리키면 스키마가 거부한다", () => {
    const line = snapshot.lines[0];
    const corrupt = {
      ...snapshot,
      lines: [
        {
          ...line,
          stations: [line.stations[0], { stationId: "station-x", index: line.points.length }],
        },
      ],
    };
    expect(RailGeometrySnapshot.safeParse(corrupt).success).toBe(false);
  });

  it("앵커 순서가 폴리라인 진행과 어긋나면 스키마가 거부한다", () => {
    const line = snapshot.lines[0];
    const corrupt = {
      ...snapshot,
      lines: [{ ...line, stations: [...line.stations].reverse() }],
    };
    expect(RailGeometrySnapshot.safeParse(corrupt).success).toBe(false);
  });
});

describe("동선 구간 나누기", () => {
  const lines = loadRailGeometry().lines;

  it("실선형이 있는 구간은 선로 꼭짓점을 그대로 잇는다", () => {
    const segments = railRouteSegments(["station-seoul", "station-manjong"], lines);
    expect(segments).toHaveLength(1);
    expect(segments[0].kind).toBe("rail");
    if (segments[0].kind !== "rail") return;
    // 역만 잇던 선(2점)보다 훨씬 촘촘해야 "선로가 어디로 휘는지"가 보인다
    expect(segments[0].points.length).toBeGreaterThan(20);
    expect(segments[0].lineId).toBe("gangneung");
  });

  it("반대 방향은 같은 선을 뒤집어 그린다", () => {
    const forward = railRouteSegments(["station-seoul", "station-manjong"], lines)[0];
    const backward = railRouteSegments(["station-manjong", "station-seoul"], lines)[0];
    if (forward.kind !== "rail" || backward.kind !== "rail") throw new Error("rail 구간이 아님");
    expect(backward.points).toEqual([...forward.points].reverse());
  });

  it("축을 못 찾은 구간은 기존 곡선으로 남는다 — 선이 사라지지 않는다", () => {
    const stationIds = ["station-jeonju", "station-namwon"];
    const segments = railRouteSegments(stationIds, lines);
    expect(segments).toEqual([{ kind: "curve", stationIds }]);
  });

  it("축이 하나도 안 걸리면 시퀀스 전체가 곡선 하나 — 지금 화면과 같다", () => {
    const stationIds = ["station-jeonju", "station-namwon", "station-yeosu"];
    expect(railRouteSegments(stationIds, [])).toEqual([{ kind: "curve", stationIds }]);
  });

  it("선로 구간과 폴백 구간이 섞여도 순서를 지킨다", () => {
    const segments = railRouteSegments(
      ["station-seoul", "station-manjong", "station-jeonju", "station-busan"],
      lines,
    );
    expect(segments.map((segment) => segment.kind)).toEqual(["rail", "curve"]);
    const fallback = segments[1];
    if (fallback.kind !== "curve") throw new Error("curve 구간이 아님");
    // 폴백 곡선은 선로 구간이 끝난 역에서 이어져야 선이 끊기지 않는다
    expect(fallback.stationIds).toEqual(["station-manjong", "station-jeonju", "station-busan"]);
  });

  it("도로 수단 구간은 축에 있어도 선로로 그리지 않는다", () => {
    const stationIds = ["station-seoul", "station-incheon-airport-t1"];
    expect(railRouteSegments(stationIds, lines)[0].kind).toBe("rail");
    const roadPairKeys = new Set([routePairKey(stationIds[1], stationIds[0])]);
    expect(railRouteSegments(stationIds, lines, roadPairKeys)).toEqual([
      { kind: "curve", stationIds },
    ]);
  });

  it("역이 하나거나 없으면 선을 만들지 않는다", () => {
    expect(railRouteSegments([], lines)).toEqual([]);
    expect(railRouteSegments(["station-seoul"], lines)).toEqual([
      { kind: "curve", stationIds: ["station-seoul"] },
    ]);
  });
});
