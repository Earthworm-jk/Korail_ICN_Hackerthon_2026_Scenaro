import { describe, expect, it } from "vitest";
import { labelsOverlap, layoutLabels, type LabelSeed } from "../map-labels";
import { project, VIEW_BOX } from "../korea-map-projection";
import { boundsOf, focusOn, MAX_SCALE, scaleOf, type Viewport } from "../map-viewport";
import { loadStationCoordinates } from "../station-coordinates";
import { loadRepositories } from "../repositories/json";

/**
 * 지도 라벨 배치 회귀 (#14 v0.6 지도)
 *
 * 라벨 겹침은 화면을 눈으로 봐야만 보이는 결함이라 회귀가 쉽게 새어 나간다.
 * 실좌표로 배치를 돌려 겹침 0건을 고정한다. 시드에 역·촬영지가 늘어나면 여기서 먼저 깨진다.
 *
 * 지도가 확대·축소·팬을 받게 되면서 이 계약이 배율 1에서만 참이 될 위험이 생겼다. 아래 첫
 * 묶음은 배율 1(기본 창)을 그대로 고정하고, 마지막 묶음이 확대한 창에서도 같은 계약을 건다.
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

  it("긴 영문 역명은 최대 두 줄 안에서 원문과 지도 경계를 보존한다", () => {
    // 라벨 기준 크기에 따라 한 줄 또는 두 줄이 될 수 있다. 중요한 계약은 원문 보존과 경계다.
    const airport = stations.find((s) => s.stationId === "station-incheon-airport-t1")!;
    const at = project(airport.latitude, airport.longitude);
    const text = nameById.get(airport.stationId)!.en;
    expect(text.length).toBeGreaterThan(25);

    const [label] = layoutLabels([{ key: airport.stationId, text, x: at.x, y: at.y }]);
    expect(label.lines.length).toBeGreaterThanOrEqual(1);
    expect(label.lines.length).toBeLessThanOrEqual(2);
    expect(label.lines.join(" ")).toBe(text); // 문구를 자르거나 바꾸지 않는다
    expect(label.right - label.left).toBeLessThanOrEqual(WIDTH);
  });

  it("줄바꿈은 원문을 보존한다 — 한글은 공백이 없어도 나뉜다", () => {
    const long = "진부오대산역진부오대산역진부오대산역";
    const [label] = layoutLabels([{ key: "x", text: long, x: 150, y: 300 }]);
    expect(label.lines.join("")).toBe(long);
  });

  /**
   * 확대한 창 — 컴포넌트와 같은 절차를 따른다: 창 안의 지점만 시드로 쓰고, 창과 배율을
   * 배치에 넘긴다. 한쪽이라도 빠뜨리면(창만 옮기고 배율을 안 넘기는 식) 여기서 걸린다.
   */
  function layoutInView(view: Viewport, locale: "ko" | "en") {
    const bounds = boundsOf(view);
    const seeds: LabelSeed[] = stations
      .map((station) => {
        const at = project(station.latitude, station.longitude);
        return { key: station.stationId, text: nameById.get(station.stationId)![locale], ...at };
      })
      .filter(
        (seed) =>
          seed.x >= bounds.left &&
          seed.x <= bounds.right &&
          seed.y >= bounds.top &&
          seed.y <= bounds.bottom,
      );
    return { seeds, labels: layoutLabels(seeds, { bounds, scale: scaleOf(view) }) };
  }

  // 배율은 버튼 한 칸(1.5)·대표 지점(3)·상한(5)을 모두 지난다
  const ZOOM_CASES = [1.5, 2, 3, MAX_SCALE];

  it.each(ZOOM_CASES)("확대한 창에서도 라벨이 겹치지 않는다 — 배율 %s (ko)", (scale) => {
    for (const station of stations) {
      const view = focusOn(project(station.latitude, station.longitude), scale);
      const { seeds, labels } = layoutInView(view, "ko");
      expect(labels.length, `${station.stationId} 배율 ${scale}`).toBe(seeds.length);
      expectNoOverlap(labels);
    }
  });

  it.each(ZOOM_CASES)("확대한 창에서도 라벨이 창을 벗어나지 않는다 — 배율 %s (en)", (scale) => {
    for (const station of stations) {
      const view = focusOn(project(station.latitude, station.longitude), scale);
      const bounds = boundsOf(view);
      // 경계에 딱 붙인 라벨은 부동소수 오차만큼 넘칠 수 있다 — 표시단위 1e-6은 화면에서 0이다
      const slack = 1e-6;
      for (const label of layoutInView(view, "en").labels) {
        expect(label.left, `${label.text} left`).toBeGreaterThanOrEqual(bounds.left - slack);
        expect(label.right, `${label.text} right`).toBeLessThanOrEqual(bounds.right + slack);
        expect(label.top, `${label.text} top`).toBeGreaterThanOrEqual(bounds.top - slack);
        expect(label.bottom, `${label.text} bottom`).toBeLessThanOrEqual(bounds.bottom + slack);
      }
    }
  });

  it.each([1, ...ZOOM_CASES])("알약 배경까지 창 안에 들어온다 — 배율 %s (en)", (scale) => {
    // 컴포넌트가 글자 좌우로 3.5(배율로 나눈 값)만큼 배경을 더 그린다 — 배치가 그 몫을 알아야 한다
    const pill = 3.5 / scale;
    const slack = 1e-6;
    for (const station of stations) {
      const view = focusOn(project(station.latitude, station.longitude), scale);
      const bounds = boundsOf(view);
      for (const label of layoutInView(view, "en").labels) {
        expect(label.left - pill, `${label.text} 배경 왼쪽`).toBeGreaterThanOrEqual(bounds.left - slack);
        expect(label.right + pill, `${label.text} 배경 오른쪽`).toBeLessThanOrEqual(bounds.right + slack);
      }
    }
  });

  /**
   * 테마체험 권역 이름을 지도에 얹을 수 있는가 (#27 필터 완성).
   *
   * #83은 권역명을 적지 않기로 했다 — 고정 창에서는 역 라벨과 겹쳤기 때문이다. 창·배율마다
   * 배치를 다시 계산하는 지금은 같은 배치기에 태우면 겹치지 않는다. 그 근거를 여기에 고정한다.
   * 실제 좌표는 data/theme-zones.json 의 검수된 두 권역이다.
   */
  const THEME_ZONES = [
    { name: "정동·덕수궁 대한제국 근대문화 권역", latitude: 37.565055, longitude: 126.976575 },
    { name: "북촌 한옥·전통문화 권역", latitude: 37.578999, longitude: 126.98669 },
  ];

  it.each([1, ...ZOOM_CASES])("권역 이름을 역 라벨과 함께 올려도 겹치지 않는다 — 배율 %s", (scale) => {
    for (const zone of THEME_ZONES) {
      const at = project(zone.latitude, zone.longitude);
      const view = focusOn(at, scale);
      const bounds = boundsOf(view);
      // 컴포넌트와 같은 시드 — 권역 표식은 반지름 10짜리 고리다
      const seeds = [
        ...layoutInView(view, "ko").seeds,
        { key: "overlay:theme", text: zone.name, x: at.x, y: at.y, radius: 10 },
      ];
      const placed = layoutLabels(seeds, { bounds, scale: scaleOf(view) });

      expect(placed.length, `${zone.name} 배율 ${scale}`).toBe(seeds.length);
      expectNoOverlap(placed);
      // 이름을 자르거나 바꾸지 않는다 — 줄바꿈이 먹은 공백만 빼고 그대로다
      const zoneLabel = placed.find((label) => label.key === "overlay:theme")!;
      const strip = (text: string) => text.replace(/\s/g, "");
      expect(strip(zoneLabel.lines.join(""))).toBe(strip(zone.name));
    }
  });

  it("확대해도 라벨의 화면상 크기는 그대로다 — 배율만큼 표시 좌표가 작아진다", () => {
    const at = project(37.5546, 126.9707); // 서울역
    const seed: LabelSeed = { key: "station-seoul", text: "서울역", x: at.x, y: at.y };

    const [base] = layoutLabels([seed]);
    for (const scale of ZOOM_CASES) {
      const view = focusOn(at, scale);
      const [zoomed] = layoutLabels([seed], { bounds: boundsOf(view), scale });
      // 표시 좌표 폭 × 배율 = 배율 1의 폭 → 화면에서는 같은 크기
      expect((zoomed.right - zoomed.left) * scale).toBeCloseTo(base.right - base.left, 6);
      expect(zoomed.fontSize * scale).toBeCloseTo(base.fontSize, 9);
    }
  });

  it("인자를 주지 않으면 배율 1·기본 창 그대로다 — 기존 호출이 달라지지 않는다", () => {
    const at = project(37.5546, 126.9707);
    const seeds: LabelSeed[] = [{ key: "station-seoul", text: "서울역", x: at.x, y: at.y }];
    expect(layoutLabels(seeds)).toEqual(layoutLabels(seeds, { scale: 1 }));
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
