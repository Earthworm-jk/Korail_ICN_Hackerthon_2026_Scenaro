import { describe, expect, it } from "vitest";
import {
  BASE_VIEWPORT,
  FOCUS_SCALE,
  MAX_SCALE,
  MIN_SCALE,
  ZOOM_STEP,
  boundsOf,
  clampViewport,
  contains,
  fitTo,
  focusOn,
  isZoomed,
  panBy,
  pointFromClient,
  scaleOf,
  screenUnit,
  viewBoxOf,
  zoomAt,
  zoomByStep,
} from "../map-viewport";
import { project, VIEW_BOX } from "../korea-map-projection";
import { loadStationCoordinates } from "../station-coordinates";

/**
 * 지도 확대·축소·팬 (#27 후속)
 *
 * 창 조작은 화면을 봐야만 확인되는 결함이 많다 — 경계 밖으로 새는 팬, 손끝에서 미끄러지는
 * 확대 중심, 되돌아오지 않는 초기화. 전부 순수 계산으로 떼어 두고 여기서 고정한다.
 */
describe("지도 표시 창", () => {
  const seoul = project(37.5546, 126.9707);

  it("기본 창은 VIEW_BOX와 같다 — 좌표계를 옮기지 않았다는 뜻", () => {
    const [x, y, width, height] = VIEW_BOX.split(" ").map(Number);
    expect(BASE_VIEWPORT).toEqual({ x, y, width, height });
    expect(scaleOf(BASE_VIEWPORT)).toBe(1);
    expect(isZoomed(BASE_VIEWPORT)).toBe(false);
  });

  it("배율은 상·하한 안에 머문다", () => {
    let zoomedIn = BASE_VIEWPORT;
    for (let i = 0; i < 20; i += 1) zoomedIn = zoomByStep(zoomedIn, ZOOM_STEP);
    expect(scaleOf(zoomedIn)).toBeCloseTo(MAX_SCALE, 6);

    let zoomedOut = zoomedIn;
    for (let i = 0; i < 20; i += 1) zoomedOut = zoomByStep(zoomedOut, 1 / ZOOM_STEP);
    expect(scaleOf(zoomedOut)).toBeCloseTo(MIN_SCALE, 6);
  });

  it("배율 1에서는 창이 기본 창으로 돌아온다 — 축소로도 초기화된다", () => {
    const back = zoomByStep(zoomByStep(focusOn(seoul, MAX_SCALE), 1 / MAX_SCALE), 1);
    expect(back).toEqual(BASE_VIEWPORT);
  });

  it("확대해도 기준점은 제자리에 남는다", () => {
    const view = focusOn(project(36.5, 127.8), 2); // 경계에 안 닿는 내륙 지점
    const focus = { x: view.x + view.width * 0.3, y: view.y + view.height * 0.7 };
    const zoomed = zoomAt(view, ZOOM_STEP, focus);

    expect((focus.x - zoomed.x) / zoomed.width).toBeCloseTo(0.3, 6);
    expect((focus.y - zoomed.y) / zoomed.height).toBeCloseTo(0.7, 6);
  });

  it("팬은 기본 창 밖으로 나가지 않는다", () => {
    const view = focusOn(seoul, 3);
    const far = panBy(view, 1000, 1000);
    expect(far.x).toBeGreaterThanOrEqual(BASE_VIEWPORT.x);
    expect(far.y).toBeGreaterThanOrEqual(BASE_VIEWPORT.y);

    const farOther = panBy(view, -1000, -1000);
    expect(farOther.x + farOther.width).toBeLessThanOrEqual(BASE_VIEWPORT.x + BASE_VIEWPORT.width);
    expect(farOther.y + farOther.height).toBeLessThanOrEqual(BASE_VIEWPORT.y + BASE_VIEWPORT.height);
  });

  it("팬 방향은 끄는 방향과 같다 — 오른쪽으로 끌면 창은 왼쪽으로", () => {
    const view = focusOn(project(36.5, 127.8), 3);
    expect(panBy(view, 5, 0).x).toBeCloseTo(view.x - 5, 6);
    expect(panBy(view, 0, 5).y).toBeCloseTo(view.y - 5, 6);
  });

  it("배율 1에서는 팬해도 움직이지 않는다", () => {
    expect(panBy(BASE_VIEWPORT, 30, 30)).toEqual(BASE_VIEWPORT);
  });

  it("확대 비율은 창 넓이를 바꾸지 않는다 — 가로세로 비가 유지된다", () => {
    const ratio = BASE_VIEWPORT.width / BASE_VIEWPORT.height;
    for (const scale of [1, 1.7, 3, MAX_SCALE]) {
      const view = focusOn(seoul, scale);
      expect(view.width / view.height).toBeCloseTo(ratio, 9);
    }
  });

  it("모든 역에 대해 대표 지점 확대가 그 지점을 실제로 담는다", () => {
    for (const station of loadStationCoordinates().stations) {
      const at = project(station.latitude, station.longitude);
      const view = focusOn(at, FOCUS_SCALE);
      expect(contains(view, at), station.stationId).toBe(true);
      expect(scaleOf(view), station.stationId).toBeCloseTo(FOCUS_SCALE, 6);
    }
  });

  it("한 지점에 창을 맞추면 대표 지점 확대와 같다", () => {
    expect(fitTo([seoul])).toEqual(focusOn(seoul, FOCUS_SCALE));
  });

  it("여러 지점을 맞추면 전부 창 안에 들어온다 — 여백까지 남긴다", () => {
    const points = loadStationCoordinates()
      .stations.filter((s) => ["station-seoul", "station-jinbu", "station-gangneung"].includes(s.stationId))
      .map((s) => project(s.latitude, s.longitude));
    const view = fitTo(points);

    for (const point of points) expect(contains(view, point)).toBe(true);
    // 가장자리에 붙지 않는다 — 라벨이 놓일 자리가 남아야 한다
    for (const point of points) {
      expect(point.x - view.x).toBeGreaterThan(view.width * 0.05);
      expect(view.x + view.width - point.x).toBeGreaterThan(view.width * 0.05);
    }
  });

  it("전국에 흩어진 지점을 맞춰도 축소 하한 아래로 내려가지 않는다", () => {
    const spread = loadStationCoordinates().stations.map((s) => project(s.latitude, s.longitude));
    const view = fitTo(spread);
    expect(scaleOf(view)).toBeGreaterThanOrEqual(MIN_SCALE);
    for (const point of spread) expect(contains(view, point)).toBe(true);

    // 기본 창 네 모서리처럼 더 넓게 퍼진 입력이면 전체 보기로 떨어진다
    const corners = [
      { x: BASE_VIEWPORT.x, y: BASE_VIEWPORT.y },
      { x: BASE_VIEWPORT.x + BASE_VIEWPORT.width, y: BASE_VIEWPORT.y + BASE_VIEWPORT.height },
    ];
    expect(fitTo(corners)).toEqual(BASE_VIEWPORT);
  });

  it("맞출 지점이 없으면 전체 보기다", () => {
    expect(fitTo([])).toEqual(BASE_VIEWPORT);
  });

  it("표시 요소는 배율로 나눠 화면 크기를 유지한다", () => {
    expect(screenUnit(BASE_VIEWPORT)).toBe(1);
    expect(screenUnit(focusOn(seoul, 2))).toBeCloseTo(0.5, 9);
    expect(screenUnit(focusOn(seoul, 4))).toBeCloseTo(0.25, 9);
  });

  it("망가진 창도 한계 안으로 되돌린다", () => {
    const broken = clampViewport({ x: -9999, y: 9999, width: 0.001, height: 0.001 });
    expect(scaleOf(broken)).toBeCloseTo(MAX_SCALE, 6);
    expect(broken.x).toBeGreaterThanOrEqual(BASE_VIEWPORT.x);
    expect(broken.y + broken.height).toBeLessThanOrEqual(BASE_VIEWPORT.y + BASE_VIEWPORT.height);
  });

  it("화면 좌표를 표시 좌표로 옮긴다 — 모서리가 창 모서리에 대응한다", () => {
    const view = focusOn(seoul, 2);
    const rect = { left: 20, top: 40, width: 388, height: 512 };

    expect(pointFromClient(view, rect, 20, 40)).toEqual({ x: view.x, y: view.y });
    const bottomRight = pointFromClient(view, rect, 408, 552);
    expect(bottomRight.x).toBeCloseTo(view.x + view.width, 9);
    expect(bottomRight.y).toBeCloseTo(view.y + view.height, 9);
  });

  it("크기가 0인 요소에서도 좌표 변환이 터지지 않는다", () => {
    const rect = { left: 0, top: 0, width: 0, height: 0 };
    expect(pointFromClient(BASE_VIEWPORT, rect, 10, 10)).toEqual({
      x: BASE_VIEWPORT.x,
      y: BASE_VIEWPORT.y,
    });
  });

  it("viewBox 문자열은 SVG가 읽을 수 있는 네 값이다", () => {
    expect(viewBoxOf(BASE_VIEWPORT)).toBe(VIEW_BOX);
    expect(viewBoxOf(focusOn(seoul, 2)).split(" ")).toHaveLength(4);
  });

  it("창 경계는 라벨 배치가 읽는 형태로 나온다", () => {
    expect(boundsOf(BASE_VIEWPORT)).toEqual({
      left: BASE_VIEWPORT.x,
      top: BASE_VIEWPORT.y,
      right: BASE_VIEWPORT.x + BASE_VIEWPORT.width,
      bottom: BASE_VIEWPORT.y + BASE_VIEWPORT.height,
    });
  });
});
