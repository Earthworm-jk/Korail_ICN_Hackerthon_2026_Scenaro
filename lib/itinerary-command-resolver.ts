/**
 * 장소명·여행 일차 결정적 해결 (#141 P0-1, 구현 순서 3번)
 *
 * **LLM은 장소 ID도 날짜도 만들지 않는다.** 사람이 말한 이름과 "둘째 날"까지만 내놓고,
 * 실제 카탈로그·여행 기간과의 대조는 전부 여기서 한다. 0건이거나 여러 건이면 실행하지
 * 않고 재질문한다 — #141 안전 경계의 "장소명은 현재 검증 카탈로그와 대조하고
 * 0건/복수 건이면 재질문한다"가 이 모듈이다.
 *
 * 결과 문구는 만들지 않고 **코드만** 돌려준다. ko/en 문구는 레인 A(`messages.ts`)가 붙인다.
 */
import type { LocalizedName } from "./saved-itineraries-stub";
import type {
  ItineraryCommand,
  RawItineraryCommand,
  UnknownClarification,
} from "./itinerary-command";

export type CommandCatalogEntry = {
  id: string;
  name: LocalizedName;
};

export type ResolveContext = {
  /** 여행 가능 날짜(KST) 오름차순 — dayIndex 1이 tripDates[0] */
  tripDates: readonly string[];
  /** 현재 엄격 후보 전체. 선택 해제된 것도 포함한다 — "넣어줘"의 대상이기 때문이다 */
  candidates: readonly CommandCatalogEntry[];
  /** 지금 일정에 실제로 배치된 장소 — move와 add를 가르는 기준 */
  scheduledPlaceIds: ReadonlySet<string>;
};

/**
 * 실행하지 않고 되물어야 하는 이유.
 *
 * 문구가 아니라 코드다. 화면이 ko/en으로 옮기고, 원인을 증명할 수 없는 인과는 붙이지 않는다.
 */
export type Clarification =
  /** 카탈로그에 없는 이름 */
  | { code: "PLACE_NOT_FOUND"; query: string }
  /** 같은 이름에 여러 후보가 걸렸다 — 화면이 고르게 한다 */
  | { code: "PLACE_AMBIGUOUS"; query: string; matches: CommandCatalogEntry[] }
  /** 여행 기간 밖 일차 */
  | { code: "DAY_OUT_OF_RANGE"; dayIndex: number; tripDayCount: number }
  /**
   * "옮겨줘"인데 그 장소가 지금 일정에 없다 (#141 지영님 정정).
   *
   * 조용히 추가하지 않는다. 대신 곧바로 확인할 수 있게 **추가 명령을 함께 실어 준다** —
   * 화면은 "현재 일정에 없습니다. 둘째 날에 추가할까요?"를 한 번의 확인으로 처리한다.
   */
  | { code: "MOVE_TARGET_NOT_SCHEDULED"; placeId: string; suggested: ItineraryCommand }
  /**
   * 해석기가 스스로 모르겠다고 한 경우 — 그대로 통과시킨다.
   *
   * `detail.source`로 폴백(코드)과 LLM(자유 문장)을 구분한다. 폴백이면 `messages.ts`가
   * 문장을 만들고, LLM이면 이미 사용자 언어로 되물은 문장이라 그대로 쓴다.
   */
  | { code: "UNSUPPORTED"; detail: UnknownClarification };

export type ResolveResult =
  | { ok: true; command: ItineraryCommand }
  | { ok: false; clarification: Clarification };

/**
 * 이름 비교용 정규화.
 *
 * 공백·구두점을 지우고 소문자로 만든다. 한국어는 조사가 붙어 오는 일이 잦아
 * 폴백 파서가 이미 떼고 넘기지만, 여기서도 정확 일치를 먼저 보고 포함 일치로 내려간다.
 */
