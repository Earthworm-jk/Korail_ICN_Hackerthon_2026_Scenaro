/**
 * 지도 라벨 배치 (#14 v0.6 지도)
 *
 * 시안은 데모용 라벨 2-4개를 손으로 배치했다(각 지점에 dx·dy·anchor를 직접 적어 둠).
 * 실데이터는 지점이 겹치고 이름이 길어 그 방식을 쓸 수 없으므로 배치를 계산한다.
 *
 * 영어가 특히 어렵다. "Incheon Airport Terminal 1 Station"은 33자라 한 줄로는 지도 폭
 * (220 단위)에 어떤 크기로도 들어가지 않는다. 서비스의 주 사용자가 해외 여행객이므로
 * 영어에서 라벨이 깨지는 건 부수 문제가 아니다 — 줄바꿈까지 여기서 처리한다.
 *
 * 컴포넌트에서 분리해 둔 이유: 겹침 여부는 눈이 아니라 테스트로 확인해야 하는 값이다.
 */
import { VIEW_BOX_BOUNDS } from "./korea-map-projection";

/**
 * 라벨 글자 크기 (viewBox 단위, 배율 1 기준).
 * 시안은 12였지만 실데이터는 이름이 길어 10으로 줄여 배치 여유를 만든다.
 */
export const LABEL_FONT_SIZE = 10;
/** 두 줄 라벨의 줄 간격 (배율 1 기준) */
export const LABEL_LINE_HEIGHT = 11;
/** 라벨은 최대 두 줄까지 — 세 줄이면 지도보다 라벨이 커진다 */
const MAX_LINES = 2;
const LABEL_OFFSET_X = 9;
/** 라벨 사이 최소 여백 */
const LABEL_PADDING = 1.5;
/**
 * 알약 배경이 글자 좌우로 더 차지하는 폭 (컴포넌트의 rect가 쓰는 값과 같다).
 * 배치에서 빼 두면 글자는 창 안인데 배경만 잘리는 라벨이 생긴다.
 */
const LABEL_PILL_PADDING = 3.5;
/** 표시 영역 경계 — VIEW_BOX에서 파생한다. 따로 적어 두면 창을 옮길 때 어긋난다 */
const LABEL_BOUNDS = VIEW_BOX_BOUNDS;
/**
 * 자리를 찾을 때 시도하는 세로 이동량 — 제자리부터, 위아래 번갈아.
 * 두 줄 라벨(긴 영문 역명)은 상자가 높아 가까운 자리가 잘 막히므로 멀리까지 훑는다.
 */
const LABEL_DY_CANDIDATES = [0, -13, 13, -26, 26, -39, 39, -52, 52, -65, 65];

export type LabelBounds = { left: number; top: number; right: number; bottom: number };

/**
 * 배치 조건 — 지도를 확대·축소하면 둘 다 바뀐다 (#27 지도 확대-축소-팬).
 *
 * `bounds`  현재 보이는 창. 창이 좁아지면 라벨이 놓일 수 있는 자리도 같이 좁아진다.
 * `scale`   현재 배율. 글자와 여백을 이 값으로 나눠 화면에서의 크기를 고정한다. 나누지 않으면
 *           확대할수록 라벨이 지도를 덮는다 — 겹침 계산도 그만큼 무의미해진다.
 *
 * 기본값은 배율 1·기본 창이라, 이 인자를 넘기지 않는 호출과 기존 회귀 테스트는 그대로다.
 */
export type LabelLayoutOptions = { bounds?: LabelBounds; scale?: number };

/** 한글·한자·가나는 전각(1em), 라틴 문자는 평균 0.55em로 잡는다 */
const WIDE_CHAR = /[ᄀ-ᇿ぀-ヿ㄰-㆏一-鿿가-힯]/;

