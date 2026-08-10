/**
 * 일정 조율 명령 계약 (#141 P0-1)
 *
 * 자연어·버튼·드래그가 **각각 다른 엔진 입력을 만들지 않게** 하는 단일 계약이다.
 * 세 UI가 모두 이 명령을 만들고, 실행기 하나가 `PlanRequest` 패치로 옮긴다.
 *
 * 두 층으로 나눈다.
 *
 * - `RawItineraryCommand` — 해석기(LLM 또는 결정적 폴백)가 내놓는 것. **장소명과 여행 일차**
 * - `ItineraryCommand` — resolver가 실제 카탈로그·여행 기간과 대조해 확정한 것. **장소 ID와 날짜**
 *
 * 이 경계가 #141 안전 계약의 핵심이다. LLM은 장소 ID도 날짜도 만들지 않는다 —
 * 사람이 말한 이름과 "둘째 날"까지만 내놓고, ID와 KST 날짜는 결정적 코드가 붙인다.
 */
import { z } from "zod";

/** 여행 일차는 1부터 센다 — "첫째 날"이 1이다 */
export const MIN_DAY_INDEX = 1;

const PlaceNameSchema = z.string().trim().min(1).max(100);
const DayIndexSchema = z.number().int().min(MIN_DAY_INDEX).max(30);
const KstDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD여야 합니다");

/**
 * 해석기 출력 — 허용 enum과 스키마를 통과해야만 실행기로 간다.
 *
 * P0는 4종이다. 본문 9종 중 나머지 5종(`extend_stay`·`add_free_time`·`make_day_lighter`·
 * `recommend_along_route`·`adjust_airport_buffer`)은 **엔진 입력이 없거나 P0-7이라**
 * `unknown` + 재질문으로 떨어뜨린다. 입력이 생기면 그때 union에 넣는다 —
 * 실행할 수 없는 명령을 계약에 두면 해석기는 만들어 내는데 실행기가 못 받는다.
 */
export const RawItineraryCommandSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("move_place"),
    placeName: PlaceNameSchema,
    dayIndex: DayIndexSchema,
  }),
  z.object({
    intent: z.literal("add_place"),
    placeName: PlaceNameSchema,
    dayIndex: DayIndexSchema,
  }),
  z.object({ intent: z.literal("explain_changes") }),
  z.object({
    intent: z.literal("unknown"),
    // 지원하지 않는 요청은 조용히 삼키지 않는다 — 무엇을 물어야 하는지 함께 내놓는다
    clarificationQuestion: z.string().trim().min(1).max(300),
  }),
]);

export type RawItineraryCommand = z.infer<typeof RawItineraryCommandSchema>;

/** resolver를 통과한 명령 — 장소 ID와 KST 날짜가 붙었다 */
export const ItineraryCommandSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("move_place"),
    placeId: z.string().min(1),
    targetDate: KstDateSchema,
  }),
  z.object({
    intent: z.literal("add_place"),
    placeId: z.string().min(1),
    targetDate: KstDateSchema,
  }),
  z.object({ intent: z.literal("explain_changes") }),
]);

export type ItineraryCommand = z.infer<typeof ItineraryCommandSchema>;

/** 방문일을 바꾸는 명령 — `preferredVisitDates`로 내려가는 둘 */
export type VisitDateCommand = Extract<
  ItineraryCommand,
  { intent: "move_place" | "add_place" }
>;

export function isVisitDateCommand(command: ItineraryCommand): command is VisitDateCommand {
  return command.intent === "move_place" || command.intent === "add_place";
}
