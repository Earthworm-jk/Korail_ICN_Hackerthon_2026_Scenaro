import { describe, expect, it } from "vitest";
import {
  catmullRomPath,
  groundKmPerUnit,
  latitudeAt,
  project,
  VIEW_BOX,
} from "../korea-map-projection";
import { loadRepositories } from "../repositories/json";

/**
 * v0.6 시안 지도 투영 회귀 (#14 — 클릭형 HTML이 계약 기준)
 *
 * 시안 정적 SVG는 d3로 생성된 산출물이고, 우리는 같은 변환을 d3 없이 복원해 쓴다.
 * "비슷해 보인다"가 아니라 시안이 실제로 찍어 둔 좌표를 재현하는지로 고정한다.
 */

/** 시안 정적 SVG에 박혀 있는 기준점 — 시안 주석의 `locations` 좌표와 렌더된 cx·cy */
const WIREFRAME_REFERENCE = [
  { name: "인천공항", longitude: 126.4417093, latitude: 37.4634593, cx: 142.58, cy: 274.59 },
  { name: "서울역", longitude: 126.9725721, latitude: 37.5528527, cx: 160.95, cy: 270.68 },
  { name: "강릉역", longitude: 128.8993979, latitude: 37.76452, cx: 227.65, cy: 261.43 },
] as const;

describe("한반도 지도 투영", () => {
  it("시안 기준점 3개를 0.01px 이내로 재현한다", () => {
    // 시안 SVG의 cx·cy가 소수점 둘째 자리로 반올림돼 있어 0.01px가 비교 가능한 최대 정밀도다
    for (const point of WIREFRAME_REFERENCE) {
      const { x, y } = project(point.latitude, point.longitude);
      expect(Math.abs(x - point.cx), `${point.name} x 잔차`).toBeLessThan(0.01);
      expect(Math.abs(y - point.cy), `${point.name} y 잔차`).toBeLessThan(0.01);
    }
  });

  /**
   * 거리 환산 (#27 지도 확대 범위).
   *
   * 화면에 "500 m"라고 적는 순간 그 숫자는 사용자가 위치를 판단하는 근거가 된다. 눈금이
   * 실제 거리와 맞는지를 투영 자체로 확인한다.
   */
  describe("표시단위 → 실거리", () => {
    it("y에서 위도를 되돌린다 — project의 역함수", () => {
      for (const point of WIREFRAME_REFERENCE) {
        const { y } = project(point.latitude, point.longitude);
        expect(latitudeAt(y)).toBeCloseTo(point.latitude, 9);
      }
    });

    it("서울역 위도에서 1단위는 약 2.55km다", () => {
      const seoul = project(37.5528527, 126.9725721);
      expect(groundKmPerUnit(seoul.y)).toBeCloseTo(2.548, 2);
    });

    it("실제 두 지점 사이 거리를 하버사인과 1% 안에서 맞춘다", () => {
      // 서울역 - 강릉역. 메르카토르는 동서 방향에서 국소적으로 등각이므로 짧은 구간에서 맞아야 한다
      const a = { latitude: 37.5528527, longitude: 126.9725721 };
      const b = { latitude: 37.76452, longitude: 128.8993979 };
      const pa = project(a.latitude, a.longitude);
      const pb = project(b.latitude, b.longitude);

      const R = 6371.0088;
      const rad = (d: number) => (d * Math.PI) / 180;
      const dLat = rad(b.latitude - a.latitude);
      const dLon = rad(b.longitude - a.longitude);
      const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
      const haversineKm = 2 * R * Math.asin(Math.sqrt(h));

      const units = Math.hypot(pb.x - pa.x, pb.y - pa.y);
      const estimated = units * groundKmPerUnit((pa.y + pb.y) / 2);
      expect(Math.abs(estimated - haversineKm) / haversineKm).toBeLessThan(0.01);
    });

    it("고위도로 갈수록 같은 1단위가 짧은 거리다 — 메르카토르 늘어남", () => {
      const jeju = project(33.5, 126.5);
      const goseong = project(38.3, 128.4);
      expect(groundKmPerUnit(goseong.y)).toBeLessThan(groundKmPerUnit(jeju.y));
    });
  });

  it("동선 곡선이 시안 정적 SVG의 path 문자열과 일치한다", () => {
    // 곡선 이식만 따로 고정한다 — 투영 잔차가 섞이지 않도록 시안 SVG의 좌표 원문을 그대로 넣는다.
    // 시안 route 지도의 동선: 공항 → 서울 → 강릉 → 서울 → 공항
    const [airport, seoul, gangneung] = WIREFRAME_REFERENCE.map((p) => ({ x: p.cx, y: p.cy }));
    const path = catmullRomPath([airport, seoul, gangneung, seoul, airport]);
    const rounded = path.replace(/-?\d+\.?\d*/g, (n) => String(Math.round(Number(n) * 1000) / 1000));
    expect(rounded).toBe(
      "M142.58,274.59C142.58,274.59,152.524,272.139,160.95,270.68" +
        "C175.918,268.088,227.65,261.43,227.65,261.43" +
        "C227.65,261.43,175.918,268.088,160.95,270.68" +
        "C152.524,272.139,142.58,274.59,142.58,274.59",
    );
  });

  it("점이 1개 이하면 곡선을 만들지 않는다", () => {
    expect(catmullRomPath([])).toBe("");
    expect(catmullRomPath([{ x: 1, y: 2 }])).toBe("M1,2");
  });

  it("좌표가 있는 시드 촬영지가 모두 표시 영역 안에 들어온다", () => {
    // crop 밖으로 나가면 사용자에게는 '누락'으로 보인다 — 시드가 늘어날 때 깨지면 알아야 한다
    const [minX, minY, width, height] = VIEW_BOX.split(" ").map(Number);
    const placed = loadRepositories().places.filter((p) => p.latitude !== undefined);
    expect(placed.length).toBeGreaterThan(0);
    for (const place of placed) {
      const { x, y } = project(place.latitude!, place.longitude!);
      expect(x, `${place.id} x`).toBeGreaterThanOrEqual(minX);
      expect(x, `${place.id} x`).toBeLessThanOrEqual(minX + width);
      expect(y, `${place.id} y`).toBeGreaterThanOrEqual(minY);
      expect(y, `${place.id} y`).toBeLessThanOrEqual(minY + height);
    }
  });

});

