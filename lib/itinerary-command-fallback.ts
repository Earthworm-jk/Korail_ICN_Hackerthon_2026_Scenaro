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
  if (placeName === undefined) return unknown("PLACE_MISSING");
  // 이동과 추가가 함께 읽히면 이동으로 본다 — resolver가 일정에 없으면 되묻는다
  const intent = wantsMove ? "move_place" : "add_place";
  // 장소는 읽었으므로 되물을 때 되쓸 수 있게 함께 넘긴다 — 문장은 messages.ts가 만든다.
  // 무엇을 하려던 요청인지도 함께 준다 (#171): 문구는 같아도 완성할 명령이 다르다
  if (visitDayIndex === undefined) return unknown("DAY_MISSING", placeName, intent);

  const parsed = RawItineraryCommandSchema.safeParse({ intent, placeName, dayIndex: visitDayIndex });
  return parsed.success ? parsed.data : unknown("PLACE_MISSING");
}

/** 폴백은 문구를 만들지 않는다 — 코드와 조각만 (PR #142 리뷰 2번) */
function unknown(
  reason: UnknownReason,
  placeName?: string,
  intent?: "move_place" | "add_place",
): RawItineraryCommand {
  return {
    intent: "unknown",
    clarification: {
      source: "deterministic",
      reason,
      ...(placeName ? { placeName } : {}),
      ...(intent ? { intent } : {}),
    },
  };
}
