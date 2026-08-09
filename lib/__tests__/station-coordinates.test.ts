import { describe, expect, it } from "vitest";
import { loadStationCoordinates, StationCoordinatesSnapshot } from "../station-coordinates";
import { loadRepositories } from "../repositories/json";
import { project } from "../korea-map-projection";
import { VIEW_BOX } from "../korea-map-projection";

/**
 * 역 좌표 스냅샷 계약 (#14 v0.6 지도)
 *
 * 지도가 조용히 역을 빠뜨리거나 결측 좌표를 싣는 것을 막는다. 원천(국가철도공단 15067652)은
 * 215행 중 12행이 0,0으로 내려오므로 "받아온 값"을 믿지 않고 여기서 다시 고정한다.
 */
describe("역 좌표 스냅샷", () => {
  const snapshot = loadStationCoordinates();

  it("시드의 모든 역에 좌표가 있고, 시드에 없는 역은 싣지 않는다", () => {
    const seedIds = loadRepositories().stations.map((s) => s.id).sort();
    const snapshotIds = snapshot.stations.map((s) => s.stationId).sort();
    expect(snapshotIds).toEqual(seedIds);
  });

  it("좌표가 대한민국 범위 안이다 — 0,0 결측이 실리지 않는다", () => {
    for (const station of snapshot.stations) {
      expect(station.latitude, `${station.stationId} lat`).toBeGreaterThan(33);
      expect(station.latitude, `${station.stationId} lat`).toBeLessThan(39);
      expect(station.longitude, `${station.stationId} lon`).toBeGreaterThan(124);
      expect(station.longitude, `${station.stationId} lon`).toBeLessThan(132);
    }
  });

  it("보조 출처 좌표는 출처 URL과 확인일을 남긴다", () => {
    const fallbacks = snapshot.stations.filter((s) => s.source === "fallback");
    // 원천 밖 공항철도역 + 원천 0,0 결측역 — 줄어들면 좋지만 조용히 늘어나면 안 된다
    expect(fallbacks.map((s) => s.stationId).sort()).toEqual([
      "station-incheon-airport-t1",
      "station-jinbu",
    ]);
    for (const station of fallbacks) {
      expect(station.sourceRef, station.stationId).toMatch(/^https:\/\//);
      expect(station.verifiedAt, station.stationId).toBeTruthy();
      expect(station.sourceNote, station.stationId).toBeTruthy();
    }
  });

  it("모든 역이 지도 표시 영역 안에 투영된다", () => {
    const [minX, minY, width, height] = VIEW_BOX.split(" ").map(Number);
    for (const station of snapshot.stations) {
      const { x, y } = project(station.latitude, station.longitude);
      expect(x, `${station.stationId} x`).toBeGreaterThanOrEqual(minX);
      expect(x, `${station.stationId} x`).toBeLessThanOrEqual(minX + width);
      expect(y, `${station.stationId} y`).toBeGreaterThanOrEqual(minY);
      expect(y, `${station.stationId} y`).toBeLessThanOrEqual(minY + height);
    }
  });

  it("0,0 좌표는 스키마가 거부한다", () => {
    const corrupt = {
      ...snapshot,
      stations: [{ ...snapshot.stations[0], latitude: 0, longitude: 0 }],
    };
    expect(StationCoordinatesSnapshot.safeParse(corrupt).success).toBe(false);
  });

  it("보조 출처인데 출처 URL이 없으면 스키마가 거부한다", () => {
    const corrupt = {
      ...snapshot,
      stations: [
        {
          stationId: "station-seoul",
          sourceName: "서울역",
          latitude: 37.5,
          longitude: 127,
          source: "fallback",
        },
      ],
    };
    expect(StationCoordinatesSnapshot.safeParse(corrupt).success).toBe(false);
  });
});
