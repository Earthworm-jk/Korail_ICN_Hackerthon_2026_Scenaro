/**
 * v0.6 시안 지도 투영 — 한반도 SVG 좌표계 (#14 클릭형 HTML 계약 기준)
 *
 * 시안(`wireframes/scenaro-wireframe-v0.6.html`)의 지도는 외부 라이브러리가 아니라 자체
 * SVG다. 시안 주석에 남은 생성 코드가 출처이며, 정적 SVG는 아래 설정으로 만들어졌다.
 *
 *   d3.geoMercator().fitExtent([[34, 24], [width - 34, height - 24]], peninsula)
 *   // width = 360, height = 430  →  fitExtent([[34, 24], [326, 406]])
 *
 * 런타임 d3 의존을 늘리지 않기 위해 같은 변환을 해석적으로 복원해 상수로 고정했다.
 * 회전 없는 메르카토르는 (경도, mercY(위도))에 대한 등방 선형 변환이므로 축척 1개와
 * 평행이동 2개로 완전히 결정된다. 아래 값은 시안 정적 SVG의 기준점 3개(인천공항·서울역·
 * 강릉역)에 최소제곱으로 맞춘 해이며, 최대 잔차 0.005px다 —`korea-map-projection.test.ts`.
 *
 * 잔차가 0이 아닌 이유: 시안 SVG에 저장된 cx·cy가 소수점 둘째 자리로 반올림돼 있어
 * 그보다 정밀하게 원래 변환을 되돌릴 수 없다. 0.01px는 시안이 가진 정밀도 자체이고,
 * 실제 표시 배율에서 화면 1픽셀의 100분의 1 미만이라 눈에 보이는 차이가 아니다.
 *
 * 좌표를 임의로 배치하지 않는다: 화면에 찍히는 모든 점은 실제 위도·경도의 투영이다.
 */

/** 메르카토르 축척 (d3 scale 값과 동일 단위) */
const SCALE = 1983.2751905175248;
/** 경도 0°가 놓이는 x (px) */
const TRANSLATE_X = -4234.162150478736;
/** 적도(mercY = 0)가 놓이는 y (px) */
const TRANSLATE_Y = 1675.0702691478289;

const DEG = Math.PI / 180;

/** 구면 메르카토르 y — d3.geoMercator의 raw 투영과 동일 */
function mercatorY(latitude: number): number {
  return Math.log(Math.tan(Math.PI / 4 + (latitude * DEG) / 2));
}

export type MapPosition = { x: number; y: number };

/** 위도·경도 → 시안 SVG 좌표계(360×430 기준). 반올림하지 않는다 — 렌더에서 정밀도를 남긴다 */
export function project(latitude: number, longitude: number): MapPosition {
  return {
    x: SCALE * longitude * DEG + TRANSLATE_X,
    y: TRANSLATE_Y - SCALE * mercatorY(latitude),
  };
}

/**
 * 표시 영역 — 남한 권역 확대 crop. 좌표계는 360×430 그대로이고 보이는 창만 좁아진다.
 *
 * 시안 스크립트는 `80 215 220 205`를 쓴다. 그 값은 시안이 쓰던 꼭짓점 19개짜리 경계에
 * 맞춰 잡힌 것이라, 실제 해안선(lib/korea-outline.ts)을 올리면 왼쪽에 빈 바다가 47단위
 * 남고 아래로 제주도가 잘린다. 실제 육지 범위(x 127.5-298.1, y 223.6-455.5)에 여백을
 * 두어 다시 잡았다 — 잔차 표에 의도적 차이로 기록한다.
 */
export const VIEW_BOX = "116 212 194 256";

/** VIEW_BOX를 좌표로 푼 값 — 라벨 배치가 표시 영역을 알아야 한다 */
export const VIEW_BOX_BOUNDS = (() => {
  const [x, y, width, height] = VIEW_BOX.split(" ").map(Number);
  return { left: x, top: y, right: x + width, bottom: y + height };
})();

/** 시안이 동선에 쓴 곡률 — d3.curveCatmullRom.alpha(.45) */
export const ROUTE_CURVE_ALPHA = 0.45;

/**
 * Catmull-Rom 스플라인 → SVG path (d3-shape `curveCatmullRom` 이식).
 *
 * 시안의 동선 곡선을 d3 없이 같은 모양으로 그리기 위한 최소 이식이다. 시안 정적 SVG의
 * 동선 path 문자열을 문자 단위로 재현하는 것을 테스트로 고정했다.
 *
 * 이 곡선은 실제 버스·택시·도보 경로가 아니라 일정의 지역 관계를 잇는 보조 시각화다
 * (#14 §6). 실경로처럼 읽히지 않도록 역·공항 지점만 잇고 중간 경유지를 만들지 않는다.
 */
export function catmullRomPath(points: readonly MapPosition[], alpha = ROUTE_CURVE_ALPHA): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M${points[0].x},${points[0].y}`;

  const out: string[] = [];
  const epsilon = 1e-12;
  let x0 = 0, y0 = 0, x1 = 0, y1 = 0, x2 = 0, y2 = 0;
  let l01a = 0, l12a = 0, l23a = 0, l012a = 0, l122a = 0, l232a = 0;
  let count = 0;

  const curveTo = (x: number, y: number) => {
    let cx1 = x1, cy1 = y1, cx2 = x2, cy2 = y2;
    if (l01a > epsilon) {
      const a = 2 * l012a + 3 * l01a * l12a + l122a;
      const n = 3 * l01a * (l01a + l12a);
      cx1 = (x1 * a - x0 * l122a + x2 * l012a) / n;
      cy1 = (y1 * a - y0 * l122a + y2 * l012a) / n;
    }
    if (l23a > epsilon) {
      const b = 2 * l232a + 3 * l23a * l12a + l122a;
      const m = 3 * l23a * (l23a + l12a);
      cx2 = (x2 * b + x1 * l232a - x * l122a) / m;
      cy2 = (y2 * b + y1 * l232a - y * l122a) / m;
    }
    out.push(`C${cx1},${cy1},${cx2},${cy2},${x2},${y2}`);
  };

  const push = (x: number, y: number) => {
    if (count) {
      const dx = x2 - x;
      const dy = y2 - y;
      l232a = Math.pow(dx * dx + dy * dy, alpha);
      l23a = Math.sqrt(l232a);
    }
    if (count === 0) {
      count = 1;
      out.push(`M${x},${y}`);
    } else if (count === 1) {
      count = 2;
    } else {
      count = 3;
      curveTo(x, y);
    }
    l01a = l12a; l12a = l23a;
    l012a = l122a; l122a = l232a;
    x0 = x1; x1 = x2; x2 = x;
    y0 = y1; y1 = y2; y2 = y;
  };

  for (const point of points) push(point.x, point.y);
  // d3 lineEnd — 마지막 점을 한 번 더 흘려 끝 구간의 제어점을 닫는다
  if (count === 2) out.push(`L${x2},${y2}`);
  else if (count === 3) push(x2, y2);

  return out.join("");
}
