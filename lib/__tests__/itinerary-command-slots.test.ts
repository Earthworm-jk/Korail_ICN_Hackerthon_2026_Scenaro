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
  describe("조각은 재질문 피드백에만 산다", () => {
    const slots: PendingCommandSlots = { intent: "move_place", placeName: "영진해변" };
    const basis = itineraryBasisKey({ selectionKey: "a|b", selectedAltId: null, reopened: false });
    const clarify = { kind: "clarify", pendingSlots: slots, basisKey: basis };

    it("재질문 피드백에서만 나온다", () => {
      expect(pendingSlotsOf(clarify, basis)).toEqual(slots);
    });

    /** 피드백을 비우는 모든 경로(선택 토글·재계산·재열람)가 여기로 수렴한다 */
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
   * PR #175 리뷰 2회차 — "피드백을 비우는 곳이 곧 무효화 지점"은 **비우는 걸 잊지 않았을
   * 때만** 참이다. 실제로 `chooseAlternative`가 비우지 않아, 대안을 골랐다 기본안으로
   * 돌아오면 옛 조각이 되살아났다.
   *
   * 그래서 호출부의 성실함에 기대지 않는다. 조각에 기준을 새겨 두고 지금 기준과 다르면
   * 쓰지 않는다 — **누가 어디서 비우는 걸 빠뜨려도** 낡은 조각이 적용되지 않는다.
   */
  describe("기준이 바뀌면 조각을 쓰지 않는다", () => {
    const slots: PendingCommandSlots = { intent: "move_place", placeName: "영진해변" };
    const base = { selectionKey: "a|b", selectedAltId: null, reopened: false };
    const madeAt = itineraryBasisKey(base);
    const clarify = { kind: "clarify", pendingSlots: slots, basisKey: madeAt };

    it("같은 기준이면 쓴다", () => {
      expect(pendingSlotsOf(clarify, itineraryBasisKey(base))).toEqual(slots);
    });

    /** 리뷰가 짚은 재현 경로 — 대안을 골랐다 기본안으로 돌아와도 되살아나지 않는다 */
    it("대안을 골랐다 기본안으로 돌아와도 되살아나지 않는다", () => {
      const swapped = itineraryBasisKey({ ...base, selectedAltId: "alt-bus-1" });
      expect(pendingSlotsOf(clarify, swapped)).toBeNull();

      // 기본안 복귀 — 기준 문자열은 같아 보이지만 그 사이 피드백이 비워졌다.
      // 설령 비우는 것을 또 빠뜨려도, 조각을 만든 기준과 지금 기준이 같을 때만 살아난다
      const backToBase = itineraryBasisKey(base);
      const staleAfterSwap = { ...clarify, basisKey: swapped };
      expect(pendingSlotsOf(staleAfterSwap, backToBase)).toBeNull();
    });

    it("선택이 바뀌면 쓰지 않는다", () => {
      expect(pendingSlotsOf(clarify, itineraryBasisKey({ ...base, selectionKey: "a|b|c" })))
        .toBeNull();
    });

    it("재열람 화면이면 쓰지 않는다", () => {
      expect(pendingSlotsOf(clarify, itineraryBasisKey({ ...base, reopened: true }))).toBeNull();
    });

    it("기준이 없는 옛 피드백은 쓰지 않는다", () => {
      expect(pendingSlotsOf({ kind: "clarify", pendingSlots: slots }, madeAt)).toBeNull();
    });

    /** 값이 붙어 만들어지므로 한 칸만 달라도 다른 기준이다 */
    it("세 축이 각각 기준을 가른다", () => {
      const keys = new Set([
        itineraryBasisKey(base),
        itineraryBasisKey({ ...base, selectionKey: "a" }),
        itineraryBasisKey({ ...base, selectedAltId: "alt-1" }),
        itineraryBasisKey({ ...base, reopened: true }),
      ]);
      expect(keys.size).toBe(4);
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
