import { describe, expect, it } from "vitest";

import { parseCommand } from "@/lib/itinerary-command-fallback";
import {
  SLOT_INVALIDATING_EVENTS,
  completeWithSlots,
  pendingSlotsFrom,
  type PendingCommandSlots,
} from "@/lib/itinerary-command-slots";
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
   * 조각이 남은 채 기준 일정이 바뀌면 "둘째 날"이 **다른 일정의** 둘째 날에 적용된다.
   * 화면은 조각을 재질문 피드백에 붙여 두므로, 피드백을 비우는 곳이 곧 무효화 지점이다.
   */
  it("무효화 사건 목록이 계약으로 남아 있다", () => {
    expect(SLOT_INVALIDATING_EVENTS).toContain("selection_changed");
    expect(SLOT_INVALIDATING_EVENTS).toContain("itinerary_recalculated");
    expect(SLOT_INVALIDATING_EVENTS).toContain("proposal_applied");
    expect(SLOT_INVALIDATING_EVENTS).toContain("proposal_cancelled");
    expect(new Set(SLOT_INVALIDATING_EVENTS).size).toBe(SLOT_INVALIDATING_EVENTS.length);
  });
});
