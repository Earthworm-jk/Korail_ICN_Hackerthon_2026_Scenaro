import { describe, expect, it } from "vitest";
import { parseCommand } from "../itinerary-command-fallback";
import {
  completeWithSlots,
  pendingSlotsFrom,
  placeOnlyAnswer,
  type PendingCommandSlots,
} from "../itinerary-command-slots";
import { resolveCommand } from "../itinerary-command-resolver";

/**
 * 부정·대조 차단과 장소 방향 슬롯 (#197 P0-A·P0-B)
 *
 * 여기 고정하는 것은 **반대 행동 proposal이 만들어지지 않는다**는 계약이다. 실제 상태
 * 변경 0건만으로는 부족하다 — 사용자가 하지 말라고 한 일이 확인 창에 올라가는 것도
 * 결함이기 때문이다. 그래서 파서 출력과 resolver 통과 여부를 함께 본다.
 */

const CANDIDATES = [
  { id: "place-yeongjin-beach", name: { ko: "영진해변", en: "Yeongjin Beach" } },
  { id: "place-jumunjin-breakwater", name: { ko: "주문진 방파제", en: "Jumunjin Breakwater" } },
  { id: "place-gwanghwamun", name: { ko: "광화문", en: "Gwanghwamun" } },
];

/** 광화문은 이미 일정에 있다 — `add`가 `move`로 확정되는 경로까지 덮는다 */
const context = () => ({
  tripDates: ["2026-08-12", "2026-08-13", "2026-08-14"] as const,
  candidates: CANDIDATES,
  scheduledPlaceIds: new Set(["place-gwanghwamun"]),
});

/** 파서와 resolver를 모두 지난 뒤에도 실행 가능한 명령이 되지 않아야 한다 */
function reachesExecutableCommand(sentence: string): boolean {
  const raw = parseCommand(sentence);
  const resolved = resolveCommand(raw, context() as never);
  return resolved.ok;
}

describe("#197 P0-A 부정·대조는 반대 제안을 만들지 않는다", () => {
  /** 이 4문장이 실측에서 긍정 proposal을 만들었다 (issue #197 결정 절) */
  const BLOCKED = [
    "영진해변을 둘째 날에 추가하지 마",
    "영진해변을 둘째 날에 포함하지 말아줘",
    "영진해변을 둘째 날 말고 셋째 날에 넣어줘",
    "영진해변을 둘째 날에는 넣지 말고 셋째 날에 넣어줘",
  ];

  it.each(BLOCKED)("실행 가능한 명령이 되지 않는다: %s", (sentence) => {
    expect(reachesExecutableCommand(sentence)).toBe(false);
  });

  it.each(BLOCKED)("재질문으로 떨어진다: %s", (sentence) => {
    expect(parseCommand(sentence).intent).toBe("unknown");
  });

  /**
   * `넣지 마`가 앞서 안전했던 것은 `ADD_VERBS`가 활용형(`넣어`)이라 우연히 안 걸렸기
   * 때문이다. 어간(`추가`·`포함`)에도 같은 결과가 나오는지가 이 계약의 핵심이다.
   */
  it("어간 동사의 부정도 활용형과 같게 막는다", () => {
    for (const sentence of [
      "영진해변을 둘째 날에 넣지 마",
      "영진해변을 둘째 날에 추가하지 마",
      "영진해변을 둘째 날에 포함하지 마세요",
      "영진해변은 둘째 날에 추가하지 않아도 돼",
      "영진해변 둘째 날에 안 넣어도 돼",
    ]) {
      expect(parseCommand(sentence).intent, sentence).toBe("unknown");
    }
  });

  it("일차가 둘 이상이면 하나를 고르지 않는다", () => {
    // `말고` 없이도 목표가 둘이면 되물어야 한다
    expect(parseCommand("영진해변을 둘째 날이나 셋째 날에 넣어줘").intent).toBe("unknown");
    expect(parseCommand("영진해변을 2일차 3일차에 넣어줘").intent).toBe("unknown");
  });

  it("영어 부정도 막는다", () => {
    expect(parseCommand("Don't add Yeongjin Beach to day 2").intent).toBe("unknown");
    expect(parseCommand("Add Yeongjin Beach to day 3 instead of day 2").intent).toBe("unknown");
  });

  /** 차단이 정상 명령까지 잡아먹으면 지원률이 떨어진다 — 기존 통과 문장을 함께 고정한다 */
  it("정상 명령은 그대로 통과한다", () => {
    expect(parseCommand("영진해변을 둘째 날 일정에 넣어줘")).toEqual({
      intent: "add_place", placeName: "영진해변", dayIndex: 2,
    });
    expect(parseCommand("영진해변을 2일차에 포함해 주세요")).toEqual({
      intent: "add_place", placeName: "영진해변", dayIndex: 2,
    });
    expect(parseCommand("영진해변은 꼭 남기고 7곳으로 줄여줘")).toMatchObject({
      intent: "limit_places", targetPlaceCount: 7,
    });
    expect(parseCommand("무엇이 달라졌어?")).toEqual({ intent: "explain_changes" });
  });
});

