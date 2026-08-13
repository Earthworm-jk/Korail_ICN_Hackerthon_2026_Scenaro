/**
 * 재질문에서 얻은 조각을 다음 발화에 이어 붙인다 (#171 · #84 P0).
 *
 * 지금은 우리가 물어놓고 답을 못 알아듣는다.
 *
 * ```
 * 사용자  영진해변을 옮겨줘
 * AI     며칠째로 옮길까요?
 * 사용자  둘째 날
 * AI     어떤 장소인지 알려주세요     ← 방금 자기가 들은 장소를 잊었다
 * ```
 *
 * 원인은 해석이 **문장 하나만** 보기 때문이다. `DAY_MISSING` 재질문은 이미 `placeName`을
 * 들고 있는데(첫 턴에서 읽었다), 다음 턴이 그걸 쓰지 않는다.
 *
 * ## 왜 대화 로그를 통째로 넘기지 않나
 *
 * 로그를 넘기면 모델이 지난 문장에서 엉뚱한 조각을 끌어와 **엉뚱한 날짜에 적용하고 조용히
 * 성공한다.** 못 알아듣는 것보다 나쁘다. 그래서 넘기는 것은 로그가 아니라 **구조화된 슬롯
 * 몇 칸**이고, 그것도 우리가 직접 물어본 항목만 남긴다.
 *
 * ## 언제 버리는가
 *
 * 슬롯이 남은 채 기준 일정이 바뀌면 "둘째 날"이 다른 일정의 둘째 날에 적용된다. 호출부는
 * `SLOT_INVALIDATING_EVENTS`의 사건마다 반드시 버려야 한다 — 이 목록이 계약이다.
 */
import {
  dayIndicesIn,
  hasBlockingMarker,
  hasCommandVerb,
  hasRemovalVerb,
  parseDayIndex,
} from "./itinerary-command-fallback";
import { RawItineraryCommandSchema, type RawItineraryCommand } from "./itinerary-command";

type SlotIntent = "move_place" | "add_place";

/**
 * 재질문으로 확보해 다음 발화에 이어 붙일 조각.
 *
 * **어느 칸을 물어봤는지가 곧 갈래다** (#197 P0-B). 앞서는 장소를 들고 날짜를 묻는
 * 한 방향뿐이었다. 반대 방향(`둘째 날에 넣어줘` → "어떤 장소인가요?")을 더하면서
 * 두 방향이 서로의 답변을 잘못 받지 않게 `requested`로 갈라 둔다.
 */
export type PendingCommandSlots =
  | { requested: "day"; intent: SlotIntent; placeName: string }
  | { requested: "place"; intent: SlotIntent; dayIndex: number };

/**
 * 슬롯을 버려야 하는 사건 — **계약이다.** 하나라도 빠지면 낡은 슬롯이 살아남아
 * 사용자가 말하지 않은 장소·날짜에 적용된다.
 *
 * 다만 이 목록만으로는 지켜지지 않는다 (PR #175 리뷰 2회차). `alternative_swapped`가
 * 여기 있는데도 `chooseAlternative`가 피드백을 비우지 않아 조각이 되살아났다 — 목록은
 * 사람이 지키는 것이고 사람은 빠뜨린다.
 *
 * 방어는 두 겹이고 **각자 잡는 것이 다르다** (PR #175 리뷰 3회차).
 *
 * - `itineraryBasisKey` — 계산에 들어가는 **값**이 바뀌면 조각을 쓰지 않는다. 요청을
 *   구조적으로 훑으므로 새 입력이 생겨도 들어온다
 * - 이 목록의 명시적 폐기 — 값이 **같은 값으로 돌아오는 왕복**(대안을 골랐다 되돌리기,
 *   시각을 바꿨다 되돌리기)은 지문으로 못 가른다. 그 경로는 사건 자체로 끊는 여기가 맡는다
 *
 * 어느 한쪽도 혼자서는 충분하지 않다.
 */
export const SLOT_INVALIDATING_EVENTS = [
  "proposal_applied", // 제안을 적용했다
  "proposal_cancelled", // 제안을 취소했다
  "selection_changed", // 후보 카드를 토글했다
  "itinerary_recalculated", // 기준 일정이 다시 계산됐다
  "alternative_swapped", // 공항 진입·열차 대안을 바꿨다
] as const;

/**
 * **패널을 닫는 것은 여기 없다** (PR #175 리뷰).
 *
 * `closeAiPanel`은 "표시를 숨길 뿐 작업 상태를 버리지 않는다"가 기존 결정이다 — 지우면
 * 다시 열었을 때 최근 결과와 실행 취소가 사라진다. 닫았다 열면 같은 재질문이 그대로
 * 보이므로 조각도 유효하다. **목록과 구현이 어긋나지 않도록 목록에서 뺀다.**
 */

export type SlotInvalidatingEvent = (typeof SLOT_INVALIDATING_EVENTS)[number];

