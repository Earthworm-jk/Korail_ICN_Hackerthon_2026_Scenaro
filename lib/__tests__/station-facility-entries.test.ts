import { describe, expect, it } from "vitest";
import { facilityEntries } from "../station-facility-entries";
import { loadStationFacilities } from "../station-facilities";
import type { StationFacilityT } from "../station-facilities";

// PR #93 리뷰 비차단 1 — 표시 규칙(수량 0·false·순서)을 회귀로 고정한다.
// 화면 재배치(#85)나 아이콘 교체가 표시 의미를 바꾸지 못하게 한다.

const base: StationFacilityT = {
  stationId: "station-x",
  stationCode: "0000000",
  sourceName: "테스트",
  elevatorCount: 2,
  escalatorCount: 4,
  hasToilet: true,
  hasNursingRoom: true,
  hasInfoCenter: true,
};

describe("역 편의시설 표시 항목 (#24 A5)", () => {
  it("표시 순서와 항목 구성은 수량형 2종 뒤 유무형 3종으로 고정된다", () => {
    expect(facilityEntries(base).map(({ id }) => id))
      .toEqual(["elevator", "escalator", "toilet", "nursing", "info"]);
  });

  it("수량형은 숫자를 그대로 싣고 유무형은 count가 없다", () => {
    const entries = facilityEntries(base);
    expect(entries[0]).toMatchObject({ id: "elevator", available: true, count: 2 });
    expect(entries[2]).toMatchObject({ id: "toilet", available: true, count: null });
  });

  it("수량 0은 '설치 없음'으로 취급하되 0을 숨기지 않는다", () => {
    const entries = facilityEntries({ ...base, elevatorCount: 0, escalatorCount: 0 });
    expect(entries[0]).toMatchObject({ available: false, count: 0 });
    expect(entries[1]).toMatchObject({ available: false, count: 0 });
  });

  it("false 시설도 목록에서 빠지지 않는다 — '없음'과 '정보 미확보'를 구분하기 위해", () => {
    const entries = facilityEntries({ ...base, hasInfoCenter: false });
    expect(entries).toHaveLength(5);
    expect(entries.find(({ id }) => id === "info")).toMatchObject({ available: false, count: null });
  });

  it("실스냅샷의 모든 수록 역이 5개 항목을 만든다", () => {
    const snapshot = loadStationFacilities();
    expect(snapshot.stations.length).toBeGreaterThan(0);
    for (const station of snapshot.stations) {
      const entries = facilityEntries(station);
      expect(entries, station.stationId).toHaveLength(5);
      // 수량형은 항상 숫자, 유무형은 항상 null — 화면이 두 표기를 섞지 않는다
      expect(entries.slice(0, 2).every(({ count }) => typeof count === "number")).toBe(true);
      expect(entries.slice(2).every(({ count }) => count === null)).toBe(true);
    }
  });
});
