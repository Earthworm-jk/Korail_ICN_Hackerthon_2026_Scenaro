import { describe, expect, it } from "vitest";
import { getCandidatePlaces } from "../actions/places";
import { planItinerary, type PlanRequest } from "../actions/itinerary";
import { RawItineraryCommandSchema } from "../itinerary-command";
import { parseCommand, parseDayIndex, parsePlaceName } from "../itinerary-command-fallback";
import { resolveCommand, type ResolveContext } from "../itinerary-command-resolver";
import {
  changeSummaryOf,
  planRequestFor,
  proposalFor,
  withoutPreference,
} from "../itinerary-command-executor";
import type { ItineraryResult } from "../engine/types";

/**
 * #141 P0-1 명령 계층 — 계약 회귀
 *
 * LLM 없이 도는 경로만 검증한다. 어댑터는 이 PR 범위 밖이고, 발표의 성공 여부는
 * 어차피 이 경로가 보장해야 한다.
 */

const WORK_GOBLIN = "work-goblin";
const YEONGJIN = "place-yeongjin-beach";
const TRIP_DATES = ["2026-08-12", "2026-08-13", "2026-08-14"];

function request(overrides: Partial<PlanRequest> = {}): PlanRequest {
  return {
    arrivalAt: "2026-08-12T10:00:00+09:00",
    departureAt: "2026-08-14T18:00:00+09:00",
    airportReadyAt: "2026-08-12T12:00:00+09:00",
    airportArrivalDeadline: "2026-08-14T16:00:00+09:00",
    selectedActorIds: [],
    selectedWorkIds: [WORK_GOBLIN],
    excludedPlaceIds: [],
    ...overrides,
  };
}

async function planned(overrides: Partial<PlanRequest> = {}) {
  const res = await planItinerary(request(overrides));
  if (!res.ok) throw new Error(`INVALID_REQUEST: ${JSON.stringify(res.fieldErrors)}`);
  return res.result;
}

function context(overrides: Partial<ResolveContext> = {}): ResolveContext {
  return {
    tripDates: TRIP_DATES,
    candidates: [
      { id: YEONGJIN, name: { ko: "영진해변", en: "Yeongjin Beach" } },
      { id: "place-seoullo-7017", name: { ko: "서울로 7017", en: "Seoullo 7017" } },
    ],
    scheduledPlaceIds: new Set(["place-seoullo-7017"]),
    ...overrides,
  };
}

