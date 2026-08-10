/**
 * 배경 타일 좌표 변환 — 우리 표시 좌표 ↔ 웹 메르카토르 타일(z/x/y)
 *
 * 왜 갈아엎지 않아도 되는가 —
 * `korea-map-projection.ts`의 `project()`는 **구면 메르카토르**다. 타일 좌표계(EPSG:3857)와
 * 같은 식을 쓰고 축척·평행이동만 다르므로, 둘 사이는 **아핀 변환 하나**로 이어진다.
 * 재투영이 없다는 뜻이고, 그래서 라벨 배치기·배율 사다리·경로 애니메이션을 그대로 두고
 * 배경만 깔 수 있다.
 *
 *   우리:  x = SCALE·λ + TX            y = TY − SCALE·mercY(φ)
 *   타일:  X = (λ + π)/2π · 2^z        Y = (π − mercY)/2π · 2^z
 *
 * 두 식에서 λ와 mercY를 소거하면 아래 함수들이 나온다. 이 파일에는 위경도가 한 번도
 * 나오지 않는다 — 입력도 출력도 표시 좌표이거나 타일 번호다.
 *
 * 타일은 메르카토르 공간에서 정사각형이고 우리 좌표는 그 공간의 등방 선형 변환이므로,
 * **우리 좌표에서도 정사각형**이다. 그래서 한 변만 알면 배치가 끝난다.
 */
import { MERCATOR_SCALE, MERCATOR_TRANSLATE_X, MERCATOR_TRANSLATE_Y } from "./korea-map-projection";
import { BASE_VIEWPORT, type Viewport } from "./map-viewport";

/** 타일 한 장의 픽셀 크기 — 래스터 타일의 사실상 표준 */
export const TILE_PIXELS = 256;

/**
 * 배경으로 쓸 최대 줌.
 *
 * 우리 확대 상한(MAX_SCALE = 200)에서 창 폭이 약 2.5km다. z15면 타일 한 변이 그보다 작아
 * 화면을 채우고도 남는다. 더 높은 줌은 요청 수만 늘고 얻는 게 없다.
 */
export const MAX_TILE_ZOOM = 15;
/** 배경이 의미를 갖는 최소 줌 — 이보다 낮으면 한 장에 한반도가 다 들어와 배경이 무의미하다 */
export const MIN_TILE_ZOOM = 5;

/** 전 세계가 우리 표시 좌표에서 차지하는 한 변 — 타일 크기 계산의 기준 */
const WORLD_UNITS = MERCATOR_SCALE * 2 * Math.PI;

/** 줌 z에서 타일 한 변이 표시 좌표로 몇 단위인가. z가 1 오르면 절반이다 */
export function tileUnits(zoom: number): number {
  return WORLD_UNITS / 2 ** zoom;
}

/** 표시 좌표 x → 타일 X (정수 아님. 소수부가 타일 안 위치다) */
export function tileXAt(x: number, zoom: number): number {
  const lambda = (x - MERCATOR_TRANSLATE_X) / MERCATOR_SCALE;
  return ((lambda + Math.PI) / (2 * Math.PI)) * 2 ** zoom;
}

/** 표시 좌표 y → 타일 Y */
export function tileYAt(y: number, zoom: number): number {
  const mercatorY = (MERCATOR_TRANSLATE_Y - y) / MERCATOR_SCALE;
  return ((Math.PI - mercatorY) / (2 * Math.PI)) * 2 ** zoom;
}

/** 타일 X → 표시 좌표 x (왼쪽 모서리) */
export function xAtTile(tileX: number, zoom: number): number {
  const lambda = (tileX / 2 ** zoom) * 2 * Math.PI - Math.PI;
  return MERCATOR_SCALE * lambda + MERCATOR_TRANSLATE_X;
}

/** 타일 Y → 표시 좌표 y (위쪽 모서리) */
export function yAtTile(tileY: number, zoom: number): number {
  const mercatorY = Math.PI - (tileY / 2 ** zoom) * 2 * Math.PI;
  return MERCATOR_TRANSLATE_Y - MERCATOR_SCALE * mercatorY;
}

/**
 * 이 창에 맞는 줌.
 *
 * 타일 한 장이 화면에서 원래 크기(256px)에 가깝게 보이는 줌을 고른다. 더 낮으면 흐리고,
 * 더 높으면 같은 화면에 타일이 네 배로 늘어 요청만 많아진다.
 *
 * `renderPixels`는 지도가 화면에서 차지하는 가로 픽셀이다. 화면 폭에 따라 달라지므로
 * 호출부가 준다 — 기본값은 태블릿 가로에서 지도 열의 대략적인 폭이다.
 */
export function tileZoomFor(view: Viewport, renderPixels = 720): number {
  const unitsPerPixel = view.width / renderPixels;
  const wanted = TILE_PIXELS * unitsPerPixel;
  const zoom = Math.round(Math.log2(WORLD_UNITS / wanted));
  return Math.min(MAX_TILE_ZOOM, Math.max(MIN_TILE_ZOOM, zoom));
}

export type TilePlacement = {
  zoom: number;
  x: number;
  y: number;
  /** 표시 좌표에서의 자리 — SVG `<image>`에 그대로 넣는다 */
  left: number;
  top: number;
  size: number;
};

/**
 * 창을 덮는 타일 목록.
 *
 * 창 밖으로 한 장씩 넉넉히 잡지 않는다 — 팬은 창을 기본 창 안으로 가두므로(clampViewport)
 * 미리 받아둘 여유가 크지 않고, 요청 수를 줄이는 편이 낫다.
 *
 * 좌표계 밖(음수·최대 초과) 타일은 뺀다. 한반도는 세계 지도 안쪽이라 실제로는 드물지만,
 * 계산이 경계에서 새면 존재하지 않는 타일을 요청하게 된다.
 */
export function tilesForView(view: Viewport, zoom: number): TilePlacement[] {
  const count = 2 ** zoom;
  const size = tileUnits(zoom);

  const fromX = Math.floor(tileXAt(view.x, zoom));
  const toX = Math.ceil(tileXAt(view.x + view.width, zoom));
  const fromY = Math.floor(tileYAt(view.y, zoom));
  const toY = Math.ceil(tileYAt(view.y + view.height, zoom));

  const out: TilePlacement[] = [];
  for (let x = fromX; x < toX; x += 1) {
    if (x < 0 || x >= count) continue;
    for (let y = fromY; y < toY; y += 1) {
      if (y < 0 || y >= count) continue;
      out.push({ zoom, x, y, left: xAtTile(x, zoom), top: yAtTile(y, zoom), size });
    }
  }
  return out;
}

/** 기본 창(남한 전체)을 덮는 줌 — 미리 받아둘 범위를 정할 때 쓴다 */
export function baseZoom(renderPixels = 720): number {
  return tileZoomFor(BASE_VIEWPORT, renderPixels);
}
