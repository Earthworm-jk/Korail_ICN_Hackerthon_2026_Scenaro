/**
 * 지도 표시 창(viewBox) 조작 — 확대·축소·팬 (#14 v0.6 지도, #83 §A 후속)
 *
 * 좌표계는 건드리지 않는다. `project()`가 만드는 360×430 좌표와 그 위에 구운 해안선·
 * 선로 선형은 그대로 두고, 여기서는 "그 중 어디를 보여줄지"만 옮긴다. 그래서 이 파일에
 * 위경도는 한 번도 나오지 않는다 — 입력도 출력도 전부 SVG 좌표다.
 *
 * 컴포넌트가 아니라 lib에 두는 이유: 이 값들은 눈이 아니라 테스트로 고정해야 하는 계산이고
 * (경계 밖으로 새는 팬, 배율 한계, 확대 중심 유지), 테스트 환경이 node라 DOM에 묶으면
 * 검증할 방법이 없어진다.
 *
 * 중요 — 화면상 크기는 배율로 나눠 써야 한다. SVG는 창을 좁히면 그 안의 모든 것이 같이
 * 커진다. 점 반지름·선 두께·글자를 그대로 두고 확대하면 점 사이 간격과 점 크기가 함께
 * 커져서 겹침이 조금도 풀리지 않는다. 겹쳐 읽히던 점을 떼어 놓는 건 확대 자체가 아니라
 * "확대하되 표시 요소는 화면에서 같은 크기로 두는 것"이다. `screenUnit()`이 그 나눗셈이다.
 */
import { VIEW_BOX_BOUNDS, groundKmPerUnit } from "./korea-map-projection";

export type Viewport = { x: number; y: number; width: number; height: number };

/** 기본 창 — 배율 1. VIEW_BOX와 같은 값이며, 축소 하한이자 팬 한계다 */
export const BASE_VIEWPORT: Viewport = {
  x: VIEW_BOX_BOUNDS.left,
  y: VIEW_BOX_BOUNDS.top,
  width: VIEW_BOX_BOUNDS.right - VIEW_BOX_BOUNDS.left,
  height: VIEW_BOX_BOUNDS.bottom - VIEW_BOX_BOUNDS.top,
};

/**
 * 배율 사다리 — 이 파일의 배율 상수 네 개를 한 곳에서 정의한다 (#27 P0-0 "지도 확대 기준 단일화").
 *
 * 흩어져 있으면 왜 이 숫자인지, 서로 어떤 관계인지 알 수 없다. 순서는 항상 아래를 지키며
 * `map-viewport.test.ts`의 `배율 사다리`가 이를 고정한다.
 *
 *   MIN_SCALE(1) < FOCUS_SCALE(3) <= COASTLINE_DETAIL_SCALE(5) < MAX_SCALE(200)
 *
 *   1    기본 창. 남한 전체가 들어온다. 축소 하한이자 팬 한계
 *   3    자동 배치가 잡는 상한. 사람이 아니라 코드가 창을 정할 때는 여기까지만 당긴다
 *   5    해안선 원천 해상도의 한계. 이 위로는 배경이 물러난다
 *   200  사용자가 직접 당길 수 있는 상한. 화면 폭 약 2.5km
 *
 * **자동과 수동의 상한이 다른 것이 이 사다리의 핵심이다.** 자동 배치가 200까지 당기면 주변
 * 역이 화면에서 사라져 "그 지점이 어디쯤인가"를 잃는다. 반대로 수동 상한을 3으로 묶으면 같은
 * 도시 안의 촬영지가 한 점으로 겹친다(PR #115). 두 값을 하나로 합치지 않는다.
 */

/** 축소 하한 = 기본 창. 이보다 더 빼면 남한 둘레에 빈 바다만 늘어난다 */
export const MIN_SCALE = 1;
/**
 * 자동 배치가 잡는 상한 — "대표 지점 보기"와 `fitTo`의 기본값.
 *
 * 3이면 창이 약 65×85 표시단위로, 권역 하나와 가까운 역이 함께 들어온다. 사용자가 직접
 * 당길 수 있는 상한(MAX_SCALE)까지 코드가 자동으로 당기지 않는 이유는 위 사다리 주석에 있다.
 */
