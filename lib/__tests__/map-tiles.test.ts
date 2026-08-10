import { describe, expect, it } from "vitest";
import {
  MAX_TILE_ZOOM,
  MIN_TILE_ZOOM,
  baseZoom,
  tileUnits,
  tileXAt,
  tileYAt,
  tileZoomFor,
  tilesForView,
  xAtTile,
  yAtTile,
} from "../map-tiles";
import { project } from "../korea-map-projection";
import { BASE_VIEWPORT, MAX_SCALE, focusOn, scaleOf } from "../map-viewport";

/**
 * 배경 타일 좌표 변환 (#118 지도 배경 후속).
 *
 * 타일이 실제로 뜨는지는 키가 있어야 알 수 있지만, **어디에 놓을지**는 순수 계산이다.
 * 정렬이 틀리면 배경이 한 칸씩 밀려 보이는데 그건 눈으로만 잡히고 원인 추적이 어려우므로
 * 여기서 고정한다.
 */
describe("배경 타일 좌표", () => {
  const seoul = project(37.5528527, 126.9725721);
  const gangneung = project(37.76452, 128.8993979);

  it("표시 좌표 → 타일 → 표시 좌표가 제자리로 돌아온다", () => {
    for (const zoom of [6, 9, 12, 15]) {
      expect(xAtTile(tileXAt(seoul.x, zoom), zoom)).toBeCloseTo(seoul.x, 6);
      expect(yAtTile(tileYAt(seoul.y, zoom), zoom)).toBeCloseTo(seoul.y, 6);
    }
  });

  it("줌이 하나 오르면 타일 한 변이 절반이다", () => {
    for (const zoom of [5, 8, 13]) {
      expect(tileUnits(zoom + 1)).toBeCloseTo(tileUnits(zoom) / 2, 9);
    }
  });

  it("타일 번호는 줌마다 두 배가 된다 — 같은 지점 기준", () => {
    expect(tileXAt(seoul.x, 11)).toBeCloseTo(tileXAt(seoul.x, 10) * 2, 6);
    expect(tileYAt(seoul.y, 11)).toBeCloseTo(tileYAt(seoul.y, 10) * 2, 6);
  });

  it("서울역과 강릉역은 같은 줌에서 다른 타일에 있다 — 동쪽이 더 큰 X", () => {
    const zoom = 12;
    const seoulTile = Math.floor(tileXAt(seoul.x, zoom));
    const gangneungTile = Math.floor(tileXAt(gangneung.x, zoom));
    expect(gangneungTile).toBeGreaterThan(seoulTile);
  });

  it("북쪽일수록 타일 Y가 작다 — 화면 위가 북쪽", () => {
    expect(tileYAt(gangneung.y, 12)).toBeLessThan(tileYAt(seoul.y, 12));
  });

  /**
   * 타일 번호가 세계 표준과 맞는지 — 우리 좌표만으로 왕복하면 축척이 통째로 틀려도 통과한다.
   * 위경도에서 직접 계산한 값과 대조해 절대 기준을 잡는다.
   */
  it("타일 번호가 위경도에서 직접 계산한 값과 같다", () => {
    const zoom = 12;
    const lat = 37.5528527;
    const lon = 126.9725721;
    const n = 2 ** zoom;
    const expectedX = ((lon + 180) / 360) * n;
    const mercatorY = Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
    const expectedY = ((Math.PI - mercatorY) / (2 * Math.PI)) * n;

    expect(tileXAt(seoul.x, zoom)).toBeCloseTo(expectedX, 4);
    expect(tileYAt(seoul.y, zoom)).toBeCloseTo(expectedY, 4);
  });

  describe("창을 덮는 타일", () => {
    it("모든 타일이 창과 겹친다 — 헛것을 받지 않는다", () => {
      const view = focusOn(seoul, 40);
      const zoom = tileZoomFor(view);
      for (const t of tilesForView(view, zoom)) {
        expect(t.left).toBeLessThan(view.x + view.width);
        expect(t.left + t.size).toBeGreaterThan(view.x);
        expect(t.top).toBeLessThan(view.y + view.height);
        expect(t.top + t.size).toBeGreaterThan(view.y);
      }
    });

    it("창 네 귀퉁이가 전부 어떤 타일 안에 들어간다 — 빈 자리가 없다", () => {
      const view = focusOn(seoul, 40);
      const tiles = tilesForView(view, tileZoomFor(view));
      const corners = [
        { x: view.x, y: view.y },
        { x: view.x + view.width - 1e-9, y: view.y },
        { x: view.x, y: view.y + view.height - 1e-9 },
        { x: view.x + view.width - 1e-9, y: view.y + view.height - 1e-9 },
      ];
      for (const c of corners) {
        const covering = tiles.some(
          (t) => c.x >= t.left && c.x < t.left + t.size && c.y >= t.top && c.y < t.top + t.size,
        );
        expect(covering).toBe(true);
      }
    });

    it("타일 수가 화면에 필요한 만큼이다 — 수십 장이 되면 요청이 샌다", () => {
      for (const scale of [1, 10, 50, MAX_SCALE]) {
        const view = focusOn(seoul, scale);
        const count = tilesForView(view, tileZoomFor(view)).length;
        expect(count).toBeGreaterThan(0);
        expect(count).toBeLessThanOrEqual(20);
      }
    });

    it("타일이 서로 겹치지 않는다 — 같은 자리를 두 번 그리지 않는다", () => {
      const view = focusOn(seoul, 20);
      const tiles = tilesForView(view, tileZoomFor(view));
      const keys = tiles.map((t) => `${t.x}/${t.y}`);
      expect(new Set(keys).size).toBe(keys.length);
    });
  });

  describe("줌 고르기", () => {
    it("확대할수록 줌이 올라간다", () => {
      const wide = tileZoomFor(BASE_VIEWPORT);
      const tight = tileZoomFor(focusOn(seoul, MAX_SCALE));
      expect(tight).toBeGreaterThan(wide);
    });

    it("배율 사다리 양끝에서 줌 한계를 벗어나지 않는다", () => {
      for (const scale of [1, 3, 5, 50, MAX_SCALE]) {
        const zoom = tileZoomFor(focusOn(seoul, scale));
        expect(zoom).toBeGreaterThanOrEqual(MIN_TILE_ZOOM);
        expect(zoom).toBeLessThanOrEqual(MAX_TILE_ZOOM);
      }
    });

    it("기본 창은 남한이 몇 장에 담기는 줌이다", () => {
      const zoom = baseZoom();
      const tiles = tilesForView(BASE_VIEWPORT, zoom);
      expect(tiles.length).toBeGreaterThanOrEqual(2);
      expect(tiles.length).toBeLessThanOrEqual(20);
    });

    it("지도를 넓게 그리면 같은 창이라도 줌이 올라간다", () => {
      const view = focusOn(seoul, 20);
      expect(tileZoomFor(view, 1440)).toBeGreaterThanOrEqual(tileZoomFor(view, 720));
    });
  });

  /**
   * 고른 줌이 창과 같은 크기 대역에 있어야 한다. 타일이 창보다 훨씬 크면 흐릿하게 늘어나고,
   * 훨씬 작으면 같은 화면에 수십 장이 깔린다. 배율 사다리 전 구간에서 확인한다.
   */
  it("고른 줌의 타일이 창과 같은 크기 대역이다", () => {
    for (const scale of [1, 3, 5, 20, 50, MAX_SCALE]) {
      const view = focusOn(seoul, scale);
      const side = tileUnits(tileZoomFor(view));
      expect(side, `배율 ${scale}`).toBeGreaterThan(view.width / 6);
      expect(side, `배율 ${scale}`).toBeLessThan(view.width * 3);
    }
  });

  /** 창이 세로로 길어(194×256) 가로보다 한 줄 더 필요하다 — 4×4를 천장으로 둔다 */
  it("확대 상한에서도 배경이 열몇 장으로 화면을 덮는다", () => {
    const view = focusOn(seoul, MAX_SCALE);
    expect(scaleOf(view)).toBeCloseTo(MAX_SCALE, 6);
    expect(tilesForView(view, tileZoomFor(view)).length).toBeLessThanOrEqual(16);
  });
});