export type LabelSeed = {
  key: string;
  text: string;
  x: number;
  y: number;
  /**
   * 이 지점에 그려지는 표식의 반지름 (배율 1 기준). 라벨이 자기 표식을 덮지 않게 하는 데 쓴다.
   * 넘기지 않으면 점 하나만 피한다 — 기존 호출의 배치는 달라지지 않는다.
   */
  radius?: number;
};
export type PlacedLabel = LabelSeed & {
  lines: string[];
  anchor: "start" | "end";
  from: { x: number; y: number };
  left: number;
  right: number;
  top: number;
  bottom: number;
  /** 이 배치에 쓴 글자 크기·줄 간격 (표시 좌표 단위) — 렌더가 배율을 다시 계산하지 않게 함께 넘긴다 */
  fontSize: number;
  lineHeight: number;
};

function textUnits(text: string): number {
  let units = 0;
  for (const char of text) units += WIDE_CHAR.test(char) ? 1 : 0.55;
  return units;
}

export function labelWidth(lines: readonly string[], fontSize = LABEL_FONT_SIZE): number {
  return Math.max(...lines.map((line) => textUnits(line))) * fontSize;
}

/**
 * 최대 폭에 맞춰 최대 두 줄로 나눈다. 공백이 있으면(영어) 폭이 가장 고르게 갈라지는
 * 공백에서, 없으면(한글) 글자 중간에서 나눈다. 두 줄로도 넘치면 그대로 둔다 —
 * 자르면 역 이름이 바뀌어 버리므로 문구를 훼손하지 않고 배치 단계에서 판단하게 한다.
 */
export function wrapLabel(text: string, maxWidth: number, fontSize = LABEL_FONT_SIZE): string[] {
  if (labelWidth([text], fontSize) <= maxWidth || MAX_LINES < 2) return [text];

  const spaces: number[] = [];
  for (let i = 0; i < text.length; i += 1) if (text[i] === " ") spaces.push(i);

  if (spaces.length > 0) {
    let best: { lines: string[]; width: number } | null = null;
    for (const at of spaces) {
      const lines = [text.slice(0, at), text.slice(at + 1)];
      const width = labelWidth(lines, fontSize);
      if (!best || width < best.width) best = { lines, width };
    }
    return best!.lines;
  }

  const middle = Math.ceil(text.length / 2);
  return [text.slice(0, middle), text.slice(middle)];
}

function verticalExtent(y: number, lineCount: number, fontSize: number, lineHeight: number) {
  // 기준선 위 ascent, 아래 descent + 추가 줄
  const padding = LABEL_PADDING * (fontSize / LABEL_FONT_SIZE);
  return {
    top: y - fontSize * 0.85 - padding,
    bottom: y + (lineCount - 1) * lineHeight + fontSize * 0.25 + padding,
  };
}

/** 두 라벨의 상자가 겹치는지 — 배치와 테스트가 같은 판정을 쓴다 */
export function labelsOverlap(a: PlacedLabel, b: PlacedLabel): boolean {
  return a.right > b.left && b.right > a.left && a.bottom > b.top && b.bottom > a.top;
}

/**
 * 라벨 겹침 해소.
 *
 * 지점마다 (오른쪽·왼쪽) × (제자리·위·아래) 후보를 가까운 순서로 훑어 이미 놓인 라벨과
 * 겹치지 않는 첫 자리를 고른다. 한쪽으로만 밀면 밀림이 연쇄해서(강릉→진부→서울→공항→만종)
 * 뒤쪽 라벨이 자기 점에서 크게 떠 버린다. 각 후보는 그쪽에 남은 폭에 맞춰 줄바꿈한다.
 * 빈 자리가 없으면 가장 덜 겹치는 자리를 쓴다 — 라벨을 빠뜨리지는 않는다.
 *
 * 확대·축소하면 `options`로 창과 배율이 들어와 배치를 다시 계산한다. 배치를 고정해 두고
 * 창만 옮기면 확대할수록 글자가 커지면서 서로 먹어 들어간다 — 겹침 0이라는 계약이 배율 1에서만
 * 참인 값이 된다. 배율별 겹침 0은 `map-labels.test.ts`가 따로 고정한다.
 */