describe("#141 결정적 폴백 파서 — LLM 없이 대표 명령을 읽는다", () => {
  it("대표 문장을 추가 명령으로 읽는다", () => {
    expect(parseCommand("영진해변을 둘째 날 일정에 넣어줘")).toEqual({
      intent: "add_place",
      placeName: "영진해변",
      dayIndex: 2,
    });
  });

  it("`2일차로 옮겨줘`는 이동 명령이다", () => {
    expect(parseCommand("영진해변을 2일차로 옮겨줘")).toEqual({
      intent: "move_place",
      placeName: "영진해변",
      dayIndex: 2,
    });
  });

  it("영어 문장도 같은 명령을 만든다", () => {
    expect(parseCommand("Move Yeongjin Beach to day 2")).toEqual({
      intent: "move_place",
      placeName: "Yeongjin Beach",
      dayIndex: 2,
    });
  });

  it.each([
    ["방금 변경해서 무엇이 달라졌어?", "ko"],
    ["뭐가 바뀌었어", "ko"],
    ["What changed?", "en"],
  ])("변경 설명 요청을 알아본다 (%s)", (input) => {
    expect(parseCommand(input)).toEqual({ intent: "explain_changes" });
  });

  it("일차 표현을 여러 형태로 읽는다", () => {
    expect(parseDayIndex("둘째 날에")).toBe(2);
    expect(parseDayIndex("첫날에 가고 싶어")).toBe(1);
    expect(parseDayIndex("3일차")).toBe(3);
    expect(parseDayIndex("이틀째")).toBe(2);
    expect(parseDayIndex("on day 3")).toBe(3);
    expect(parseDayIndex("third day")).toBe(3);
    expect(parseDayIndex("아무 때나")).toBeUndefined();
  });

  it("일차 표현이 앞에 와도 장소명을 잘라낸다", () => {
    expect(parsePlaceName("둘째 날에 영진해변을 넣어줘")).toBe("영진해변");
  });

  // P0 밖 명령은 추측하지 않는다 — 잘못 해석해 일정을 바꾸는 것이 못 알아듣는 것보다 나쁘다
  it.each([
    ["첫날 일정이 너무 빡빡해. 여유롭게 바꿔줘", "UNSUPPORTED_INTENT"],
    ["영진해변에서 한 시간 더 있고 싶어", "UNSUPPORTED_INTENT"],
    ["둘째 날 동선에 맞는 다른 촬영지를 추천해줘", "UNSUPPORTED_INTENT"],
    ["", "EMPTY_INPUT"],
  ])("지원하지 않는 요청은 재질문 코드로 떨어진다 (%s)", (input, reason) => {
    const command = parseCommand(input);
    expect(command.intent).toBe("unknown");
    if (command.intent === "unknown" && command.clarification.source === "deterministic") {
      expect(command.clarification.reason).toBe(reason);
    }
  });

  it("장소는 알아도 일차를 모르면 코드와 장소명을 함께 준다", () => {
    const command = parseCommand("영진해변을 넣어줘");
    expect(command.intent).toBe("unknown");
    if (command.intent === "unknown" && command.clarification.source === "deterministic") {
      expect(command.clarification.reason).toBe("DAY_MISSING");
      expect(command.clarification.placeName).toBe("영진해변");
    }
  });

  // PR #142 리뷰 2번 — 폴백이 문구를 만들면 영어 입력에 한국어 재질문이 나온다
  it("폴백은 어떤 입력에서도 사람이 읽을 문장을 만들지 않는다", () => {
    for (const input of ["", "아무 말", "영진해변을 넣어줘", "make it lighter"]) {
      const command = parseCommand(input);
      if (command.intent !== "unknown") continue;
      expect(command.clarification.source).toBe("deterministic");
      // 자유 문장을 담는 필드 자체가 없어야 한다 — 있으면 locale 경계를 우회한다
      expect(command.clarification).not.toHaveProperty("question");
    }
  });

  it("파서 출력은 항상 스키마를 통과한다", () => {
    for (const input of ["영진해변을 둘째 날에 넣어줘", "무엇이 달라졌어?", "아무 말"]) {
      expect(RawItineraryCommandSchema.safeParse(parseCommand(input)).success).toBe(true);
    }
  });
});