export const FOCUS_SCALE = 3;
/**
 * 해안선이 버티는 배율.
 *
 * 해안선(lib/korea-outline.ts)은 Natural Earth 1:50m을 구운 꼭짓점 260개짜리 폴리곤이고,
 * 변 길이 중앙값이 2.94 표시단위다. 지도 폭이 화면에서 대략 390px(=194단위)이므로 배율 1에서
 * 한 변은 약 6px, 배율 5에서 약 29px이다. 이보다 더 키우면 곡선이 아니라 꺾은선으로 읽힌다.
 *
 * 예전에는 이 값이 확대 상한 자체였다. 지금은 상한이 아니라 **해안선을 물리는 지점**이다 —
 * 원천 해상도를 넘어선 배율에서 해안선을 계속 진하게 그리면, 실제로는 1:50m 정확도인 선이
 * 시내 지도처럼 읽힌다. 가진 근거보다 정밀해 보이는 표시를 만들지 않는다.
 */
export const COASTLINE_DETAIL_SCALE = 5;
/**
 * 확대 상한.
 *
 * 배율 5(옛 상한)에서 화면 폭은 약 100km다. 그 배율에서 서로 다른 촬영지가 한 점으로 겹친다 —
 * 시드의 `영풍문고 종로본점`과 `보신각터`는 실거리 약 130m라 화면에서 0.5px 떨어져 있고,
 * 사용자가 "이 두 곳이 붙어 있다"는 것조차 볼 수 없다.
 *
 * 200이면 화면 폭이 약 2.5km — 도심 한 구역이 화면을 채우는 크기이고, 위 두 곳이 약 20px로
 * 떨어진다. 배경은 이 배율을 감당하지 못하므로 COASTLINE_DETAIL_SCALE 위에서 물러나고,
 * 대신 거리 눈금(scaleBarOf)이 지금 화면이 몇 km인지를 알려준다.
 *
 * 이 지도에는 도로·건물 데이터가 없다. 확대가 보여주는 것은 실제 위경도로 찍힌 지점들의
 * 상대 배치이지 시내 지도가 아니다 (#14 6절 — 보조 시각화).
 */
export const MAX_SCALE = 200;
/** 버튼 한 번 / 휠 한 칸의 배율 변화 */
export const ZOOM_STEP = 1.5;

/** 마우스 휠 한 칸의 표준 이동량(px). 이만큼 굴리면 정확히 한 단계다 */
const WHEEL_NOTCH_PX = 100;
/** deltaMode 1 — 한 줄의 픽셀 환산 */
const WHEEL_LINE_PX = 16;
/** deltaMode 2 — 한 쪽의 픽셀 환산 */
const WHEEL_PAGE_PX = 800;

/**
 * 휠 한 이벤트의 배율 변화 — 이벤트 "횟수"가 아니라 이동량 `deltaY`에 비례한다.
 *
 * 이벤트마다 고정 배수를 곱하면 트랙패드에서 지도를 제어할 수 없다. 트랙패드는 한 번 쓸어도
 * 작은 deltaY 이벤트를 여러 건 보내므로, 고정 1.5배라면 한 번 쓸 때마다 배율이 수십 배씩 뛴다.
 * 지수를 쓰면 곱이 지수의 합이 되어, 같은 총 이동량이면 잘게 나뉘어 오든 한 번에 오든 결과가
 * 같다 — `map-viewport.test.ts`가 이 등식을 고정한다 (PR #111 리뷰).
 *
 * 이벤트 하나의 변화량은 한 단계로 잠근다. deltaMode 2(페이지 단위)처럼 한 건이 800px씩
 * 들어오는 입력에서 한 번에 상한까지 튀지 않게 한다.
 */
export function wheelZoomFactor(deltaY: number, deltaMode = 0): number {
  const pixels = deltaY * (deltaMode === 1 ? WHEEL_LINE_PX : deltaMode === 2 ? WHEEL_PAGE_PX : 1);
  // 위로 굴리면(deltaY < 0) 확대
  const steps = clamp(-pixels / WHEEL_NOTCH_PX, -1, 1);
  return Math.exp(steps * Math.log(ZOOM_STEP));
}
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 현재 배율 — 기본 창 대비 몇 배로 확대돼 있는지 */
export function scaleOf(view: Viewport): number {
  return BASE_VIEWPORT.width / view.width;
}

