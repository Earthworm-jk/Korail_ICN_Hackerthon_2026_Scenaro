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
const ROUTE_RECOMMEND_PATTERNS = [
  /(동선|경로).*(맞|가까|근처).*(추천|촬영지|장소)/,
  /(추천|촬영지|장소).*(동선|경로).*(맞|가까|근처)/,
  /recommend.*(?:along|near).*(?:route|way)/i,
  /(?:place|filming location).*(?:along|near).*(?:route|way)/i,
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

  if (ROUTE_RECOMMEND_PATTERNS.some((pattern) => pattern.test(text))) {
    const dayIndex = parseDayIndex(text);
    return dayIndex === undefined
      ? unknown("DAY_MISSING")
      : { intent: "recommend_along_route", dayIndex };
  }

  const wantsMove = MOVE_VERBS.test(text) || /\bmove\b/i.test(text);
  const wantsAdd = ADD_VERBS.test(text) || /\b(add|put)\b/i.test(text);
  if (!wantsMove && !wantsAdd) return unknown("UNSUPPORTED_INTENT");

  const placeName = parsePlaceName(text);
  const dayIndex = parseDayIndex(text);

  // 동사만 걸리고 장소도 일차도 없으면 애초에 이동·추가 요청이 아니다.
  // `여유롭게 바꿔줘`가 `바꿔` 하나로 이동으로 읽히는데, 여기서 "어떤 장소인가요?"로
  // 되물으면 지원하지도 않는 기능으로 사용자를 끌고 간다 — 못 알아들었다고 말하는 게 맞다.
  if (placeName === undefined && dayIndex === undefined) return unknown("UNSUPPORTED_INTENT");
  if (placeName === undefined) return unknown("PLACE_MISSING");
  // 장소는 읽었으므로 되물을 때 되쓸 수 있게 함께 넘긴다 — 문장은 messages.ts가 만든다
  if (dayIndex === undefined) return unknown("DAY_MISSING", placeName);

  // 이동과 추가가 함께 읽히면 이동으로 본다 — resolver가 일정에 없으면 되묻는다
  const intent = wantsMove ? "move_place" : "add_place";
  const parsed = RawItineraryCommandSchema.safeParse({ intent, placeName, dayIndex });
  return parsed.success ? parsed.data : unknown("PLACE_MISSING");
}

/** 폴백은 문구를 만들지 않는다 — 코드와 조각만 (PR #142 리뷰 2번) */
function unknown(reason: UnknownReason, placeName?: string): RawItineraryCommand {
  return {
    intent: "unknown",
    clarification: { source: "deterministic", reason, ...(placeName ? { placeName } : {}) },
  };
}
