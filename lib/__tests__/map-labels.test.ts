import { describe, expect, it } from "vitest";
import { labelsOverlap, layoutLabels, type LabelSeed } from "../map-labels";
import { project, VIEW_BOX } from "../korea-map-projection";
import { loadStationCoordinates } from "../station-coordinates";
import { loadRepositories } from "../repositories/json";

/**
 * 지도 라벨 배치 회귀 (#14 v0.6 지도)
 *
 * 라벨 겹침은 화면을 눈으로 봐야만 보이는 결함이라 회귀가 쉽게 새어 나간다.
 * 실좌표로 배치를 돌려 겹침 0건을 고정한다. 시드에 역·촬영지가 늘어나면 여기서 먼저 깨진다.
 */

const [MIN_X, MIN_Y, WIDTH, HEIGHT] = VIEW_BOX.split(" ").map(Number);

function expectNoOverlap(labels: ReturnType<typeof layoutLabels>) {
  for (let i = 0; i < labels.length; i += 1) {
    for (let j = i + 1; j < labels.length; j += 1) {
      expect(
        labelsOverlap(labels[i], labels[j]),
        `${labels[i].text} <-> ${labels[j].text}`,
      ).toBe(false);
    }
  }
}

describe("지도 라벨 배치", () => {
  const stations = loadStationCoordinates().stations;
  const seedStations = loadRepositories().stations;
  const nameById = new Map(seedStations.map((s) => [s.id, s.name]));

  it("전 역을 한 지도에 올려도 라벨이 겹치지 않는다 (ko)", () => {
    const seeds: LabelSeed[] = stations.map((station) => {
      const at = project(station.latitude, station.longitude);
      return { key: station.stationId, text: nameById.get(station.stationId)!.ko, x: at.x, y: at.y };
    });
    const labels = layoutLabels(seeds);
    expect(labels).toHaveLength(seeds.length); // 라벨을 빠뜨리지 않는다
    expectNoOverlap(labels);
  });

  it("전 역을 한 지도에 올려도 라벨이 겹치지 않는다 (en)", () => {
    const seeds: LabelSeed[] = stations.map((station) => {
      const at = project(station.latitude, station.longitude);
      return { key: station.stationId, text: nameById.get(station.stationId)!.en, x: at.x, y: at.y };
    });
    const labels = layoutLabels(seeds);
    expect(labels).toHaveLength(seeds.length);
    expectNoOverlap(labels);
  });

  it("촬영지 권역 라벨도 겹치지 않는다 — 강원 권역이 가장 빽빽하다", () => {
    const places = loadRepositories().places.filter((p) => p.latitude !== undefined);
    const byStation = new Map<string, { x: number; y: number; n: number }>();
    for (const place of places) {
      const at = project(place.latitude!, place.longitude!);
      const acc = byStation.get(place.nearestStationId) ?? { x: 0, y: 0, n: 0 };
      byStation.set(place.nearestStationId, { x: acc.x + at.x, y: acc.y + at.y, n: acc.n + 1 });
    }
    const seeds: LabelSeed[] = [...byStation].map(([stationId, acc]) => ({
      key: stationId,
      text: nameById.get(stationId)!.ko,
      x: acc.x / acc.n,
      y: acc.y / acc.n,
    }));
    expectNoOverlap(layoutLabels(seeds));
  });

  it.each(["ko", "en"] as const)("라벨이 표시 영역을 벗어나지 않는다 (%s)", (locale) => {
    const seeds: LabelSeed[] = stations.map((station) => {
      const at = project(station.latitude, station.longitude);
      return {
        key: station.stationId,
        text: nameById.get(station.stationId)![locale],
        x: at.x,
        y: at.y,
      };
    });
    for (const label of layoutLabels(seeds)) {
      expect(label.left, `${label.text} left`).toBeGreaterThanOrEqual(MIN_X);
      expect(label.right, `${label.text} right`).toBeLessThanOrEqual(MIN_X + WIDTH);
      expect(label.top, `${label.text} top`).toBeGreaterThanOrEqual(MIN_Y);
      expect(label.bottom, `${label.text} bottom`).toBeLessThanOrEqual(MIN_Y + HEIGHT);
    }
  });

  it("한 줄로 안 들어가는 긴 영문 역명은 두 줄로 나눈다", () => {
    // "Incheon Airport Terminal 1 Station" 33자 — 어떤 크기로도 한 줄로는 지도에 안 들어간다
    const airport = stations.find((s) => s.stationId === "station-incheon-airport-t1")!;
    const at = project(airport.latitude, airport.longitude);
    const text = nameById.get(airport.stationId)!.en;
    expect(text.length).toBeGreaterThan(25);

    const [label] = layoutLabels([{ key: airport.stationId, text, x: at.x, y: at.y }]);
    expect(label.lines.length).toBe(2);
    expect(label.lines.join(" ")).toBe(text); // 문구를 자르거나 바꾸지 않는다
    expect(label.right - label.left).toBeLessThanOrEqual(WIDTH);
  });

  it("줄바꿈은 원문을 보존한다 — 한글은 공백이 없어도 나뉜다", () => {
    const long = "진부오대산역진부오대산역진부오대산역";
    const [label] = layoutLabels([{ key: "x", text: long, x: 150, y: 300 }]);
    expect(label.lines.join("")).toBe(long);
  });

  it.each(["ko", "en"] as const)("라벨은 자기 지점에서 멀리 떠나지 않는다 (%s)", (locale) => {
    const seeds: LabelSeed[] = stations.map((station) => {
      const at = project(station.latitude, station.longitude);
      return {
        key: station.stationId,
        text: nameById.get(station.stationId)![locale],
        x: at.x,
        y: at.y,
      };
    });
    for (const label of layoutLabels(seeds)) {
      // 65는 후보 목록의 최대 이동량 — 이보다 멀면 어느 점의 이름인지 알 수 없다
      expect(Math.abs(label.y - label.from.y), label.text).toBeLessThanOrEqual(65);
    }
  });
});