describe("#141 장소명·여행 일차 결정적 해결", () => {
  it("이름을 카탈로그와 대조해 ID와 날짜를 붙인다", () => {
    const result = resolveCommand(
      { intent: "add_place", placeName: "영진해변", dayIndex: 2 },
      context(),
    );
    expect(result).toEqual({
      ok: true,
      command: { intent: "add_place", placeId: YEONGJIN, targetDate: "2026-08-13" },
    });
  });

  it("영문 이름으로도 같은 장소를 찾는다", () => {
    const result = resolveCommand(
      { intent: "add_place", placeName: "yeongjin beach", dayIndex: 1 },
      context(),
    );
    expect(result.ok && result.command.intent === "add_place" && result.command.placeId)
      .toBe(YEONGJIN);
  });

  it("카탈로그에 없으면 실행하지 않고 되묻는다", () => {
    const result = resolveCommand(
      { intent: "add_place", placeName: "남산타워", dayIndex: 1 },
      context(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.clarification.code).toBe("PLACE_NOT_FOUND");
  });

  it("여러 건이 걸리면 고르게 한다", () => {
    const result = resolveCommand(
      { intent: "add_place", placeName: "해변", dayIndex: 1 },
      context({
        candidates: [
          { id: "a", name: { ko: "영진해변", en: "Yeongjin Beach" } },
          { id: "b", name: { ko: "경포해변", en: "Gyeongpo Beach" } },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok && result.clarification.code === "PLACE_AMBIGUOUS") {
      expect(result.clarification.matches.map(({ id }) => id)).toEqual(["a", "b"]);
    }
  });

  it("여행 기간 밖 일차는 거부한다", () => {
    const result = resolveCommand(
      { intent: "add_place", placeName: "영진해변", dayIndex: 5 },
      context(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok && result.clarification.code === "DAY_OUT_OF_RANGE") {
      expect(result.clarification.tripDayCount).toBe(3);
    }
  });

  // #141 지영님 정정 — baseline에 없는 장소를 "옮겨줘"라고 하면 조용히 추가하지 않는다
  it("`옮겨줘`인데 일정에 없으면 추가할지 되묻고, 확인용 명령을 함께 준다", () => {
    const result = resolveCommand(
      { intent: "move_place", placeName: "영진해변", dayIndex: 2 },
      context(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok && result.clarification.code === "MOVE_TARGET_NOT_SCHEDULED") {
      expect(result.clarification.placeId).toBe(YEONGJIN);
      expect(result.clarification.suggested).toEqual({
        intent: "add_place",
        placeId: YEONGJIN,
        targetDate: "2026-08-13",
      });
    }
  });

  it("`넣어줘`인데 이미 일정에 있으면 이동으로 정규화한다", () => {
    const result = resolveCommand(
      { intent: "add_place", placeName: "서울로 7017", dayIndex: 3 },
      context(),
    );
    // 사용자가 원하는 최종 상태가 같으므로 되물을 이유가 없다
    expect(result.ok && result.command.intent).toBe("move_place");
  });

  it("폴백의 재질문 코드를 그대로 전달한다", () => {
    const result = resolveCommand(
      { intent: "unknown", clarification: { source: "deterministic", reason: "PLACE_MISSING" } },
      context(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok && result.clarification.code === "UNSUPPORTED") {
      expect(result.clarification.detail).toEqual({
        source: "deterministic", reason: "PLACE_MISSING",
      });
    }
  });

  // LLM은 사용자 언어로 직접 되묻는다 — 번역 대상이 아니므로 출처를 구분해 넘긴다
  it("LLM의 자유형 재질문은 출처를 구분해 살려 둔다", () => {
    const result = resolveCommand(
      { intent: "unknown", clarification: { source: "llm", question: "Which beach do you mean?" } },
      context(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok && result.clarification.code === "UNSUPPORTED") {
      expect(result.clarification.detail).toEqual({
        source: "llm", question: "Which beach do you mean?",
      });
    }
  });
});

describe("#141 실행기 — 엔진 입력은 preferredVisitDates 하나다", () => {
  const command = { intent: "add_place" as const, placeId: YEONGJIN, targetDate: "2026-08-13" };

  it("선호 날짜를 넣고 제외 목록에서 뺀다", () => {
    const patched = planRequestFor(command, request({ excludedPlaceIds: [YEONGJIN, "other"] }));
    expect(patched.preferredVisitDates).toEqual({ [YEONGJIN]: "2026-08-13" });
    // 제외가 선호보다 우선이라(#139 7절) 빼 주지 않으면 아무 일도 일어나지 않는다
    expect(patched.excludedPlaceIds).toEqual(["other"]);
  });

  it("기존 선호를 지우지 않는다", () => {
    const patched = planRequestFor(
      command,
      request({ preferredVisitDates: { "place-seoullo-7017": "2026-08-12" } }),
    );
    expect(patched.preferredVisitDates).toEqual({
      "place-seoullo-7017": "2026-08-12",
      [YEONGJIN]: "2026-08-13",
    });
  });

  it("선호만 걷어내는 정리 함수를 제공한다", () => {
    const patched = planRequestFor(command, request());
    expect(withoutPreference(command, patched).preferredVisitDates).toBeUndefined();
  });
});

describe("#141 실행기 판정 — 적용하지 않고 제안한다", () => {
  const command = { intent: "add_place" as const, placeId: "p1", targetDate: "2026-08-13" };

  function result(overrides: Partial<Extract<ItineraryResult, { status: "planned" }>>) {
    return {
      status: "planned",
      days: [],
      rejectedPlaces: [],
      warnings: [],
      selectionGroups: { requested: [], covered: [], uncovered: [] },
      comparisonKeys: {
        selectionGroupCoverageCount: 0,
        selectedUnionPlaceCount: 0,
        activityWarningCount: 0,
        preferredDateMismatchCount: 0,
        totalTravelMinutes: 0,
        transferCount: 0,
        slackSatisfied: true,
      },
      metrics: {
        totalTravelMinutes: 0, totalRailMinutes: 0, transferCount: 0, departureSlackMinutes: 0,
      },
      ...overrides,
    } satisfies ItineraryResult;
  }

  const day = (date: string, placeIds: string[]) => ({
    date,
    items: placeIds.map((placeId) => ({
      placeId, arriveAt: `${date}T01:00:00.000Z`, departAt: `${date}T02:00:00.000Z`, accessMinutes: 10,
    })),
    rides: [],
    regionWindows: [],
  });

  it("요청한 날짜에 들어가고 빠지는 장소가 없으면 바로 적용 가능하다", () => {
    const before = result({ days: [day("2026-08-12", ["p2"])] });
    const after = result({
      days: [day("2026-08-12", ["p2"]), day("2026-08-13", ["p1"])],
      preferredDateOutcomes: [
        { placeId: "p1", requestedDate: "2026-08-13", outcome: "honored" },
      ],
    });
    expect(proposalFor(command, before, after)).toMatchObject({
      decision: "ready",
      scheduledDate: "2026-08-13",
      reasons: [],
      displaced: [],
    });
  });

  it("다른 날짜로 조정되면 확인을 받는다 — 조용히 확정하지 않는다", () => {
    const before = result({ days: [day("2026-08-12", ["p2"])] });
    const after = result({
      days: [day("2026-08-12", ["p2"]), day("2026-08-14", ["p1"])],
      preferredDateOutcomes: [
        {
          placeId: "p1", requestedDate: "2026-08-13", outcome: "adjusted",
          scheduledDate: "2026-08-14",
        },
      ],
    });
    expect(proposalFor(command, before, after)).toMatchObject({
      decision: "needs_confirmation",
      reasons: ["date_adjusted"],
      scheduledDate: "2026-08-14",
    });
  });

  // #141 지영님 지시 — "영진해변을 추가하려면 삼양목장이 제외됩니다. 적용할까요?"
  it("다른 장소를 밀어내면 요청대로 됐어도 확인을 받는다", () => {
    const before = result({ days: [day("2026-08-13", ["p2"])] });
    const after = result({
      days: [day("2026-08-13", ["p1"])],
      rejectedPlaces: [{ code: "DAILY_CAPACITY_EXCEEDED", placeId: "p2" }],
      preferredDateOutcomes: [
        { placeId: "p1", requestedDate: "2026-08-13", outcome: "honored" },
      ],
    });
    const proposal = proposalFor(command, before, after);
    expect(proposal.decision).toBe("needs_confirmation");
    expect(proposal.reasons).toEqual(["places_displaced"]);
    expect(proposal.displaced).toEqual([
      { placeId: "p2", reason: "DAILY_CAPACITY_EXCEEDED" },
    ]);
  });

  it("일정에 못 들어가면 불가로 판정하고 사유를 옮긴다", () => {
    const before = result({ days: [day("2026-08-12", ["p2"])] });
    const after = result({
      days: [day("2026-08-12", ["p2"])],
      rejectedPlaces: [{ code: "TRAIN_UNAVAILABLE", placeId: "p1" }],
      preferredDateOutcomes: [
        { placeId: "p1", requestedDate: "2026-08-13", outcome: "unplaced" },
      ],
    });
    expect(proposalFor(command, before, after)).toMatchObject({
      decision: "impossible",
      rejection: "TRAIN_UNAVAILABLE",
      displaced: [],
    });
  });

  // PR #142 리뷰 1번 — #141 결정문은 "제외나 **날짜 변경**을 조용히 확정하면 안 된다"이다
  it("요청하지 않은 장소의 날짜가 바뀌면 요청대로 됐어도 확인을 받는다", () => {
    const before = result({ days: [day("2026-08-12", ["p2"])] });
    const after = result({
      days: [day("2026-08-13", ["p1", "p2"])],
      preferredDateOutcomes: [
        { placeId: "p1", requestedDate: "2026-08-13", outcome: "honored" },
      ],
    });
    const proposal = proposalFor(command, before, after);
    expect(proposal.decision).toBe("needs_confirmation");
    expect(proposal.reasons).toEqual(["places_moved"]);
    expect(proposal.moved).toEqual([
      { placeId: "p2", fromDate: "2026-08-12", toDate: "2026-08-13" },
    ]);
    expect(proposal.displaced).toEqual([]);
  });

  it("빠짐과 이동이 함께 생기면 둘 다 알린다", () => {
    const before = result({ days: [day("2026-08-12", ["p2", "p3"])] });
    const after = result({
      days: [day("2026-08-13", ["p1", "p2"])],
      rejectedPlaces: [{ code: "DAILY_CAPACITY_EXCEEDED", placeId: "p3" }],
      preferredDateOutcomes: [
        { placeId: "p1", requestedDate: "2026-08-13", outcome: "honored" },
      ],
    });
    const proposal = proposalFor(command, before, after);
    expect(proposal.reasons).toEqual(["places_displaced", "places_moved"]);
    expect(proposal.displaced.map(({ placeId }) => placeId)).toEqual(["p3"]);
    expect(proposal.moved.map(({ placeId }) => placeId)).toEqual(["p2"]);
  });

  it("명령한 장소 자신의 이동은 요청 밖 변화가 아니다", () => {
    const moveCommand = {
      intent: "move_place" as const, placeId: "p1", targetDate: "2026-08-13",
    };
    const before = result({ days: [day("2026-08-12", ["p1"])] });
    const after = result({
      days: [day("2026-08-13", ["p1"])],
      preferredDateOutcomes: [
        { placeId: "p1", requestedDate: "2026-08-13", outcome: "honored" },
      ],
    });
    expect(proposalFor(moveCommand, before, after)).toMatchObject({
      decision: "ready",
      reasons: [],
      moved: [],
    });
  });

  it("명령한 장소 자신은 빠지는 장소로 세지 않는다", () => {
    const before = result({ days: [day("2026-08-12", ["p1"])] });
    const after = result({
      days: [day("2026-08-13", ["p1"])],
      preferredDateOutcomes: [
        { placeId: "p1", requestedDate: "2026-08-13", outcome: "honored" },
      ],
    });
    expect(proposalFor(command, before, after).displaced).toEqual([]);
  });
});

describe("#141 P0-1 수직 — 폴백만으로 대표 명령이 끝까지 간다", () => {
  it("`영진해변을 둘째 날 일정에 넣어줘`가 엔진 재계산을 통과한다", async () => {
    const before = await planned();
    if (before.status !== "planned") throw new Error("기준 일정이 없다");

    // 1) 자연어 → 명령 (LLM 없이)
    const raw = parseCommand("영진해변을 둘째 날 일정에 넣어줘");

    // 2) 명령 → 실제 카탈로그·여행 기간과 대조
    const { candidates } = await getCandidatePlaces({
      selectedActorIds: [], selectedWorkIds: [WORK_GOBLIN],
    });
    const scheduled = new Set(before.days.flatMap((day) => day.items.map((i) => i.placeId)));
    const resolved = resolveCommand(raw, {
      tripDates: TRIP_DATES,
      candidates: candidates.map(({ id, name }) => ({ id, name })),
      scheduledPlaceIds: scheduled,
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok || resolved.command.intent === "explain_changes") return;

    // 3) 검증된 엔진이 전체 재계산
    const after = await planned(planRequestFor(resolved.command, request()));

    // 4) 판정
    const proposal = proposalFor(resolved.command, before, after);
    expect(proposal.placeId).toBe(YEONGJIN);
    expect(proposal.requestedDate).toBe("2026-08-13");
    expect(proposal.decision).not.toBe("impossible");
    expect(proposal.scheduledDate).toBe("2026-08-13");

    // 5) 변경 설명은 실제 diff에서만 나온다 — API 호출 없음
    const summary = changeSummaryOf(before, after);
    expect(summary.changed).toBe(true);
    expect(summary.added.map(({ placeId }) => placeId)).toContain(YEONGJIN);
  });

  it("같은 문장을 두 번 처리하면 같은 결과가 나온다", async () => {
    const command = { intent: "add_place" as const, placeId: YEONGJIN, targetDate: "2026-08-13" };
    const patched = planRequestFor(command, request());
    const first = await planned(patched);
    const second = await planned(patched);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});