describe("생성된 해안선", () => {
  it("표시 영역을 덮는 좌표계로 구워져 있다", async () => {
    const { KOREA_OUTLINE_PATH } = await import("../korea-outline");
    const numbers = KOREA_OUTLINE_PATH.match(/-?\d+\.?\d*/g)!.map(Number);
    const xs = numbers.filter((_, i) => i % 2 === 0);
    const ys = numbers.filter((_, i) => i % 2 === 1);
    const [minX, minY, width, height] = VIEW_BOX.split(" ").map(Number);
    // 남한 해안선이 표시 창을 가로·세로로 채워야 한다 — 투영 상수가 어긋나면 여기서 깨진다
    expect(Math.min(...xs)).toBeLessThan(minX + width * 0.35);
    expect(Math.max(...xs)).toBeGreaterThan(minX + width * 0.6);
    expect(Math.min(...ys)).toBeLessThan(minY + height * 0.3);
    expect(Math.max(...ys)).toBeGreaterThan(minY + height * 0.8);
  });

  it("시안의 19각형보다 해상도가 높다", async () => {
    const { KOREA_OUTLINE_PATH } = await import("../korea-outline");
    const vertices = (KOREA_OUTLINE_PATH.match(/[ML]/g) ?? []).length;
    expect(vertices).toBeGreaterThan(200);
  });
});
