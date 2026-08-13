/**
 * 결정적 폴백 파서 (#141 P0-1, 구현 순서 9번)
 *
 * **발표의 성공 여부를 네트워크에 걸지 않기 위한 것이다.** `OPENAI_API_KEY`가 없거나
 * 호출이 실패하거나 발표장 네트워크가 죽어도, 대표 명령은 이 파서만으로 끝까지 간다.
 * LLM은 표현의 폭을 넓히고, 되고 안 되고는 결정적 코드가 보장한다.
 *
 * 모든 자연어를 지원하지 않는다 — #141 비범위대로다. 대표 문장과 그 주변 표현만 받고,
 * 나머지는 `unknown` + 재질문으로 정직하게 떨어뜨린다. 폴백이 LLM 성공처럼 보이게
 * 숨기지 않는다는 계약은 이 모듈이 아니라 호출부가 표시로 지킨다.
 */
import {
  RawItineraryCommandSchema,
  type RawItineraryCommand,
  type UnknownReason,
} from "./itinerary-command";

/** "둘째 날" 같은 한국어 서수. 인덱스가 곧 일차(1부터) */
const KO_ORDINALS = ["첫", "둘", "셋", "넷", "다섯", "여섯", "일곱"];
const KO_NATIVE_DAYS = ["하루", "이틀", "사흘", "나흘", "닷새", "엿새", "이레"];
const EN_ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh"];

/**
 * `바꿔`는 넣지 않는다. #141 예시에서 이 동사는 **한 번도 날짜 이동이 아니다** —
 * `여유롭게 바꿔줘`(하루 완화) · `순서를 바꿀 수 있어?`(같은 날 순서) ·
 * `환승이 적은 일정으로 바꿀 수 있어?`(공항·열차) 전부 P0 밖이다.
 * 넣으면 그 문장들이 이동으로 읽혀 "어떤 장소인가요?"로 되묻게 되고,
 * 지원하지도 않는 기능으로 사용자를 끌고 간다.
 */
const MOVE_VERBS = /(옮겨|이동|보내)/;
const ADD_VERBS = /(넣어|추가|포함)/;

/**
 * 부정·취소·대조 표지 (#197 P0-A)
 *
 * **긍정 동사 판정보다 먼저 본다.** 앞서 `넣지 마`가 안전했던 것은 `ADD_VERBS`가
 * 활용형(`넣어`)이라 우연히 걸리지 않았기 때문이고, `추가`·`포함`은 어간이라 부정이
 * 그대로 통과했다 — `영진해변을 둘째 날에 추가하지 마`가 긍정 proposal이 됐다.
 * 장소와 일차가 모두 유효하므로 resolver도 막지 못한다. 안전이 정규식 활용형의
 * 부산물이 되지 않게 여기서 끊는다.
 *
 * 대조(`말고`·`대신`)도 같이 끊는다. `둘째 날 말고 셋째 날에 넣어줘`는
 * `parseDayIndex`가 문장 안 **첫 서수**를 잡아 사용자가 배제한 날짜를 골랐다.
 */
const BLOCKING_MARKERS = [
  // 하지 마 · 넣지 말고 · 추가하지 마세요
  /(?:하|넣|추가하|포함하|옮기|빼|배치하)지\s*(?:마|말)/,
  // 추가하지 않아도 돼 · 넣지 않아야 한다
  /않아(?:도|야)?\s*(?:되|돼|됩니다|괜찮|한다)/,
  // 안 넣어도 돼 — `안`은 단독으로 보면 `안내`·`안동`을 오탐하므로 동사와 붙여서만 본다
  /안\s*(?:넣|추가|포함|옮기|빼|배치)/,
  /필요\s*없/,
  /취소|그만|됐어|됐습니다/,
  /아니(?:야|요|에요|었어)/,
  // 대조 — 단독 낱말로만 본다 (`대신동` 같은 지명 오탐 방지)
  /말고/,
  /(?:^|\s)대신(?:에)?(?=\s|$)/,
  /\bdon'?t\b|\bdo\s+not\b|\bnot\b|\bnever\b/i,
  /\binstead\s+of\b|\bexcept\b|\bno\s+need\b|\bcancel\b/i,
];

/** 부정·취소·대조 표지가 있나 — 슬롯 합치기 게이트도 같은 판정을 쓴다 (#197 P0-B) */
export function hasBlockingMarker(text: string): boolean {
  return BLOCKING_MARKERS.some((pattern) => pattern.test(text));
}

