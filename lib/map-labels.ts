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

/**
 * 라벨 글자 크기 (viewBox 단위).
 * 시안은 12였지만 실데이터는 이름이 길어 10으로 줄여 배치 여유를 만든다.
 */
export const LABEL_FONT_SIZE = 10;
/** 두 줄 라벨의 줄 간격 */
export const LABEL_LINE_HEIGHT = 11;
/** 라벨은 최대 두 줄까지 — 세 줄이면 지도보다 라벨이 커진다 */
const MAX_LINES = 2;
const LABEL_OFFSET_X = 9;
/** 라벨 사이 최소 여백 */
const LABEL_PADDING = 1.5;
/** 표시 영역 경계 (VIEW_BOX "80 215 220 205") */
const LABEL_BOUNDS = { left: 80, right: 300, top: 215, bottom: 420 };
/** 자리를 찾을 때 시도하는 세로 이동량 — 제자리부터, 위아래 번갈아 */
const LABEL_DY_CANDIDATES = [0, -13, 13, -26, 26, -39, 39];

/** 한글·한자·가나는 전각(1em), 라틴 문자는 평균 0.55em로 잡는다 */
const WIDE_CHAR = /[ᄀ-ᇿ぀-ヿ㄰-㆏一-鿿가-힯]/;

export type LabelSeed = { key: string; text: string; x: number; y: number };
export type PlacedLabel = LabelSeed & {
  lines: string[];
  anchor: "start" | "end";
  from: { x: number; y: number };
  left: number;
  right: number;
  top: number;
  bottom: number;
};

function textUnits(text: string): number {
  let units = 0;
  for (const char of text) units += WIDE_CHAR.test(char) ? 1 : 0.55;
  return units;
}

export function labelWidth(lines: readonly string[]): number {
  return Math.max(...lines.map((line) => textUnits(line))) * LABEL_FONT_SIZE;
}

/**
 * 최대 폭에 맞춰 최대 두 줄로 나눈다. 공백이 있으면(영어) 폭이 가장 고르게 갈라지는
 * 공백에서, 없으면(한글) 글자 중간에서 나눈다. 두 줄로도 넘치면 그대로 둔다 —
 * 자르면 역 이름이 바뀌어 버리므로 문구를 훼손하지 않고 배치 단계에서 판단하게 한다.
 */
export function wrapLabel(text: string, maxWidth: number): string[] {
  if (labelWidth([text]) <= maxWidth || MAX_LINES < 2) return [text];

  const spaces: number[] = [];
  for (let i = 0; i < text.length; i += 1) if (text[i] === " ") spaces.push(i);

  if (spaces.length > 0) {
    let best: { lines: string[]; width: number } | null = null;
    for (const at of spaces) {
      const lines = [text.slice(0, at), text.slice(at + 1)];
      const width = labelWidth(lines);
      if (!best || width < best.width) best = { lines, width };
    }
    return best!.lines;
  }

  const middle = Math.ceil(text.length / 2);
  return [text.slice(0, middle), text.slice(middle)];
}

function verticalExtent(y: number, lineCount: number) {
  // 기준선 위 ascent, 아래 descent + 추가 줄
  return {
    top: y - LABEL_FONT_SIZE * 0.85 - LABEL_PADDING,
    bottom: y + (lineCount - 1) * LABEL_LINE_HEIGHT + LABEL_FONT_SIZE * 0.25 + LABEL_PADDING,
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
 */
export function layoutLabels(seeds: readonly LabelSeed[]): PlacedLabel[] {
  const placed: PlacedLabel[] = [];

  for (const seed of [...seeds].sort((a, b) => a.y - b.y)) {
    let best: { candidate: PlacedLabel; conflicts: number; overflow: number } | null = null;

    for (const flip of [false, true]) {
      const x = seed.x + (flip ? -LABEL_OFFSET_X : LABEL_OFFSET_X);
      const room = flip ? x - LABEL_BOUNDS.left : LABEL_BOUNDS.right - x;
      if (room <= 0) continue;

      const lines = wrapLabel(seed.text, room);
      const width = labelWidth(lines);
      const left = flip ? x - width : x;
      const right = left + width;
      // 두 줄로도 안 들어가면 얼마나 넘치는지를 기록해 두고 덜 넘치는 쪽을 고른다
      const overflow = Math.max(0, width - room);

      for (const dy of LABEL_DY_CANDIDATES) {
        const y = seed.y + dy;
        const { top, bottom } = verticalExtent(y, lines.length);
        if (top < LABEL_BOUNDS.top || bottom > LABEL_BOUNDS.bottom) continue;
        const candidate: PlacedLabel = {
          ...seed,
          lines,
          x,
          y,
          left,
          right,
          top,
          bottom,
          anchor: flip ? "end" : "start",
          from: { x: seed.x, y: seed.y },
        };
        const conflicts = placed.filter((other) => labelsOverlap(other, candidate)).length;
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
