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
 * 되물어야 하는 이유 — **결정적 폴백이 만드는 코드다.**
 *
 * 폴백은 문구를 만들지 않는다. 만들면 영어 입력에 한국어 재질문이 나오고 레인 A가
 * locale에 맞게 옮길 수 없다(PR #142 리뷰 2번). 코드와 필요한 조각만 내놓고
 * 문장은 `messages.ts`가 만든다.
 */
export const UnknownReasonSchema = z.enum([
  "EMPTY_INPUT", // 빈 입력
  "UNSUPPORTED_INTENT", // 옮기기·넣기·변경 설명이 아님
  "PLACE_MISSING", // 어떤 장소인지 못 읽음
  "DAY_MISSING", // 며칠째인지 못 읽음 — placeName은 읽었을 수 있다
]);

export type UnknownReason = z.infer<typeof UnknownReasonSchema>;

/**
 * `unknown`의 두 출처를 구분한다.
 *
 * - `deterministic` — 폴백 파서. 코드만 주고 문구는 `messages.ts`가 만든다
 * - `llm` — 해석기가 사용자의 언어로 직접 되묻는 자유 문장. #141 본문이 요구하는
 *   "명확한 재질문"이라 살려 두되, **출처를 구분해** 레인 A가 번역 대상인지 아닌지 안다
 */
export const UnknownClarificationSchema = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("deterministic"),
    reason: UnknownReasonSchema,
    /** `DAY_MISSING`처럼 문장에 되쓸 조각이 있으면 함께 준다 */
    placeName: PlaceNameSchema.optional(),
    /**
     * `PLACE_MISSING`에서 이미 읽은 일차 (#197 P0-B).
     *
     * 앞서는 이 조각을 버렸다. "둘째 날에 넣어줘"의 `2`를 버리고 되물으면, 사용자가
     * "영진해변"이라고 답할 때 그 문장만으로는 동사가 없어 아무것도 읽히지 않는다 —
     * 되물어 놓고 답을 못 받는 셈이었다.
     */
    dayIndex: DayIndexSchema.optional(),
    /**
     * 옮기기인지 넣기인지 (#171). 되물을 때는 문구가 같아도 다음 턴에 완성할 명령이 다르다 —
     * 이 조각이 없으면 "넣어줘"라고 한 요청이 옮기기로 완성된다.
     */
    intent: z.enum(["move_place", "add_place"]).optional(),
  }),
  z.object({
    source: z.literal("llm"),
    question: z.string().trim().min(1).max(300),
  }),
]);

export type UnknownClarification = z.infer<typeof UnknownClarificationSchema>;

/**
 * 해석기 출력 — 허용 enum과 스키마를 통과해야만 실행기로 간다.
 *
 * P0는 방문일 조율·동선 추천·변경 설명이다. 나머지 4종(`extend_stay`·`add_free_time`·
 * `make_day_lighter`·`adjust_airport_buffer`)은 **엔진 입력이 아직 없어**
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
  /**
   * "7곳만 남겨줘" — 개수 목표와 꼭 지킬 장소 (#171 6번).
   *
   * 엔진 입력은 늘리지 않는다. 후보 제외안을 만들어 **기존 `excludedPlaceIds`로 다시
   * 계산**하고, 어느 안이 나은지는 기존 사전식 비교가 정한다 (#179).
   */
  z.object({
    intent: z.literal("limit_places"),
    targetPlaceCount: z.number().int().min(1).max(50),
    pinnedPlaceNames: z.array(PlaceNameSchema).max(5).optional(),
  }),
  z.object({ intent: z.literal("explain_changes") }),
  z.object({
    intent: z.literal("recommend_along_route"),
    dayIndex: DayIndexSchema,
  }),
  z.object({
    intent: z.literal("unknown"),
    // 지원하지 않는 요청은 조용히 삼키지 않는다 — 무엇을 물어야 하는지 함께 내놓는다
    clarification: UnknownClarificationSchema,
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
  z.object({
    intent: z.literal("recommend_along_route"),
    targetDate: KstDateSchema,
  }),
  /** 이름은 여기서 이미 장소 ID로 풀렸다 — 못 찾으면 resolver 가 되묻는다 */
  z.object({
    intent: z.literal("limit_places"),
    targetPlaceCount: z.number().int().min(1).max(50),
    pinnedPlaceIds: z.array(z.string().min(1)).max(5),
  }),
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

export type RouteRecommendationCommand = Extract<
  ItineraryCommand,
  { intent: "recommend_along_route" }
>;