/** 이동·추가 동사가 있나 — 장소 답변인지 새 명령인지 가르는 데 쓴다 */
export function hasCommandVerb(text: string): boolean {
  return MOVE_VERBS.test(text) || ADD_VERBS.test(text) || /\b(move|add|put)\b/i.test(text);
}

/**
 * 제거·교체 동사 (PR #200 리뷰).
 *
 * **장소 답변 게이트 전용이다.** `광화문 빼줘`는 부정 표지도 없고 추가·이동 동사도 없어서
 * 두 검사를 모두 통과했다. 그 문장 전체가 장소명으로 슬롯에 합쳐지면서
 * `둘째 날에 넣어줘` 뒤의 `광화문 빼줘`가 `add_place(둘째 날)`이 됐다 —
 * **지원하지 않는 요청을 지원하는 요청으로 바꿔 읽는 것**이라 답변에서 거부한다.
 *
 * 파서 진입부에는 넣지 않는다. 이 동사들만으로는 add·move 의도가 서지 않아
 * `광화문 빼줘`를 새 명령으로 읽으면 이미 `UNSUPPORTED_INTENT`다.
 */
const REMOVAL_VERBS = /(빼|삭제|제외|제거|지워|없애|바꿔|변경|교체)/;

export function hasRemovalVerb(text: string): boolean {
  return REMOVAL_VERBS.test(text)
    || /\b(remove|delete|drop|exclude|replace|change|swap)\b/i.test(text);
}
/**
 * "7곳만 남겨줘" (#171 6번).
 *
 * **개수 뒤에 남기다·줄이다 계열이 와야 한다.** `7곳 추천해줘`처럼 개수만 있는 문장까지
 * 잡으면 추천 요청이 정리 명령으로 읽힌다. 여기서 못 알아듣는 편이 잘못 실행하는 것보다 낫다.
 */
const LIMIT_PATTERNS = [
  /(\d+)\s*(?:곳|개|군데)\s*(?:만|으로|로)?\s*(?:남기|남겨|줄이|줄여|추리|추려|골라)/,
  /(?:keep|leave|limit|reduce)\D{0,12}(\d+)\s*(?:places?|spots?)/i,
  /(?:only|just)\s*(\d+)\s*(?:places?|spots?)/i,
];

/**
 * "영진해변은 꼭" — 어느 안에서도 빼지 않을 장소.
 *
 * 조사·동사를 떼어 이름처럼 보이는 덩어리만 남긴다. 카탈로그 대조는 resolver 몫이다.
 */