/**
 * 화면에서 같은 크기로 보이려면 곱해야 하는 값.
 * 배율 2에서 점 반지름 6을 그대로 쓰면 화면에서 12px이 된다 — `6 * screenUnit(view)`로 쓴다.
 */
export function screenUnit(view: Viewport): number {
  return 1 / scaleOf(view);
}

export function isZoomed(view: Viewport): boolean {
  return scaleOf(view) > MIN_SCALE + 1e-9;
}

/**
 * 배율을 한계 안으로, 창을 기본 창 안으로 되돌린다.
 *
 * 팬은 기본 창 밖으로 나가지 못한다. 바다만 남은 화면에서 사용자가 자기 위치를 잃는 것보다
 * 손가락이 경계에서 멈추는 쪽이 낫다.
 */
export function clampViewport(view: Viewport): Viewport {
  const scale = clamp(scaleOf(view), MIN_SCALE, MAX_SCALE);
  const width = BASE_VIEWPORT.width / scale;
  const height = BASE_VIEWPORT.height / scale;
  return {
    width,
    height,
    x: clamp(view.x, BASE_VIEWPORT.x, BASE_VIEWPORT.x + BASE_VIEWPORT.width - width),
    y: clamp(view.y, BASE_VIEWPORT.y, BASE_VIEWPORT.y + BASE_VIEWPORT.height - height),
  };
}

/**
 * 기준점을 제자리에 두고 배율만 바꾼다 — 휠·버튼·창 맞춤이 모두 이걸 쓴다.
 * 기준점은 표시 좌표다(포인터 아래 지점). 확대 중심이 손끝에서 벗어나면 지도가 미끄러진 것처럼
 * 느껴지므로, 배율이 한계에 걸려 실제로는 안 커지는 경우까지 포함해 같은 식으로 계산한다.
 */
export function zoomAt(view: Viewport, factor: number, focus: { x: number; y: number }): Viewport {
  const scale = clamp(scaleOf(view) * factor, MIN_SCALE, MAX_SCALE);
  const width = BASE_VIEWPORT.width / scale;
  const height = BASE_VIEWPORT.height / scale;
  // 기준점이 창 안에서 차지하던 상대 위치를 유지한다
  const ratioX = (focus.x - view.x) / view.width;
  const ratioY = (focus.y - view.y) / view.height;
  return clampViewport({ x: focus.x - ratioX * width, y: focus.y - ratioY * height, width, height });
}

/** 창 한가운데를 기준으로 확대·축소 — 버튼용 */
export function zoomByStep(view: Viewport, factor: number): Viewport {
  return zoomAt(view, factor, { x: view.x + view.width / 2, y: view.y + view.height / 2 });
}

/**
 * 지도를 끌어 옮긴다. (dx, dy)는 "내용이 움직인 양"이라 창은 반대로 간다 —
 * 손으로 종이를 미는 방향과 화면이 같이 가야 한다.
 */
export function panBy(view: Viewport, dx: number, dy: number): Viewport {
  return clampViewport({ ...view, x: view.x - dx, y: view.y - dy });
}

/**
 * 한 지점을 화면 가운데로 가져오며 확대한다 — 테마체험 "대표 지점 보기"가 쓴다.
 * 배율을 못 채우는 창(한계에 걸린 경우)에서도 지점이 창 안에 들어오도록 마지막에 clamp한다.
 */
export function focusOn(point: { x: number; y: number }, scale: number): Viewport {
  const bounded = clamp(scale, MIN_SCALE, MAX_SCALE);
  const width = BASE_VIEWPORT.width / bounded;
  const height = BASE_VIEWPORT.height / bounded;
  return clampViewport({ x: point.x - width / 2, y: point.y - height / 2, width, height });
}

/**
 * 창을 맞출 때 점 둘레에 남기는 여백 (창 한 변에 대한 비율).
 * 점이 가장자리에 붙으면 이름 라벨이 놓일 자리가 없다 — 라벨은 점 옆에 붙는다.
 */
const FIT_MARGIN = 0.18;

/**
 * 여러 지점을 한 화면에 담는 창 — 테마체험 필터가 켜질 때 쓴다.
 *
 * 지점이 하나면 `focusOn(point, maxScale)`과 같은 결과다. 지금 검수된 권역 추천은 1건뿐이라
 * 실제로는 그 경우만 돌지만, 여기서 여러 개를 받아 두면 추천이 늘어날 때 이 부분은 다시
 * 손대지 않는다 — 필터가 켠 것을 다 보여준다는 규칙은 개수와 무관하다.
 */
