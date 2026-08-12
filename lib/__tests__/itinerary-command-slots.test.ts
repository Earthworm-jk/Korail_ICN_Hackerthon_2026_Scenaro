import { describe, expect, it } from "vitest";

import { parseCommand } from "@/lib/itinerary-command-fallback";
import {
  SLOT_INVALIDATING_EVENTS,
  completeWithSlots,
  dayOnlyAnswer,
  pendingSlotsFrom,
  type PendingCommandSlots,
} from "@/lib/itinerary-command-slots";
import { itineraryBasisKey, pendingSlotsOf } from "@/lib/itinerary-command-ui";
import type { RawItineraryCommand } from "@/lib/itinerary-command";

/**
 * 재질문 연속성 (#171).
 *
 * 지금은 우리가 물어놓고 답을 못 알아듣는다 — 그게 이 파일이 막는 것이다.
 *
 * ```
 * 영진해변을 옮겨줘  →  며칠째로 옮길까요?
 * 둘째 날            →  어떤 장소인지 알려주세요   ← 방금 들은 장소를 잊었다
 * ```
 */

describe("재질문 조각 잇기", () => {
  /** 이 테스트가 재란님이 보고한 대화를 그대로 재현한다 */
  describe("보고된 대화", () => {
    const firstTurn = parseCommand("영진해변을 옮겨줘");

    it("첫 턴은 날짜를 되묻되 장소는 이미 읽는다", () => {
      expect(firstTurn.intent).toBe("unknown");
      if (firstTurn.intent !== "unknown") return;
      expect(firstTurn.clarification.source).toBe("deterministic");
      if (firstTurn.clarification.source !== "deterministic") return;
      expect(firstTurn.clarification.reason).toBe("DAY_MISSING");
      expect(firstTurn.clarification.placeName).toBe("영진해변");
    });

    it("둘째 날만 말하면 지금은 아무것도 못 읽는다 — 그래서 잇는다", () => {
      const secondTurn = parseCommand("둘째 날");
      expect(secondTurn.intent).toBe("unknown");
    });

    it("조각을 이으면 완성된 명령이 된다", () => {
      const slots = pendingSlotsFrom(firstTurn);
      expect(slots).toEqual({ intent: "move_place", placeName: "영진해변" });

      const merged = completeWithSlots(slots, parseCommand("둘째 날"), "둘째 날");
      expect(merged).toEqual({ intent: "move_place", placeName: "영진해변", dayIndex: 2 });
    });
  });

  describe("무엇을 기억하는가", () => {
    it("날짜를 되물었을 때만 기억한다", () => {
      expect(pendingSlotsFrom(parseCommand("영진해변을 옮겨줘"))).not.toBeNull();
    });

    /** 장소를 못 읽은 재질문에는 남길 것이 없다 — 다음 문장이 장소를 주면 그때 온전히 읽힌다 */
    it("장소를 못 읽은 재질문은 기억하지 않는다", () => {
      const raw: RawItineraryCommand = {
        intent: "unknown",
        clarification: { source: "deterministic", reason: "PLACE_MISSING" },
      };
      expect(pendingSlotsFrom(raw)).toBeNull();
    });

    it("완성된 명령은 기억할 것이 없다", () => {
      expect(pendingSlotsFrom(parseCommand("영진해변을 둘째 날에 넣어줘"))).toBeNull();
    });

    /** LLM 이 자유 문장으로 되물은 경우는 조각이 구조화돼 있지 않다 */
    it("LLM 자유 재질문은 기억하지 않는다", () => {
      const raw: RawItineraryCommand = {
        intent: "unknown",
        clarification: { source: "llm", question: "며칠째로 옮길까요?" },
      };
      expect(pendingSlotsFrom(raw)).toBeNull();
    });
  });

  describe("언제 잇고 언제 안 잇는가", () => {
    const slots: PendingCommandSlots = { intent: "move_place", placeName: "영진해변" };

    /**
     * **이번 문장만으로 읽혔으면 그것이 새 요청이다.** 옛 조각이 끼어들면 사용자가 말하지
     * 않은 장소에 적용되고, 그게 조용히 성공한다 — 못 알아듣는 것보다 나쁘다.
     */
    it("이번 문장이 스스로 읽히면 옛 조각을 쓰지 않는다", () => {
      const fresh = parseCommand("월정사를 셋째 날에 넣어줘");
      const merged = completeWithSlots(slots, fresh, "월정사를 셋째 날에 넣어줘");
      expect(merged).toEqual(fresh);
      expect(merged).toMatchObject({ placeName: "월정사", dayIndex: 3 });
    });

    it("날짜를 못 읽으면 잇지 않고 다시 되묻는다", () => {
      const vague = parseCommand("아무 때나");
      expect(completeWithSlots(slots, vague, "아무 때나")).toEqual(vague);
    });

    it("조각이 없으면 지금까지와 똑같이 동작한다", () => {
      const raw = parseCommand("둘째 날");
      expect(completeWithSlots(null, raw, "둘째 날")).toEqual(raw);
    });

    it("여러 표현의 날짜를 받는다", () => {
      for (const [text, dayIndex] of [["둘째 날", 2], ["2일차", 2], ["셋째 날", 3]] as const) {
        expect(completeWithSlots(slots, parseCommand(text), text))
          .toMatchObject({ intent: "move_place", placeName: "영진해변", dayIndex });
      }
    });
  });

  /**
   * PR #175 리뷰 — 사유 코드로는 못 가른다. 실제 파서 출력이 같기 때문이다.
   *
   * ```
   * "둘째 날"              -> UNSUPPORTED_INTENT   (이어 붙여야 한다)
   * "둘째 날 일정 설명해줘"  -> UNSUPPORTED_INTENT   (이어 붙이면 안 된다)
   * ```
   */
  describe("날짜 답변만 이어 붙인다", () => {
    const slots: PendingCommandSlots = { intent: "move_place", placeName: "영진해변" };

    it("날짜 답변으로 읽는 표현들", () => {
      for (const [text, day] of [
        ["둘째 날", 2], ["2일차", 2], ["셋째 날에", 3], ["둘째 날로", 2], ["둘째 날요", 2],
        ["day 3", 3], ["second day", 2],
      ] as const) {
        expect(dayOnlyAnswer(text), text).toBe(day);
      }
    });

    /** 날짜가 섞였을 뿐 다른 요청이면 옛 장소를 붙이면 안 된다 */
    it("날짜가 섞인 다른 요청은 답변이 아니다", () => {
      for (const text of [
        "둘째 날 일정 설명해줘",
        "둘째 날에 월정사 넣어줘",
        "둘째 날 동선에 맞는 다른 촬영지를 추천해줘",
        "둘째 날은 여유롭게",
        "explain day 2",
      ]) {
        expect(dayOnlyAnswer(text), text).toBeUndefined();
      }
    });

    it("날짜가 없으면 답변이 아니다", () => {
      expect(dayOnlyAnswer("아무 때나")).toBeUndefined();
    });

    /**
     * 이 대비가 리뷰에서 지적된 결함을 직접 잡는다 — 앞은 이어 붙고, 뒤는 옛 장소가
     * 끼어들지 않는다. 둘의 재질문 사유 코드는 같다.
     */
    it("같은 사유 코드라도 발화 모양으로 갈린다", () => {
      const answer = parseCommand("둘째 날");
      const other = parseCommand("둘째 날 일정 설명해줘");

      expect(completeWithSlots(slots, answer, "둘째 날"))
        .toEqual({ intent: "move_place", placeName: "영진해변", dayIndex: 2 });
      expect(completeWithSlots(slots, other, "둘째 날 일정 설명해줘")).toEqual(other);
    });
  });

  /**
   * 조각이 남은 채 기준 일정이 바뀌면 "둘째 날"이 **다른 일정의** 둘째 날에 적용된다.
   * 조각을 재질문 피드백에서만 꺼내므로, 피드백을 비우는 곳이 곧 무효화 지점이다.
   */
  const BASE_REQUEST = {
    arrivalAt: "2026-08-12T10:00:00+09:00",
    departureAt: "2026-08-14T18:00:00+09:00",
    airportReadyAt: "2026-08-12T12:00:00+09:00",
    airportArrivalDeadline: "2026-08-14T16:00:00+09:00",
    selectedActorIds: [],
    selectedWorkIds: ["work-goblin"],
    excludedPlaceIds: ["place-a"],
  };
  const keyOf = (over: Record<string, unknown> = {}, rest: {
    selectedAltId?: string | null; reopened?: boolean;
  } = {}) => itineraryBasisKey({
    request: { ...BASE_REQUEST, ...over },
    selectedAltId: rest.selectedAltId ?? null,
    reopened: rest.reopened ?? false,
  });

  describe("조각은 재질문 피드백에만 산다", () => {
    const slots: PendingCommandSlots = { intent: "move_place", placeName: "영진해변" };
    const basis = keyOf();
    const clarify = { kind: "clarify", pendingSlots: slots, basisKey: basis };

    it("재질문 피드백에서만 나온다", () => {
      expect(pendingSlotsOf(clarify, basis)).toEqual(slots);
    });

    it("피드백이 비면 조각도 없다", () => {
      expect(pendingSlotsOf(null, basis)).toBeNull();
    });

    it("다른 결과로 바뀌면 조각이 사라진다", () => {
      for (const kind of ["proposal", "explain", "recommendations", "error", "cancelled"]) {
        expect(pendingSlotsOf({ ...clarify, kind }, basis), kind).toBeNull();
      }
    });

    it("재질문이어도 남길 조각이 없으면 null이다", () => {
      expect(pendingSlotsOf({ ...clarify, pendingSlots: null }, basis)).toBeNull();
    });
  });

  /**
   * PR #175 리뷰 3회차 — 앞 회차 테스트는 **컴포넌트가 만들지 않는 상태**를 지어냈다.
   * 조각은 만들어진 기준을 계속 들고 있으므로 `basisKey`가 도중에 갱신되지 않는다.
   * 그래서 실제 `clarify` 객체를 그대로 두고 검사한다.
   */
  describe("기준이 바뀌면 조각을 쓰지 않는다", () => {
    const slots: PendingCommandSlots = { intent: "move_place", placeName: "영진해변" };
    const madeAt = keyOf();
    const clarify = { kind: "clarify", pendingSlots: slots, basisKey: madeAt };

    it("같은 기준이면 쓴다", () => {
      expect(pendingSlotsOf(clarify, keyOf())).toEqual(slots);
    });

    /**
     * 리뷰가 짚은 항목 — 항공 시각·공항 마감을 바꿔 다시 계산하면 세 축(선택·대안·재열람)은
     * 그대로다. 요청에서 기준을 만들기 때문에 이 경로가 막힌다.
     */
    it("항공·공항 시각이 바뀌면 쓰지 않는다", () => {
      for (const over of [
        { departureAt: "2026-08-15T18:00:00+09:00" },
        { airportReadyAt: "2026-08-12T14:00:00+09:00" },
        { airportArrivalDeadline: "2026-08-14T12:00:00+09:00" },
        { arrivalAt: "2026-08-12T08:00:00+09:00" },
      ]) {
        expect(pendingSlotsOf(clarify, keyOf(over)), JSON.stringify(over)).toBeNull();
      }
    });

    it("선택·콘텐츠가 바뀌면 쓰지 않는다", () => {
      expect(pendingSlotsOf(clarify, keyOf({ excludedPlaceIds: ["place-a", "place-b"] }))).toBeNull();
      expect(pendingSlotsOf(clarify, keyOf({ selectedWorkIds: ["work-goblin", "work-king"] }))).toBeNull();
    });

    it("방문일·순서 선호가 바뀌면 쓰지 않는다", () => {
      expect(pendingSlotsOf(clarify, keyOf({ preferredVisitDates: { "place-c": "2026-08-13" } }))).toBeNull();
      expect(pendingSlotsOf(clarify, keyOf({ preferredOrder: [["place-c", "place-d"]] }))).toBeNull();
    });

    it("대안을 고른 동안에는 쓰지 않는다", () => {
      expect(pendingSlotsOf(clarify, keyOf({}, { selectedAltId: "alt-bus-1" }))).toBeNull();
    });

    it("재열람 화면이면 쓰지 않는다", () => {
      expect(pendingSlotsOf(clarify, keyOf({}, { reopened: true }))).toBeNull();
    });

    it("기준이 없는 옛 피드백은 쓰지 않는다", () => {
      expect(pendingSlotsOf({ kind: "clarify", pendingSlots: slots }, madeAt)).toBeNull();
    });

    it("값 순서가 달라도 같은 기준이다 — 화면이 흔들리지 않는다", () => {
      expect(keyOf({ excludedPlaceIds: ["b", "a"] })).toBe(keyOf({ excludedPlaceIds: ["a", "b"] }));
    });

    /**
     * **이 방어가 못 잡는 것을 함께 적어 둔다.** 값이 같은 값으로 돌아오는 왕복은
     * 지문으로 못 가른다 — 지문은 값이고 왕복은 값을 되돌리는 일이다.
     *
     * 그 경로는 **사건 자체로 끊는** 명시적 폐기가 맡는다.
     *   대안 왕복  -> `chooseAlternative`의 `setAiFeedback(null)`
     *   재계산 왕복 -> `plan()`의 `setAiFeedback(null)`
     *
     * 두 겹이고 각자 잡는 것이 다르며, 어느 한쪽도 혼자서는 충분하지 않다.
     */
    it("값이 같은 값으로 돌아오는 왕복은 지문으로 못 가른다", () => {
      // 대안 왕복 · 재계산 왕복 둘 다 지문이 원래대로 돌아온다
      expect(pendingSlotsOf(clarify, keyOf())).toEqual(slots);
      expect(pendingSlotsOf(clarify, keyOf({ departureAt: "2026-08-15T18:00:00+09:00" })))
        .toBeNull();
      expect(pendingSlotsOf(clarify, keyOf())).toEqual(slots);
    });

    /**
     * PR #175 리뷰 4회차 — 앞서는 `PlanRequest` 필드를 손으로 나열해서, 새 입력이
     * 생기면 조용히 빠졌다. 지금은 요청을 구조적으로 훑으므로 필드가 늘어도 들어온다.
     */
    it("나열하지 않은 새 입력도 기준을 가른다", () => {
      const withNewField = itineraryBasisKey({
        request: { ...BASE_REQUEST, someFutureInput: "x" },
        selectedAltId: null,
        reopened: false,
      });
      expect(withNewField).not.toBe(keyOf());
    });

    it("요청의 모든 필드가 기준을 가른다", () => {
      for (const key of Object.keys(BASE_REQUEST)) {
        const changed = { ...BASE_REQUEST, [key]: "__changed__" };
        expect(
          itineraryBasisKey({ request: changed, selectedAltId: null, reopened: false }),
          key,
        ).not.toBe(keyOf());
      }
    });

    /**
     * PR #175 리뷰 5회차 — 배열을 재귀적으로 정렬하면 `preferredOrder`의 **쌍 방향**까지
     * 뭉갠다. 사용자가 순서 선호를 반대로 바꿨는데도 같은 기준으로 판단하게 된다.
     * 바깥 목록은 집합, 안쪽 쌍은 값의 일부다.
     */
    describe("순서 선호는 쌍의 방향이 뜻을 갖는다", () => {
      it("쌍을 뒤집으면 다른 기준이다", () => {
        expect(keyOf({ preferredOrder: [["a", "b"]] }))
          .not.toBe(keyOf({ preferredOrder: [["b", "a"]] }));
      });

      /** 쌍 목록의 순서는 뜻이 없다 — 여기까지 갈라지면 화면이 헛되이 흔들린다 */
      it("쌍 목록의 순서만 바뀌면 같은 기준이다", () => {
        expect(keyOf({ preferredOrder: [["a", "b"], ["c", "d"]] }))
          .toBe(keyOf({ preferredOrder: [["c", "d"], ["a", "b"]] }));
      });

      it("쌍 하나만 뒤집혀도 조각을 쓰지 않는다", () => {
        const madeWith = itineraryBasisKey({
          request: { ...BASE_REQUEST, preferredOrder: [["a", "b"], ["c", "d"]] },
          selectedAltId: null,
          reopened: false,
        });
        const pinned = { kind: "clarify", pendingSlots: slots, basisKey: madeWith };
        expect(pendingSlotsOf(pinned, keyOf({ preferredOrder: [["b", "a"], ["c", "d"]] })))
          .toBeNull();
      });
    });

    /** 집합 의미인 목록은 순서가 달라도 같아야 한다 */
    it("선택·제외 목록은 순서가 달라도 같은 기준이다", () => {
      expect(keyOf({ excludedPlaceIds: ["b", "a"] }))
        .toBe(keyOf({ excludedPlaceIds: ["a", "b"] }));
      expect(keyOf({ selectedWorkIds: ["w2", "w1"] }))
        .toBe(keyOf({ selectedWorkIds: ["w1", "w2"] }));
    });

    it("중첩된 값이 바뀌어도 가른다", () => {
      expect(pendingSlotsOf(clarify, keyOf({ preferredVisitDates: { "p": "2026-08-13" } })))
        .toBeNull();
      const a = keyOf({ preferredVisitDates: { "p": "2026-08-13" } });
      const b = keyOf({ preferredVisitDates: { "p": "2026-08-14" } });
      expect(a).not.toBe(b);
    });
  });

  /** 목록에 있는데 구현이 안 하면 계약이 아니라 주석이다 (PR #175 리뷰) */
  it("무효화 사건 목록은 실제로 비워지는 것만 담는다", () => {
    expect(SLOT_INVALIDATING_EVENTS).toContain("selection_changed");
    expect(SLOT_INVALIDATING_EVENTS).toContain("itinerary_recalculated");
    expect(SLOT_INVALIDATING_EVENTS).toContain("proposal_applied");
    expect(SLOT_INVALIDATING_EVENTS).toContain("proposal_cancelled");
    // 패널 닫기는 기존 결정(작업 상태 보존)에 따라 조각을 버리지 않는다
    expect(SLOT_INVALIDATING_EVENTS).not.toContain("panel_closed");
    expect(new Set(SLOT_INVALIDATING_EVENTS).size).toBe(SLOT_INVALIDATING_EVENTS.length);
  });
});