const PINNED_PATTERNS = [
  // 공백을 포함하지 않는다 — 포함하면 앞 문장까지 통째로 먹는다
  /([가-힣A-Za-z][가-힣A-Za-z0-9·]{1,19})\s*(?:은|는|이|가)?\s*(?:꼭|반드시|무조건)\s*(?:유지|남기|남겨|넣|가|빼지)/,
  // 숫자로 시작하면 개수 표현이다 — `keep 7 places`가 장소 이름으로 읽히면 안 된다
  /(?:must\s*keep|definitely\s*keep|keep)\s+([A-Za-z][A-Za-z'-]{1,29})(?:\s*[,.]|\s|$)/i,
];

function parseLimit(text: string): { targetPlaceCount: number; pinnedPlaceNames: string[] } | null {
  for (const pattern of LIMIT_PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;
    const count = Number(match[1]);
    if (!Number.isInteger(count) || count < 1 || count > 50) continue;
    const pinned: string[] = [];
    for (const pinPattern of PINNED_PATTERNS) {
      const pin = text.match(pinPattern);
      // 붙은 조사를 뗀다 — 카탈로그 대조는 resolver 가 하므로 이름만 넘긴다
      const name = pin?.[1]?.trim().replace(/(?:은|는|이|가|을|를)$/, "");
      if (name && !pinned.includes(name)) pinned.push(name);
    }
    return { targetPlaceCount: count, pinnedPlaceNames: pinned };
  }
  return null;
}

const ROUTE_RECOMMEND_PATTERNS = [
  /(동선|경로).*(맞|가까|근처).*(추천|촬영지|장소)/,
  /(추천|촬영지|장소).*(동선|경로).*(맞|가까|근처)/,
  /recommend.*(?:along|near).*(?:route|way)/i,
  /(?:place|filming location).*(?:along|near).*(?:route|way)/i,
];
const DAY_PLACE_RECOMMEND_PATTERNS = [
  /(?:갈|가볼|들를)\s*만한.*(?:촬영지|장소).*(?:추천|알려)/,
  /(?:다른\s*)?(?:촬영지|장소).*(?:추천|알려)/,
  /recommend.*(?:filming location|place)/i,
];
const EXPLAIN_PATTERNS = [
  /(뭐|무엇|무슨).*(달라|바뀌|변경)/,
  /(변경|바뀐).*(내용|점|것).*(설명|알려|뭐)/,
  /what\s+(has\s+)?changed/i,
  /explain\s+(the\s+)?(changes?|diff)/i,
];

/**
 * 문장에서 여행 일차를 읽는다. 못 읽으면 undefined.
 *
 * `2일차` · `둘째 날` · `이틀째` · `day 2` · `second day`를 받는다.
 */
export function parseDayIndex(input: string): number | undefined {
  const numeric = input.match(/(\d+)\s*(?:일\s*차|일째|번째\s*날)/)
    ?? input.match(/day\s*(\d+)/i);
  if (numeric) {
    const value = Number(numeric[1]);
    if (Number.isInteger(value) && value >= 1) return value;
  }

  for (const [index, word] of KO_ORDINALS.entries()) {
    // `첫째 날` · `첫 날` · `둘째날`
    if (new RegExp(`${word}(?:째)?\\s*날`).test(input)) return index + 1;
  }
  for (const [index, word] of KO_NATIVE_DAYS.entries()) {
    if (new RegExp(`${word}째`).test(input)) return index + 1;
  }
  for (const [index, word] of EN_ORDINALS.entries()) {
    if (new RegExp(`\\b${word}\\s+day\\b`, "i").test(input)) return index + 1;
  }
  return undefined;
}

/**
 * 문장에 나온 여행 일차를 **모두** 모은다 (#197 P0-A).
 *
 * `parseDayIndex`는 첫 하나만 돌려주므로 `둘째 날이나 셋째 날`처럼 목표가 둘인 문장을
 * 조용히 하나로 줄인다. 둘 이상이면 단일 목표로 해소되지 않았다는 뜻이라 되물어야 한다.
 */
export function dayIndicesIn(input: string): number[] {
  const found = new Set<number>();

  for (const match of input.matchAll(/(\d+)\s*(?:일\s*차|일째|번째\s*날)/g)) {
    const value = Number(match[1]);
    if (Number.isInteger(value) && value >= 1) found.add(value);
  }
  for (const match of input.matchAll(/day\s*(\d+)/gi)) {
    const value = Number(match[1]);
    if (Number.isInteger(value) && value >= 1) found.add(value);
  }
  for (const [index, word] of KO_ORDINALS.entries()) {
    if (new RegExp(`${word}(?:째)?\\s*날`).test(input)) found.add(index + 1);
  }
  for (const [index, word] of KO_NATIVE_DAYS.entries()) {
    if (new RegExp(`${word}째`).test(input)) found.add(index + 1);
  }
  for (const [index, word] of EN_ORDINALS.entries()) {
    if (new RegExp(`\\b${word}\\s+day\\b`, "i").test(input)) found.add(index + 1);
  }

  return [...found].sort((a, b) => a - b);
}

/**
 * 장소명 후보를 잘라 낸다.
 *
 * 카탈로그 대조는 하지 않는다 — 그건 resolver 몫이고, 여기서 하면 판정이 두 군데로 흩어진다.
 * 조사와 동사만 떼어 **이름처럼 보이는 덩어리**를 넘긴다.
 */
export function parsePlaceName(input: string): string | undefined {
  // 한국어: `<이름>을/를/은/는` 앞부분. 일차 표현이 앞에 오면 그 뒤부터 본다
  const korean = input
    .replace(/\d+\s*(?:일\s*차|일째|번째\s*날)(?:에|으로|로)?/g, " ")
    .replace(new RegExp(`(?:${KO_ORDINALS.join("|")})(?:째)?\\s*날(?:에|로|으로)?`, "g"), " ")
    .match(/([^\s,]+(?:\s+[^\s,]+){0,4}?)\s*(?:을|를|은|는)\s/);
  if (korean) return korean[1].trim();

  // 영어: `move|add <이름> to|on day N`
  const english = input.match(/\b(?:move|add|put)\s+(.+?)\s+(?:to|on|into)\b/i);
  if (english) return english[1].trim();

  return undefined;
}

/**
 * 대표 문장을 명령으로 옮긴다. LLM 없이 도는 유일한 경로다.
 *
 * 확실하지 않으면 추측하지 않고 `unknown`으로 떨어뜨린다 — 잘못 해석해 일정을 바꾸는 것이
 * 못 알아듣는 것보다 나쁘다.
 */
export function parseCommand(input: string): RawItineraryCommand {
  const text = input.trim();
  if (text === "") return unknown("EMPTY_INPUT");

  /**
   * 부정·취소·대조와 복수 일차는 **의도 판정보다 먼저** 끊는다 (#197 P0-A).
   *
   * 여기서 못 알아듣는 편이 사용자가 하지 말라고 한 일을 확인 창에 올리는 것보다 낫다.
   * 새 사유 코드는 만들지 않는다 — 기존 재질문 계약으로 먼저 차단하고, 사유 세분화는
   * ko/en 문구와 화면 분기를 함께 바꿀 수 있을 때 한다 (#197 결정).
   */
  if (hasBlockingMarker(text)) return unknown("UNSUPPORTED_INTENT");
  if (dayIndicesIn(text).length > 1) return unknown("UNSUPPORTED_INTENT");

  if (EXPLAIN_PATTERNS.some((pattern) => pattern.test(text))) {
    return { intent: "explain_changes" };
  }

  // 개수 정리는 날짜·장소보다 먼저 본다 — "7곳만 남겨줘"에는 둘 다 없다
  const limit = parseLimit(text);
  if (limit) {
    const parsedLimit = RawItineraryCommandSchema.safeParse({
      intent: "limit_places",
      targetPlaceCount: limit.targetPlaceCount,
      ...(limit.pinnedPlaceNames.length > 0 ? { pinnedPlaceNames: limit.pinnedPlaceNames } : {}),
    });
    if (parsedLimit.success) return parsedLimit.data;
  }

  const dayIndex = parseDayIndex(text);
  if (ROUTE_RECOMMEND_PATTERNS.some((pattern) => pattern.test(text))
    || (dayIndex !== undefined
      && DAY_PLACE_RECOMMEND_PATTERNS.some((pattern) => pattern.test(text)))) {
    return dayIndex === undefined
      ? unknown("DAY_MISSING")
      : { intent: "recommend_along_route", dayIndex };
  }

  const wantsMove = MOVE_VERBS.test(text) || /\bmove\b/i.test(text);
  const wantsAdd = ADD_VERBS.test(text) || /\b(add|put)\b/i.test(text);
  if (!wantsMove && !wantsAdd) return unknown("UNSUPPORTED_INTENT");

  const placeName = parsePlaceName(text);
  const visitDayIndex = dayIndex;

  // 동사만 걸리고 장소도 일차도 없으면 애초에 이동·추가 요청이 아니다.
  // `여유롭게 바꿔줘`가 `바꿔` 하나로 이동으로 읽히는데, 여기서 "어떤 장소인가요?"로
  // 되물으면 지원하지도 않는 기능으로 사용자를 끌고 간다 — 못 알아들었다고 말하는 게 맞다.
  if (placeName === undefined && visitDayIndex === undefined) return unknown("UNSUPPORTED_INTENT");
  // 이동과 추가가 함께 읽히면 이동으로 본다 — resolver가 일정에 없으면 되묻는다
  const intent = wantsMove ? "move_place" : "add_place";
  // 일차는 읽었으므로 되물을 때 되쓸 수 있게 함께 넘긴다 (#197 P0-B) — 앞서는 버렸다
  if (placeName === undefined) return unknown("PLACE_MISSING", { intent, dayIndex: visitDayIndex });
  // 장소는 읽었으므로 되물을 때 되쓸 수 있게 함께 넘긴다 — 문장은 messages.ts가 만든다.
  // 무엇을 하려던 요청인지도 함께 준다 (#171): 문구는 같아도 완성할 명령이 다르다
  if (visitDayIndex === undefined) return unknown("DAY_MISSING", { placeName, intent });

  const parsed = RawItineraryCommandSchema.safeParse({ intent, placeName, dayIndex: visitDayIndex });
  return parsed.success ? parsed.data : unknown("PLACE_MISSING", { intent });
}

/** 폴백은 문구를 만들지 않는다 — 코드와 조각만 (PR #142 리뷰 2번) */
function unknown(
  reason: UnknownReason,
  slots: {
    placeName?: string;
    intent?: "move_place" | "add_place";
    dayIndex?: number;
  } = {},
): RawItineraryCommand {
  return {
    intent: "unknown",
    clarification: {
      source: "deterministic",
      reason,
      ...(slots.placeName ? { placeName: slots.placeName } : {}),
      ...(slots.dayIndex !== undefined ? { dayIndex: slots.dayIndex } : {}),
      ...(slots.intent ? { intent: slots.intent } : {}),
    },
  };
}