export function fitTo(points: readonly { x: number; y: number }[], maxScale = FOCUS_SCALE): Viewport {
  if (points.length === 0) return BASE_VIEWPORT;

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  // 점들이 차지하는 폭에 여백을 더한 값이 창 안에 들어가야 한다
  const room = 1 - 2 * FIT_MARGIN;
  const byWidth = maxX - minX > 0 ? (BASE_VIEWPORT.width * room) / (maxX - minX) : Infinity;
  const byHeight = maxY - minY > 0 ? (BASE_VIEWPORT.height * room) / (maxY - minY) : Infinity;
  const scale = clamp(Math.min(maxScale, byWidth, byHeight), MIN_SCALE, MAX_SCALE);

  const width = BASE_VIEWPORT.width / scale;
  const height = BASE_VIEWPORT.height / scale;
  return clampViewport({
    x: (minX + maxX) / 2 - width / 2,
    y: (minY + maxY) / 2 - height / 2,
    width,
    height,
  });
}

/** 창이 그 지점을 담고 있는지 — 확대가 실제로 지점을 보여줬는지 테스트로 확인한다 */
export function contains(view: Viewport, point: { x: number; y: number }): boolean {
  return (
    point.x >= view.x &&
    point.x <= view.x + view.width &&
    point.y >= view.y &&
    point.y <= view.y + view.height
  );
}

/**
 * 거리 눈금이 고르는 값 (km). 사람이 읽는 숫자만 남긴다 — `1 km`는 읽히고 `1.37 km`는 안 읽힌다.
 */
const NICE_DISTANCES_KM = [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200] as const;

/**
 * 거리 눈금 — 지금 화면이 실제로 몇 km인지.
 *
 * 배경이 물러난 배율에서 사용자가 축척을 읽을 근거가 이것뿐이다. 해안선이 흐려지면 "얼마나
 * 확대됐는지"를 알려주는 다른 단서가 화면에 없다.
 *
 * 길이는 창 폭의 4분의 1을 넘지 않는 가장 큰 눈금값으로 잡는다. 위도에 따라 표시단위당 실거리가
 * 달라지므로(`groundKmPerUnit`) 창 한가운데 위도에서 계산한다.
 */
export function scaleBarOf(view: Viewport): { km: number; units: number; label: string } {
  const kmPerUnit = groundKmPerUnit(view.y + view.height / 2);
  const target = view.width * 0.25 * kmPerUnit;
  const km = NICE_DISTANCES_KM.reduce(
    (best, candidate) => (candidate <= target ? candidate : best),
    NICE_DISTANCES_KM[0],
  );
  return {
    km,
    units: km / kmPerUnit,
    label: km >= 1 ? `${km} km` : `${Math.round(km * 1000)} m`,
  };
}

/** SVG viewBox 속성 문자열. 소수 셋째 자리까지 — 팬이 픽셀 단위로 튀지 않게 */
export function viewBoxOf(view: Viewport): string {
  const round = (n: number) => Number(n.toFixed(3));
  return `${round(view.x)} ${round(view.y)} ${round(view.width)} ${round(view.height)}`;
}

/** 창 경계 — 라벨 배치가 읽는 형태로 맞춘다 */
export function boundsOf(view: Viewport) {
  return {
    left: view.x,
    top: view.y,
    right: view.x + view.width,
    bottom: view.y + view.height,
  };
}

/**
 * 화면 좌표 → 표시 좌표.
 *
 * viewBox 비율을 항상 기본 창과 같게 유지하므로 preserveAspectRatio의 여백(letterbox)이
 * 생기지 않는다. 그래서 단순 비례로 충분하다 — 비율을 바꾸는 변경을 하면 이 가정이 깨진다.
 */
export function pointFromClient(
  view: Viewport,
  rect: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  if (rect.width === 0 || rect.height === 0) return { x: view.x, y: view.y };
  return {
    x: view.x + ((clientX - rect.left) / rect.width) * view.width,
    y: view.y + ((clientY - rect.top) / rect.height) * view.height,
  };
}
