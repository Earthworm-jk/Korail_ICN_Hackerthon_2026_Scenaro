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
 */
export const SLOT_INVALIDATING_EVENTS = [
  "proposal_applied", // 제안을 적용했다
  "proposal_cancelled", // 제안을 취소했다
  "selection_changed", // 후보 카드를 토글했다
  "itinerary_recalculated", // 기준 일정이 다시 계산됐다
  "alternative_swapped", // 공항 진입·열차 대안을 바꿨다
  "panel_closed", // 패널을 닫았다
] as const;

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
 * 남겨둔 조각과 이번 문장을 합쳐 완성된 명령을 만든다.
 *
 * 합치는 것은 **이번 해석이 실패했을 때뿐**이다. 이번 문장만으로 읽혔다면 그것이 사용자의
 * 새 요청이므로 옛 슬롯이 끼어들면 안 된다 — "영진해변 옮겨줘" 뒤에 "월정사를 셋째 날에
 * 넣어줘"라고 하면 월정사 요청이어야 한다.
 *
 * LLM 경로와 폴백 경로 어느 쪽으로 해석했든 여기서 합친다. 모델에게 슬롯을 미리 주지 않는
 * 이유는 위와 같다 — 조각을 어디에 쓸지는 우리가 정한다.
 */
export function completeWithSlots(
  slots: PendingCommandSlots | null,
  raw: RawItineraryCommand,
  sentence: string,
): RawItineraryCommand {
  if (slots === null) return raw;
  if (raw.intent !== "unknown") return raw;

  const dayIndex = parseDayIndex(sentence);
  if (dayIndex === undefined) return raw;

  return { intent: slots.intent, placeName: slots.placeName, dayIndex };
}
