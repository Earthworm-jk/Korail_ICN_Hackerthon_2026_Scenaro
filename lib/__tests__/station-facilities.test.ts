import { describe, expect, it } from "vitest";
import { loadStationFacilities } from "../station-facilities";
import stationsSeed from "../../data/stations.json";

// #24 A5 — 편의시설 스냅샷은 시드 역만 참조해야 하고(무결성 #20 원칙),
// 데모 핵심 역(서울·강릉)이 빠지면 실행 지원 화면이 비므로 커버리지를 고정한다

describe("station-facilities 스냅샷", () => {
  const snapshot = loadStationFacilities();
  const stationIds = new Set((stationsSeed as { id: string }[]).map((s) => s.id));

  it("스키마 검증을 통과하고 역 참조가 시드에 전부 존재한다", () => {
    for (const facility of snapshot.stations) {
      expect(stationIds.has(facility.stationId), `존재하지 않는 역 참조: ${facility.stationId}`).toBe(true);
    }
  });

  it("stationId가 중복되지 않는다", () => {
    const ids = snapshot.stations.map((s) => s.stationId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("데모 핵심 역(서울·강릉)의 시설 정보를 수록한다", () => {
    const covered = new Set(snapshot.stations.map((s) => s.stationId));
    expect(covered.has("station-seoul")).toBe(true);
    expect(covered.has("station-gangneung")).toBe(true);
  });
});
