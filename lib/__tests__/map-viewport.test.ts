import { describe, expect, it } from "vitest";
import {
  BASE_VIEWPORT,
  BASE_ASPECT,
  autoViewportFor,
  baseViewportFor,
  withAspect,
  COASTLINE_DETAIL_SCALE,
  ROUTE_FIT_SCALE,
  aspectOf,
  FOCUS_SCALE,
  MAX_SCALE,
  MIN_SCALE,
  ZOOM_STEP,
  boundsOf,
  scaleBarOf,
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
  wheelZoomFactor,
  zoomAt,
  zoomByStep,
} from "../map-viewport";
import { project, VIEW_BOX } from "../korea-map-projection";
import { loadStationCoordinates } from "../station-coordinates";
import { loadRepositories } from "../repositories/json";

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

  /**
   * 배율 사다리 (#27 P0-0 "지도 확대 기준 단일화").
   *
   * 배율 상수가 네 개라 하나만 바꿔도 관계가 조용히 뒤집힌다. 값이 아니라 **순서와 역할 분리**를
   * 고정한다 — 값 조정은 자유롭되 사다리를 깨면 여기서 걸린다.
   */
  describe("배율 사다리", () => {
    it("네 값의 순서가 유지된다", () => {
      expect(MIN_SCALE).toBeLessThan(FOCUS_SCALE);
      expect(FOCUS_SCALE).toBeLessThanOrEqual(COASTLINE_DETAIL_SCALE);
      expect(COASTLINE_DETAIL_SCALE).toBeLessThan(MAX_SCALE);
    });

    it("자동 배치는 직접 조작 상한까지 당기지 않는다", () => {
      // 같은 자리 한 점 — 가장 세게 당겨지는 경우다
      expect(scaleOf(fitTo([seoul]))).toBeLessThanOrEqual(FOCUS_SCALE);
      // 아주 가까운 두 점도 마찬가지
      const near = project(37.5709, 126.9827);
      expect(scaleOf(fitTo([seoul, near]))).toBeLessThanOrEqual(FOCUS_SCALE);
      expect(scaleOf(fitTo([seoul, near]))).toBeLessThan(MAX_SCALE);
    });

    // PR #122 리뷰 비차단 — 비율(10배)까지 못 박지 않는다. 그 숫자는 근거가 아니라 현재 값에서
    // 우연히 성립하는 관계라, MAX_SCALE을 낮추면 이유 없이 걸린다. 여기서는 역할 분리만 고정하고,
    // 정작 의미 있는 계약(겹친 두 점이 화면에서 떨어져 보이는가)은 아래 `화면상 크기` 절의
    // onScreen(MAX_SCALE) > 15가 잡는다.
    it("사용자는 자동 배치보다 크게 당길 수 있다", () => {
      expect(scaleOf(focusOn(seoul, MAX_SCALE))).toBeGreaterThan(FOCUS_SCALE);
    });

    /**
     * PR #122 리뷰 필수 — 두 경계를 각각 검증한다.
     *
     * 이전에는 `fitTo([seoul], MAX_SCALE)` 하나로 봤는데, 점이 하나면 byWidth·byHeight가
     * Infinity라 요청값이 그대로 결과가 된다. 요청값과 전역 상한이 같은 값이어서 fitTo 안의
     * MAX_SCALE 클램프를 통째로 지워도 통과했다 — 계약의 후반부가 고정되지 않았다.
     */
    it("사용자 지정 상한은 존중하되 전역 상한은 MAX_SCALE이다", () => {
      // 기본값(FOCUS_SCALE)보다 큰 요청은 그대로 존중한다
      expect(scaleOf(fitTo([seoul], COASTLINE_DETAIL_SCALE))).toBeCloseTo(COASTLINE_DETAIL_SCALE, 6);
      // 전역 상한을 넘겨 요청하면 MAX_SCALE에서 잘린다
      expect(scaleOf(fitTo([seoul], MAX_SCALE * 2))).toBeCloseTo(MAX_SCALE, 6);
    });
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

  /**
   * 휠 배율 (PR #111 리뷰).
   *
   * 이벤트마다 고정 배수를 곱하면 트랙패드에서 네 건(1.5^4 = 5.06)만에 상한에 닿아 지도를
   * 제어할 수 없다. 배율 변화가 이벤트 횟수가 아니라 총 이동량에 비례한다는 것을 고정한다.
   */
  describe("휠 배율", () => {
    it("한 칸(deltaY 100)은 정확히 한 단계다", () => {
      expect(wheelZoomFactor(-100)).toBeCloseTo(ZOOM_STEP, 9);
      expect(wheelZoomFactor(100)).toBeCloseTo(1 / ZOOM_STEP, 9);
      expect(wheelZoomFactor(0)).toBeCloseTo(1, 9);
    });

    it("작은 delta는 작게 움직인다 — 트랙패드 한 건으로 튀지 않는다", () => {
      const factor = wheelZoomFactor(-4);
      expect(factor).toBeGreaterThan(1);
      expect(factor).toBeCloseTo(Math.pow(ZOOM_STEP, 0.04), 9);
    });

    it("같은 총 이동량이면 나눠 와도 결과가 같다 — 이 등식이 이번 회귀의 핵심이다", () => {
      const once = wheelZoomFactor(-100);
      const split = Array.from({ length: 10 }).reduce<number>(
        (acc) => acc * wheelZoomFactor(-10),
        1,
      );
      expect(split).toBeCloseTo(once, 9);

      const finer = Array.from({ length: 50 }).reduce<number>(
        (acc) => acc * wheelZoomFactor(-2),
        1,
      );
      expect(finer).toBeCloseTo(once, 9);
    });

    it("작은 delta가 여러 건 와도 한 제스처가 상한으로 튀지 않는다", () => {
      // 트랙패드가 한 번 쓸 때 보내는 정도 — 4px짜리 20건
      let view = BASE_VIEWPORT;
      for (let i = 0; i < 20; i += 1) view = zoomByStep(view, wheelZoomFactor(-4));
      expect(scaleOf(view)).toBeLessThan(MAX_SCALE);
      expect(scaleOf(view)).toBeCloseTo(Math.pow(ZOOM_STEP, 0.8), 6);

      // 고정 1.5배였다면 같은 제스처가 20단계를 뛴다 — 회귀하면 여기서 걸린다.
      // (상한을 200으로 올린 뒤로는 "네 건 만에 상한"이 아니라 이 배수 차이가 증상이다)
      let fixed = BASE_VIEWPORT;
      for (let i = 0; i < 20; i += 1) fixed = zoomByStep(fixed, ZOOM_STEP);
      expect(scaleOf(fixed)).toBeGreaterThan(scaleOf(view) * 100);
    });

    it("이벤트 하나가 한 단계를 넘지 못한다", () => {
      expect(wheelZoomFactor(-100000)).toBeCloseTo(ZOOM_STEP, 9);
      expect(wheelZoomFactor(100000)).toBeCloseTo(1 / ZOOM_STEP, 9);
    });

    it("줄·페이지 단위를 픽셀로 정규화한다", () => {
      // deltaMode 1 = 줄(16px), 2 = 쪽(800px)
      expect(wheelZoomFactor(-100 / 16, 1)).toBeCloseTo(wheelZoomFactor(-100), 9);
      expect(wheelZoomFactor(-100 / 800, 2)).toBeCloseTo(wheelZoomFactor(-100), 9);
      // 쪽 단위 한 건은 상한에 걸려 한 단계까지만
      expect(wheelZoomFactor(-1, 2)).toBeCloseTo(ZOOM_STEP, 9);
    });
  });

  it("표시 요소는 배율로 나눠 화면 크기를 유지한다", () => {
    expect(screenUnit(BASE_VIEWPORT)).toBe(1);
    expect(screenUnit(focusOn(seoul, 2))).toBeCloseTo(0.5, 9);
    expect(screenUnit(focusOn(seoul, 4))).toBeCloseTo(0.25, 9);
  });

  /**
   * 시내 수준 확대 (#27 지도 확대·축소 범위, PR #114 리뷰 6번).
   *
   * 상한을 올린 목적은 "같은 도시 안의 촬영지가 한 점으로 겹치지 않는 것"이다. 배율 숫자만
   * 고정하면 그 목적이 지켜지는지 알 수 없으므로, 실제 시드 좌표 두 곳의 화면 간격으로 고정한다.
   */
  describe("시내 수준 확대", () => {
    /**
     * 좌표를 적지 않고 시드에서 읽는다 — 이 회귀가 지키려는 것은 특정 숫자가 아니라
     * "시드에 실제로 들어 있는 가장 가까운 두 곳이 겹치지 않는 것"이다.
     *
     * 거리가 0인 쌍은 제외한다 (PR #115 리뷰 후속 1). 카탈로그가 넓어지면 서로 다른 촬영지가
     * 같은 건물·같은 지점을 공유할 수 있는데, 그 쌍은 배율을 아무리 올려도 떨어지지 않는다.
     * 그건 확대가 풀 문제가 아니라 클러스터·겹침 표시로 다룰 축이므로, 이 테스트가 데이터
     * 특성 때문에 지도 회귀처럼 깨지지 않게 양의 거리만 본다.
     */
    const closestPair = (() => {
      const points = loadRepositories().places.flatMap((place) =>
        place.latitude != null && place.longitude != null
          ? [project(place.latitude, place.longitude)]
          : [],
      );
      let best = Infinity;
      for (let i = 0; i < points.length; i += 1) {
        for (let j = i + 1; j < points.length; j += 1) {
          const gap = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y);
          if (gap > 0) best = Math.min(best, gap);
        }
      }
      return best;
    })();

    it("시드에 서로 다른 자리의 촬영지가 둘 이상 있다 — 아래 두 회귀의 전제", () => {
      // best가 Infinity로 남으면 아래 테스트가 조용히 통과해버린다
      expect(Number.isFinite(closestPair)).toBe(true);
    });

    /** 지도 폭 390px 기준 화면 간격 */
    const onScreen = (scale: number) => (closestPair * scale * 390) / BASE_VIEWPORT.width;

    it("옛 상한에서는 가장 가까운 두 곳이 한 점으로 겹쳤다", () => {
      expect(onScreen(COASTLINE_DETAIL_SCALE)).toBeLessThan(1);
    });

    it("새 상한에서는 사람이 두 점으로 읽을 만큼 떨어진다", () => {
      expect(onScreen(MAX_SCALE)).toBeGreaterThan(15);
    });

    it("상한에서 화면 폭이 도심 한 구역 수준이다", () => {
      const view = focusOn(seoul, MAX_SCALE);
      const bar = scaleBarOf(view);
      // 창 폭을 실거리로 환산 — 눈금이 창 폭의 4분의 1 이하라는 규칙에서 역산한다
      expect(bar.units).toBeLessThanOrEqual(view.width * 0.25 + 1e-9);
      expect(bar.km).toBeLessThanOrEqual(1);
    });

    it("거리 눈금은 배율이 바뀌면 같이 바뀌고 읽히는 숫자만 고른다", () => {
      const wide = scaleBarOf(BASE_VIEWPORT);
      const tight = scaleBarOf(focusOn(seoul, MAX_SCALE));
      expect(wide.km).toBeGreaterThan(tight.km);
      expect(wide.label).toMatch(/^\d+ km$/);
      expect(tight.label).toMatch(/^\d+ (km|m)$/);
    });

    it("해안선을 물리는 배율은 상한보다 낮다 — 상한까지 진하게 그리지 않는다", () => {
      expect(COASTLINE_DETAIL_SCALE).toBeLessThan(MAX_SCALE);
    });
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


/**
 * 상자 비율에 맞춘 창 (#146 팀 결정)
 *
 * `preserveAspectRatio="meet"`는 창이 상자보다 세로로 길면 높이에 맞춰 줄이고 좌우를 비운다.
 * 실측에서 상자 799x341에 창 194x256이 들어가 지도가 258px만 쓰고 양옆 270px씩 비었다.
 * 창을 상자와 같은 비율로 만들면 그 띠가 생길 자리가 없다.
 */
describe("상자 비율 맞춤", () => {
  const WIDE = 799 / 341; // 실측한 카드 비율
  const 강원 = [{ x: 150, y: 250 }, { x: 205, y: 262 }];   // 서울 - 강릉, 가로로 짧다
  const 전라 = [{ x: 150, y: 250 }, { x: 158, y: 330 }];   // 서울 - 남원, 세로로 길다

  it("창의 비율이 상자와 같아진다 — 좌우 빈 띠가 생기지 않는다", () => {
    const view = fitTo(강원, ROUTE_FIT_SCALE, WIDE);
    expect(aspectOf(view)).toBeCloseTo(WIDE, 6);
  });

  it("비율을 주지 않으면 기본 창 비율 그대로다 — 기존 호출은 그대로 동작한다", () => {
    expect(aspectOf(fitTo(강원))).toBeCloseTo(BASE_ASPECT, 6);
    expect(aspectOf(BASE_VIEWPORT)).toBeCloseTo(BASE_ASPECT, 6);
  });

  /** 권역마다 값을 따로 두지 않는다 — 경계 상자가 다르면 배율이 저절로 다르다 */
  it("강원 일정과 전라 일정의 배율이 다르게 잡힌다", () => {
    const gangwon = scaleOf(fitTo(강원, ROUTE_FIT_SCALE, WIDE));
    const jeolla = scaleOf(fitTo(전라, ROUTE_FIT_SCALE, WIDE));
    expect(gangwon).not.toBeCloseTo(jeolla, 2);
    // 세로로 긴 경로는 가로로 긴 창에서 더 많이 빼야 담긴다
    expect(jeolla).toBeLessThan(gangwon);
  });

  it("두 경로 모두 창 안에 들어온다", () => {
    for (const points of [강원, 전라]) {
      const view = fitTo(points, ROUTE_FIT_SCALE, WIDE);
      for (const point of points) expect(contains(view, point)).toBe(true);
    }
  });

  it("동선 상한은 해안선이 버티는 배율까지다 — 그 위로는 배경이 물러난다", () => {
    expect(ROUTE_FIT_SCALE).toBe(COASTLINE_DETAIL_SCALE);
    expect(scaleOf(fitTo([{ x: 200, y: 300 }], ROUTE_FIT_SCALE, WIDE))).toBeLessThanOrEqual(ROUTE_FIT_SCALE);
  });

  /** 가로로 넓은 창은 기본 창보다 넓어질 수 있다 — 가둘 자리가 없으면 가운데 둔다 */
  it("기본 창보다 넓은 창은 가로로 가운데 정렬된다", () => {
    const view = clampViewport({ x: -999, y: 250, width: BASE_VIEWPORT.width * 2, height: BASE_VIEWPORT.height });
    expect(view.x + view.width / 2).toBeCloseTo(BASE_VIEWPORT.x + BASE_VIEWPORT.width / 2, 6);
  });

  it("확대해도 상자 비율이 유지된다 — 조작 중에 띠가 다시 생기지 않는다", () => {
    const view = fitTo(강원, ROUTE_FIT_SCALE, WIDE);
    const zoomed = zoomByStep(view, ZOOM_STEP);
    expect(aspectOf(zoomed)).toBeCloseTo(WIDE, 6);
    expect(aspectOf(panBy(zoomed, 3, 3))).toBeCloseTo(WIDE, 6);
  });
});


/**
 * 상자 비율은 자동 맞춤 여부와 무관하게 유지된다 (PR #206 리뷰)
 *
 * 초판은 경로 자동 맞춤 경로에만 비율을 붙여서, 촬영지 지도·오버레이 등록·해제·키보드
 * 초기화에서 기본 세로 비율 창이 다시 들어가 좌우 빈 띠가 되살아났다. 갈래마다 따로
 * 처리하지 않고 한 함수로 모은다.
 */
describe("상자 비율 유지", () => {
  const WIDE = 799 / 341;
  const TALL = 390 / 700; // 모바일 세로
  const 경로 = [{ x: 150, y: 250 }, { x: 205, y: 262 }];
  const 오버레이 = [{ x: 180, y: 300 }];

  it("담을 지점이 없어도 기본 창이 상자 비율을 쓴다 — 촬영지 지도의 첫 창", () => {
    expect(aspectOf(autoViewportFor([], WIDE))).toBeCloseTo(WIDE, 6);
    expect(aspectOf(baseViewportFor(WIDE))).toBeCloseTo(WIDE, 6);
  });

  it("오버레이를 켤 때도 상자 비율이다", () => {
    expect(aspectOf(fitTo(오버레이, FOCUS_SCALE, WIDE))).toBeCloseTo(WIDE, 6);
  });

  it("오버레이를 끄면 경로 창으로 돌아가고 비율은 그대로다", () => {
    const 해제후 = autoViewportFor(경로, WIDE);
    expect(aspectOf(해제후)).toBeCloseTo(WIDE, 6);
    for (const point of 경로) expect(contains(해제후, point)).toBe(true);
  });

  /** 회전·반응형으로 상자가 바뀌었다고 보던 자리를 잃으면 안 된다 */
  it("사용자가 옮긴 창은 중심과 배율을 지키고 비율만 바꾼다", () => {
    const moved = panBy(zoomByStep(fitTo(경로, ROUTE_FIT_SCALE, WIDE), ZOOM_STEP), 4, 3);
    const rotated = withAspect(moved, TALL);
    expect(aspectOf(rotated)).toBeCloseTo(TALL, 6);
    expect(scaleOf(rotated)).toBeCloseTo(scaleOf(moved), 6);
    expect(rotated.x + rotated.width / 2).toBeCloseTo(moved.x + moved.width / 2, 6);
  });

  /**
   * 재리뷰 지적: 오버레이를 켜 둔 채 상자가 바뀌면 경로로 다시 맞춰져 대표 지점이
   * 화면 밖으로 나갔다. 오버레이가 켜져 있으면 그쪽이 우선한다.
   */
  it("오버레이를 켠 채 상자가 바뀌어도 대표 지점이 화면에 남는다", () => {
    const 경로밖오버레이 = [{ x: 265, y: 385 }]; // 부산 근처 — 서울-강릉 경로 밖
    expect(contains(autoViewportFor(경로, WIDE), 경로밖오버레이[0])).toBe(false);

    const 오버레이창 = fitTo(경로밖오버레이, FOCUS_SCALE, WIDE);
    expect(contains(오버레이창, 경로밖오버레이[0])).toBe(true);

    // 상자 비율이 바뀌어도 오버레이 기준으로 다시 맞춘다
    const 회전후 = fitTo(경로밖오버레이, FOCUS_SCALE, TALL);
    expect(aspectOf(회전후)).toBeCloseTo(TALL, 6);
    expect(contains(회전후, 경로밖오버레이[0])).toBe(true);
  });

  it("초기화는 한 경로다 — 버튼과 키보드가 같은 창을 만든다", () => {
    // 화면은 둘 다 autoViewportFor(현재 맞춤 대상, 현재 상자 비율)을 부른다
    expect(autoViewportFor(경로, WIDE)).toEqual(autoViewportFor(경로, WIDE));
    expect(autoViewportFor([], WIDE)).toEqual(baseViewportFor(WIDE));
  });
});