describe("#197 P0-B 날짜를 물어본 방향과 장소를 물어본 방향", () => {
  it("장소가 없으면 읽은 일차를 조각으로 남긴다", () => {
    const raw = parseCommand("둘째 날에 넣어줘");
    expect(raw).toMatchObject({
      intent: "unknown",
      clarification: { reason: "PLACE_MISSING", dayIndex: 2, intent: "add_place" },
    });
    expect(pendingSlotsFrom(raw)).toEqual({
      requested: "place", intent: "add_place", dayIndex: 2,
    });
  });

  it("이름만 온 답변으로 명령이 완성된다", () => {
    const slots = pendingSlotsFrom(parseCommand("둘째 날에 넣어줘"));
    for (const answer of ["영진해변", "영진해변이요", "주문진 방파제"]) {
      const merged = completeWithSlots(slots, parseCommand(answer), answer);
      expect(merged, answer).toMatchObject({ intent: "add_place", dayIndex: 2 });
    }
  });

  it("기존 장소->날짜 방향은 그대로다", () => {
    const raw = parseCommand("영진해변을 옮겨줘");
    const slots = pendingSlotsFrom(raw);
    expect(slots).toEqual({ requested: "day", intent: "move_place", placeName: "영진해변" });

    const merged = completeWithSlots(slots, parseCommand("둘째 날"), "둘째 날");
    expect(merged).toEqual({ intent: "move_place", placeName: "영진해변", dayIndex: 2 });
  });

  /**
   * 슬롯 오염 (#197 결정 절이 지정한 필수 차단 fixture)
   *
   * `dayOnlyAnswer`는 날짜가 닫힌 집합이라 "지우고 남은 게 없으면 답변"으로 갈랐다.
   * 장소는 열린 집합이라 그 검사를 옮겨올 수 없어, 답변일 수 없는 신호를 찾는다.
   * 이 셋이 통과하면 PR #175가 막은 오염이 장소 방향에서 되살아난다.
   */
  it("되물은 칸의 답이 아니면 합치지 않는다", () => {
    const slots: PendingCommandSlots = { requested: "place", intent: "add_place", dayIndex: 2 };
    for (const sentence of [
      "아니야 그냥 광화문 빼줘",
      "광화문 일정 설명해줘",
      "됐어 취소할게",
    ]) {
      expect(placeOnlyAnswer(sentence), sentence).toBeUndefined();

      const merged = completeWithSlots(slots, parseCommand(sentence), sentence);
      expect(merged.intent, sentence).toBe("unknown");
      expect(resolveCommand(merged, context() as never).ok, sentence).toBe(false);
    }
  });

  /**
   * PR #200 리뷰 차단 1건.
   *
   * `광화문 빼줘`에는 부정 표지도, 추가·이동 동사도 없다. 그래서 앞선 두 검사를 모두
   * 통과하고 문장 전체가 장소명이 되어 `add_place(둘째 날)`로 합쳐졌다 — **빼달라는 요청이
   * 추가로 실행될 뻔했다.** `아니야`가 붙은 변형만 시험해서 이 경로를 놓쳤다.
   */
  it("제거·교체 요청을 장소명으로 소비하지 않는다", () => {
    const slots: PendingCommandSlots = { requested: "place", intent: "add_place", dayIndex: 2 };
    for (const sentence of [
      "광화문 빼줘",
      "광화문 삭제해줘",
      "광화문 제외해줘",
      "광화문 지워줘",
      "광화문 바꿔줘",
      "remove Gwanghwamun",
      "delete Gwanghwamun",
    ]) {
      expect(placeOnlyAnswer(sentence), sentence).toBeUndefined();

      const merged = completeWithSlots(slots, parseCommand(sentence), sentence);
      expect(merged.intent, sentence).toBe("unknown");
      expect(resolveCommand(merged, context() as never).ok, sentence).toBe(false);
    }
  });

  it("새 명령이 스스로 읽히면 조각을 쓰지 않는다", () => {
    const slots: PendingCommandSlots = { requested: "place", intent: "add_place", dayIndex: 2 };
    const sentence = "월정사를 셋째 날에 넣어줘";
    const merged = completeWithSlots(slots, parseCommand(sentence), sentence);
    expect(merged).toMatchObject({ placeName: "월정사", dayIndex: 3 });
  });

  it("날짜 답변을 장소 자리에 넣지 않는다", () => {
    const slots: PendingCommandSlots = { requested: "place", intent: "add_place", dayIndex: 2 };
    const merged = completeWithSlots(slots, parseCommand("둘째 날"), "둘째 날");
    expect(merged.intent).toBe("unknown");
  });
});
