/**
 * 한국어 조사 자동 선택 (#145).
 *
 * 문구에는 `{place}을(를)`처럼 두 형태를 함께 적어 두고, 값을 채운 뒤 **앞 글자의 받침**을
 * 보고 하나를 고른다. 고르는 자리를 `withValues` 한 곳에 두어 문구마다 따로 처리하지
 * 않는다 - 순서 문구만 고치면 `{place}이 일정에서 제외됩니다` 같은 자리가 그대로 남는다.
 *
 * **고를 수 없으면 그대로 둔다.** 라틴 문자나 숫자로 끝나는 이름에서 잘못 고르느니
 * `을(를)`인 채로 두는 쪽이 낫다 - 어색할 뿐 틀리지는 않는다.
 */

const HANGUL_FIRST = 0xac00;
const HANGUL_LAST = 0xd7a3;
const JONGSEONG_COUNT = 28;

/** 한글 음절이면 받침 유무, 한글이 아니면 `undefined` */
export function batchimOf(char: string): boolean | undefined {
  const code = char.codePointAt(0);
  if (code === undefined || code < HANGUL_FIRST || code > HANGUL_LAST) return undefined;
  return (code - HANGUL_FIRST) % JONGSEONG_COUNT !== 0;
}

/** 표기 → [받침 있을 때, 받침 없을 때]. `와(과)`만 순서가 뒤집힌다 */
const PAIRS: Record<string, readonly [string, string]> = {
  "을(를)": ["을", "를"],
  "이(가)": ["이", "가"],
  "은(는)": ["은", "는"],
  "와(과)": ["과", "와"],
};

const MARKER = /(.)(을\(를\)|이\(가\)|은\(는\)|와\(과\))/g;

/** 값이 채워진 문장에서 `X을(를)` 꼴을 앞 글자에 맞는 조사 하나로 줄인다 */
export function resolveJosa(text: string): string {
  return text.replace(MARKER, (whole, previous: string, marker: string) => {
    const batchim = batchimOf(previous);
    if (batchim === undefined) return whole;
    const [withBatchim, withoutBatchim] = PAIRS[marker];
    return previous + (batchim ? withBatchim : withoutBatchim);
  });
}