function normalize(value: string): string {
  return value.toLowerCase().replace(/[\s·・.,'"()\-_]/g, "");
}

function matchPlaces(
  query: string,
  candidates: readonly CommandCatalogEntry[],
): CommandCatalogEntry[] {
  const needle = normalize(query);
  if (needle === "") return [];

  const namesOf = (entry: CommandCatalogEntry) => [entry.name.ko, entry.name.en].map(normalize);

  // 1) 정확 일치가 하나라도 있으면 그것만 본다 — 포함 일치가 끼어들어 모호해지지 않게
  const exact = candidates.filter((entry) => namesOf(entry).includes(needle));
  if (exact.length > 0) return exact;

  // 2) 포함 일치. 사용자가 "영진해변"처럼 짧게 부르거나 정식 명칭 일부만 말하는 경우
  return candidates.filter((entry) =>
    namesOf(entry).some((name) => name.includes(needle) || needle.includes(name)));
}

/** 여행 일차(1부터) → KST 날짜. 범위 밖이면 undefined */
function dateOfDayIndex(tripDates: readonly string[], dayIndex: number): string | undefined {
  return tripDates[dayIndex - 1];
}

/**
 * 해석기 출력을 실행 가능한 명령으로 확정한다.
 *
 * 실패는 예외가 아니라 재질문이다 — 이 계층에서 throw하면 화면이 "AI가 죽었다"로 보인다.
 */
export function resolveCommand(
  raw: RawItineraryCommand,
  context: ResolveContext,
): ResolveResult {
  if (raw.intent === "explain_changes") {
    return { ok: true, command: { intent: "explain_changes" } };
  }
  if (raw.intent === "unknown") {
    return { ok: false, clarification: { code: "UNSUPPORTED", detail: raw.clarification } };
  }

  if (raw.intent === "recommend_along_route") {
    const targetDate = dateOfDayIndex(context.tripDates, raw.dayIndex);
    return targetDate === undefined
      ? {
        ok: false,
        clarification: {
          code: "DAY_OUT_OF_RANGE",
          dayIndex: raw.dayIndex,
          tripDayCount: context.tripDates.length,
        },
      }
      : { ok: true, command: { intent: "recommend_along_route", targetDate } };
  }

  if (raw.intent === "limit_places") {
    /**
     * 이름을 장소 ID로 푼다 (#171 6번). 못 찾거나 여러 곳에 걸리면 **되묻는다** —
     * 사용자가 "꼭"이라고 한 장소를 우리가 임의로 고르면 그건 약속을 무르는 것이다.
     */
    const pinnedPlaceIds: string[] = [];
    for (const name of raw.pinnedPlaceNames ?? []) {
      const found = matchPlaces(name, context.candidates);
      if (found.length === 0) {
        return { ok: false, clarification: { code: "PLACE_NOT_FOUND", query: name } };
      }
      if (found.length > 1) {
        return {
          ok: false,
          clarification: { code: "PLACE_AMBIGUOUS", query: name, matches: found },
        };
      }
      if (!pinnedPlaceIds.includes(found[0].id)) pinnedPlaceIds.push(found[0].id);
    }
    return {
      ok: true,
      command: {
        intent: "limit_places",
        targetPlaceCount: raw.targetPlaceCount,
        pinnedPlaceIds,
      },
    };
  }

  const matches = matchPlaces(raw.placeName, context.candidates);
  if (matches.length === 0) {
    return { ok: false, clarification: { code: "PLACE_NOT_FOUND", query: raw.placeName } };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      clarification: { code: "PLACE_AMBIGUOUS", query: raw.placeName, matches },
    };
  }

  const targetDate = dateOfDayIndex(context.tripDates, raw.dayIndex);
  if (targetDate === undefined) {
    return {
      ok: false,
      clarification: {
        code: "DAY_OUT_OF_RANGE",
        dayIndex: raw.dayIndex,
        tripDayCount: context.tripDates.length,
      },
    };
  }

  const placeId = matches[0].id;

  // "옮겨줘"인데 일정에 없으면 추가로 갈아타지 않고 되묻는다 (#141 지영님 정정).
  // 반대로 "넣어줘"인데 이미 일정에 있으면 이동으로 읽는 것이 자연스럽다 —
  // 사용자가 원하는 최종 상태(그 날짜에 있다)가 같고, 되물을 이유가 없다.
  if (raw.intent === "move_place" && !context.scheduledPlaceIds.has(placeId)) {
    return {
      ok: false,
      clarification: {
        code: "MOVE_TARGET_NOT_SCHEDULED",
        placeId,
        suggested: { intent: "add_place", placeId, targetDate },
      },
    };
  }

  const intent = context.scheduledPlaceIds.has(placeId) ? "move_place" : "add_place";
  return { ok: true, command: { intent, placeId, targetDate } };
}
