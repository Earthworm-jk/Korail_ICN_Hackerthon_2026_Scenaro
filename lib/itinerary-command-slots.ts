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
import { parseDayIndex } from "./itinerary-command-fallback";
import type { RawItineraryCommand } from "./itinerary-command";

/** 재질문으로 확보해 다음 발화에 이어 붙일 조각 */
export type PendingCommandSlots = {
  intent: "move_place" | "add_place";
  placeName: string;
};

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
 * - `itineraryBasisKey` — 계산에 들어가는 값이 바뀌면 조각을 쓰지 않는다. 항공 시각·공항
 *   마감처럼 이 목록에 없는 입력까지 자동으로 걸린다. 비우는 것을 빠뜨려도 막힌다
 * - 이 목록의 명시적 폐기 — **기준이 똑같은 값으로 돌아오는 왕복**(대안을 골랐다 그대로
 *   되돌리기)은 기준만으로 못 가른다. 그 경로는 여기가 맡는다
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
 * **우리가 물어본 것만 남긴다.** `PLACE_MISSING`(장소를 못 읽음)에는 남길 것이 없다 —
 * 날짜만 들고 있어 봐야 다음 문장이 장소를 주면 그때 온전히 읽힌다. 반대로 `DAY_MISSING`은
 * 장소를 이미 읽었으므로 그것을 남긴다.
 */
export function pendingSlotsFrom(raw: RawItineraryCommand): PendingCommandSlots | null {
  if (raw.intent !== "unknown") return null;
  if (raw.clarification.source !== "deterministic") return null;
  if (raw.clarification.reason !== "DAY_MISSING") return null;

  const { placeName, intent } = raw.clarification;
  if (placeName === undefined || intent === undefined) return null;
  return { intent, placeName };
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
export function dayOnlyAnswer(sentence: string): number | undefined {
  const dayIndex = parseDayIndex(sentence);
  if (dayIndex === undefined) return undefined;

  const rest = sentence
    .replace(/\d+\s*(?:일\s*차|일째|번째\s*날)/g, "")
    .replace(/day\s*\d+/gi, "")
    .replace(/(?:첫|둘|셋|넷|다섯|여섯|일곱|여덟|아홉|열)(?:째)?\s*날/g, "")
    .replace(/(?:하루|이틀|사흘|나흘|닷새|엿새|이레|여드레|아흐레|열흘)째/g, "")
    .replace(/\b(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+day\b/gi, "")
    // 남는 조사·존댓말·구두점만 허용한다
    .replace(/[에서로으요\s.!?~,·]|입니다|이요|please/gi, "")
    .trim();

  return rest.length === 0 ? dayIndex : undefined;
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

  const dayIndex = dayOnlyAnswer(sentence);
  if (dayIndex === undefined) return raw;

  return { intent: slots.intent, placeName: slots.placeName, dayIndex };
}