/**
 * 이번 응답이 재질문이라면 다음 턴에 이어 붙일 조각을 남긴다.
 *
 * **우리가 물어본 것만 남긴다.** 물어보지 않은 칸을 들고 있으면 다음 발화의 엉뚱한
 * 조각과 합쳐진다.
 *
 * `PLACE_MISSING`에는 남길 것이 없다던 앞선 판단(PR #175)을 **뒤집는다** (#197 P0-B).
 * 근거는 "다음 문장이 장소를 주면 그때 온전히 읽힌다"였는데, 실제로는 `영진해변`처럼
 * 이름만 온 답변에 동사가 없어 아무것도 읽히지 않는다 — 되물어 놓고 답을 못 받았다.
 *
 * 슬롯 생성은 폴백 경로 한정이다. LLM 경로의 슬롯 생성 동등성은 `ModelOutputSchema`의
 * 누락 슬롯 계약과 함께 제출 후로 둔다 (#197 결정).
 */
export function pendingSlotsFrom(raw: RawItineraryCommand): PendingCommandSlots | null {
  if (raw.intent !== "unknown") return null;
  if (raw.clarification.source !== "deterministic") return null;

  const { placeName, dayIndex, intent } = raw.clarification;
  if (intent === undefined) return null;

  if (raw.clarification.reason === "DAY_MISSING") {
    return placeName === undefined ? null : { requested: "day", intent, placeName };
  }
  if (raw.clarification.reason === "PLACE_MISSING") {
    return dayIndex === undefined ? null : { requested: "place", intent, dayIndex };
  }
  return null;
}

/**
 * 이번 발화가 **날짜 답변 하나뿐인가** (PR #175 리뷰).
 *
 * 조각을 이어 붙이는 조건은 이것 하나로 판정해야 한다. 재질문 사유 코드로는 못 가른다 —
 * 실제 파서 출력을 보면 둘이 같은 코드다.
 *
 * ```
 * "둘째 날"              -> UNSUPPORTED_INTENT   (이어 붙여야 하는 답변)
 * "둘째 날 일정 설명해줘"  -> UNSUPPORTED_INTENT   (이어 붙이면 안 되는 새 요청)
 * ```
 *
 * 날짜 표현과 뒤에 붙는 조사·존댓말만 남기고 지웠을 때 아무것도 안 남아야 답변이다.
 * 조금이라도 다른 말이 섞이면 그건 사용자가 다른 것을 요청한 것이고, 거기에 옛 장소를
 * 붙이면 **말하지 않은 장소가 조용히 적용된다.**
 */
/**
 * 날짜 뒤에 붙을 수 있는 조사·존댓말 (PR #175 리뷰 6회차).
 *
 * 앞서는 문자 클래스 하나로 지웠는데, 그러면 허용 목록이 **글자 단위로 흩어져** 무엇을
 * 받는지 읽히지 않고 `이에요` 같은 조합이 조용히 빠진다. 뒤에서부터 통째로 떼어내
 * **허용 목록이 곧 계약**이 되게 한다.
 *
 * 긴 것부터 본다 — `이요`를 먼저 떼면 `이에요`가 `에`만 남는다.
 */
const ANSWER_SUFFIXES = [
  "이에요", "예요", "입니다", "이요", "으로", "에서", "이야",
  "요", "에", "로", "야", "please",
];

function stripAnswerSuffixes(text: string): string {
  let rest = text;
  for (let changed = true; changed; ) {
    changed = false;
    for (const suffix of ANSWER_SUFFIXES) {
      if (rest.toLowerCase().endsWith(suffix)) {
        rest = rest.slice(0, rest.length - suffix.length);
        changed = true;
        break;
      }
    }
  }
  return rest;
}

/**
 * 이번 발화가 **장소 답변 하나뿐인가** (#197 P0-B).
 *
 * `dayOnlyAnswer`를 그대로 옮겨올 수 없다. 날짜는 닫힌 집합이라 "표현을 지우고 남은 게
 * 없으면 답변"으로 가를 수 있지만, 장소 이름은 열린 집합이라 지울 목록을 만들 수 없다.
 * 그래서 반대로 **답변일 수 없는 신호**를 찾는다.
 *
 * 이 게이트가 없으면 PR #175가 여섯 차례 리뷰로 막은 오염이 장소 방향에서 되살아난다.
 * resolver의 이름 대조는 역방향 포함 일치(`needle.includes(name)`)라 문장 안에 카탈로그
 * 이름이 있으면 잡아내고, 일정에 이미 있는 장소면 `add`가 `move`로 확정되기까지 한다.
 *
 * ```
 * "아니야 그냥 광화문 빼줘"   -> 게이트 없으면 move_place 광화문  (빼달라는데 옮긴다)
 * "광화문 일정 설명해줘"     -> 게이트 없으면 move_place 광화문  (설명 요청인데 옮긴다)
 * ```
 *
 * 되물은 칸에 답만 온 게 아니면 합치지 않는다 — 사용자의 새 발화는 새 요청으로 흘려보내고
 * 파서가 스스로 읽게 둔다.
 */