export function layoutLabels(
  seeds: readonly LabelSeed[],
  options: LabelLayoutOptions = {},
): PlacedLabel[] {
  const bounds = options.bounds ?? LABEL_BOUNDS;
  // 화면에서의 크기를 고정한다 — 배율 2에서 글자 10은 표시 좌표로 5다
  const unit = 1 / (options.scale ?? 1);
  // 알약 배경까지 창 안에 들어오도록 가로 여유를 미리 뺀다
  const inner = {
    left: bounds.left + LABEL_PILL_PADDING * unit,
    right: bounds.right - LABEL_PILL_PADDING * unit,
  };
  const fontSize = LABEL_FONT_SIZE * unit;
  const lineHeight = LABEL_LINE_HEIGHT * unit;
  const offsetX = LABEL_OFFSET_X * unit;
  const dyCandidates = LABEL_DY_CANDIDATES.map((dy) => dy * unit);

  const placed: PlacedLabel[] = [];

  for (const seed of [...seeds].sort((a, b) => a.y - b.y)) {
    let best: { candidate: PlacedLabel; conflicts: number; overflow: number } | null = null;

    for (const flip of [false, true]) {
      const x = seed.x + (flip ? -offsetX : offsetX);
      const room = flip ? x - inner.left : inner.right - x;
      if (room <= 0) continue;

      const lines = wrapLabel(seed.text, room, fontSize);
      const width = labelWidth(lines, fontSize);
      /**
       * 자기 자리에 다 못 들어가면 창 안으로 밀어 넣는다.
       *
       * 확대하면 창이 좁아져서 점이 창 한가운데 놓이는 일이 흔해진다. 그때 긴 영문 역명은
       * 어느 쪽으로 붙여도 절반이 창 밖으로 나간다 — 이름이 잘려 보이는 것보다 점에서 조금
       * 밀리는 쪽이 낫다. 창보다 넓은 이름만 남는 만큼 넘치고, 그 값으로 좌우를 고른다.
       */
      const anchored = flip ? x - width : x;
      const left = Math.min(Math.max(anchored, inner.left), Math.max(inner.left, inner.right - width));
      const right = left + width;
      const overflow = Math.max(0, width - (inner.right - inner.left));

      for (const dy of dyCandidates) {
        const y = seed.y + dy;
        const { top, bottom } = verticalExtent(y, lines.length, fontSize, lineHeight);
        if (top < bounds.top || bottom > bounds.bottom) continue;
        const candidate: PlacedLabel = {
          ...seed,
          lines,
          // 밀어 넣은 만큼 글자 기준점도 함께 옮긴다 — 상자와 글자가 어긋나면 배경만 움직인다
          x: flip ? right : left,
          y,
          left,
          right,
          top,
          bottom,
          fontSize,
          lineHeight,
          anchor: flip ? "end" : "start",
          from: { x: seed.x, y: seed.y },
        };
        /**
         * 자기 표식 위에 올라앉은 자리는 다른 라벨과 겹친 것과 똑같이 나쁘다.
         *
         * 좁은 창에서는 긴 이름이 한쪽에 다 안 들어가 창 안으로 밀리는데, 그때 알약이 자기 표식을
         * 덮어 버린다 — 이름은 읽히지만 무엇을 가리키는지가 사라진다. 세로 후보로 비켜 가게 한다.
         * 표식은 점이 아니라 원이므로(역 7, 권역 고리 10) 반지름만큼 넉넉히 피한다.
         */
        const markerRadius = (seed.radius ?? 0) * unit;
        const nearestX = Math.min(Math.max(seed.x, left), right);
        const nearestY = Math.min(Math.max(seed.y, top), bottom);
        const coversOwnPoint =
          (nearestX - seed.x) ** 2 + (nearestY - seed.y) ** 2 <= markerRadius ** 2;
        const conflicts =
          placed.filter((other) => labelsOverlap(other, candidate)).length + (coversOwnPoint ? 1 : 0);
        const better =
          !best ||
          overflow < best.overflow ||
          (overflow === best.overflow && conflicts < best.conflicts);
        if (better) best = { candidate, conflicts, overflow };
        if (conflicts === 0 && overflow === 0) break;
      }
      if (best && best.conflicts === 0 && best.overflow === 0) break;
    }

    if (best) placed.push(best.candidate);
  }

  return placed;
}