const NON_ANSWER_MARKERS = /(설명|알려|추천|어때|보여|왜|어디|언제)/;

/** 이름처럼 보이는 덩어리의 상한 — 이보다 길면 문장이지 답변이 아니다 */
const MAX_ANSWER_WORDS = 4;
const MAX_ANSWER_CHARS = 40;

export function placeOnlyAnswer(sentence: string): string | undefined {
  // 부정·취소·대조가 섞였으면 답변이 아니다 — 파서 진입부와 같은 판정을 쓴다
  if (hasBlockingMarker(sentence)) return undefined;
  // 동사가 있으면 스스로 읽히는 새 명령이다
  if (hasCommandVerb(sentence)) return undefined;
  /**
   * 제거·교체 요청은 장소 이름이 들어 있어도 답변이 아니다 (PR #200 리뷰).
   *
   * `광화문 빼줘`는 부정 표지도 추가·이동 동사도 없어 위 두 검사를 통과했고, 문장 전체가
   * 장소명이 되어 `add_place`로 합쳐졌다. 빼달라는 요청이 추가가 되는 건 못 알아듣는 것보다
   * 나쁘다 — 지원 범위 밖이라고 말하고 파서가 새 발화로 읽게 둔다.
   */
  if (hasRemovalVerb(sentence)) return undefined;
  // 설명·추천 요청은 장소 이름이 들어 있어도 답변이 아니다
  if (NON_ANSWER_MARKERS.test(sentence)) return undefined;
  // 날짜가 섞였으면 우리가 물어본 칸의 답이 아니다
  if (dayIndicesIn(sentence).length > 0) return undefined;

  const stripped = stripAnswerSuffixes(
    sentence.trim().replace(/[.!?~,·]+$/g, "").trim(),
  ).trim();
  if (stripped === "") return undefined;
  if (stripped.length > MAX_ANSWER_CHARS) return undefined;
  if (stripped.split(/\s+/).length > MAX_ANSWER_WORDS) return undefined;

  return stripped;
}

export function dayOnlyAnswer(sentence: string): number | undefined {
  const dayIndex = parseDayIndex(sentence);
  if (dayIndex === undefined) return undefined;

  const withoutDate = sentence
    .replace(/\d+\s*(?:일\s*차|일째|번째\s*날)/g, "")
    .replace(/day\s*\d+/gi, "")
    .replace(/(?:첫|둘|셋|넷|다섯|여섯|일곱|여덟|아홉|열)(?:째)?\s*날/g, "")
    .replace(/(?:하루|이틀|사흘|나흘|닷새|엿새|이레|여드레|아흐레|열흘)째/g, "")
    .replace(/\b(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+day\b/gi, "")
    .replace(/[\s.!?~,·]/g, "");

  return stripAnswerSuffixes(withoutDate).length === 0 ? dayIndex : undefined;
}

/**
 * 남겨둔 조각과 이번 문장을 합쳐 완성된 명령을 만든다.
 *
 * 합치는 조건은 둘 다여야 한다.
 *
 * 1. **이번 해석이 실패했다** — 이번 문장만으로 읽혔다면 그것이 사용자의 새 요청이다.
 *    "영진해변 옮겨줘" 뒤에 "월정사를 셋째 날에 넣어줘"라고 하면 월정사 요청이어야 한다
 * 2. **이번 발화가 날짜 답변뿐이다** (PR #175 리뷰) — 앞의 조건만으로는 부족하다.
 *    "둘째 날 일정 설명해줘"처럼 날짜가 섞인 **다른** 요청도 해석에 실패하는데, 그때
 *    옛 장소를 붙이면 사용자가 말하지 않은 이동이 조용히 성공한다
 *
 * LLM 경로와 폴백 경로 어느 쪽으로 해석했든 여기서 합친다. 판정 기준이 사유 코드가 아니라
 * **발화 모양**이므로 출처와 무관하게 같은 답이 나온다 — 키가 있을 때만 되는 기능이 아니다.
 */
export function completeWithSlots(
  slots: PendingCommandSlots | null,
  raw: RawItineraryCommand,
  sentence: string,
): RawItineraryCommand {
  if (slots === null) return raw;
  if (raw.intent !== "unknown") return raw;

  if (slots.requested === "day") {
    const dayIndex = dayOnlyAnswer(sentence);
    if (dayIndex === undefined) return raw;
    return { intent: slots.intent, placeName: slots.placeName, dayIndex };
  }

  const placeName = placeOnlyAnswer(sentence);
  if (placeName === undefined) return raw;

  // 이름은 사용자 문장을 그대로 옮긴 것이라 길이·공백 계약을 한 번 지난다
  const parsed = RawItineraryCommandSchema.safeParse({
    intent: slots.intent,
    placeName,
    dayIndex: slots.dayIndex,
  });
  return parsed.success ? parsed.data : raw;
}
