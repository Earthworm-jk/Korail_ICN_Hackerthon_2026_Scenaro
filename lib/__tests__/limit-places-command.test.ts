import { describe, expect, it } from "vitest";

import { parseCommand } from "@/lib/itinerary-command-fallback";
import { resolveCommand } from "@/lib/itinerary-command-resolver";

/**
 * "7곳만 남겨줘" 복합 목표 (#171 6번).
 *
 * 목표 대화의 첫 줄이다.
 *
 * ```
 * 20곳은 너무 많네. 7곳만 남기고 영진해변은 꼭 유지해줘.
 * ```
 *
 * 키가 없어도 되어야 한다 — 발표장에서 네트워크가 끊겨도 눌린다.
 */

const candidates = [
  { id: "place-yeongjin-beach", name: { ko: "영진해변", en: "Yeongjin Beach" } },
  { id: "place-gwanghwamun", name: { ko: "광화문", en: "Gwanghwamun" } },
];
const context = {
  tripDates: ["2026-08-12", "2026-08-13", "2026-08-14"],
  candidates,
  scheduledPlaceIds: new Set(["place-yeongjin-beach"]),
};

describe("개수 목표 읽기", () => {
  it("보고된 문장을 그대로 읽는다", () => {
    expect(parseCommand("20곳은 너무 많네. 7곳만 남기고 영진해변은 꼭 유지해줘. 이동이 짧은 쪽으로."))
      .toEqual({
        intent: "limit_places",
        targetPlaceCount: 7,
        pinnedPlaceNames: ["영진해변"],
      });
  });

  it("여러 표현을 받는다", () => {
    for (const [text, count] of [
      ["7곳만 남겨줘", 7], ["5개로 줄여줘", 5], ["7곳만 추려줘", 7],
      ["keep 7 places", 7], ["only 5 places", 5],
    ] as const) {
      expect(parseCommand(text), text).toMatchObject({ intent: "limit_places", targetPlaceCount: count });
    }
  });

  /** 개수만 있는 문장까지 잡으면 추천 요청이 정리 명령으로 읽힌다 */
  it("개수만 있는 추천 요청은 정리로 읽지 않는다", () => {
    expect(parseCommand("7곳 추천해줘")).toMatchObject({ intent: "unknown" });
  });

  it("기존 명령을 가로채지 않는다", () => {
    expect(parseCommand("영진해변을 둘째 날에 넣어줘")).toMatchObject({ intent: "add_place" });
    expect(parseCommand("둘째 날 동선에 맞는 다른 촬영지를 추천해줘"))
      .toMatchObject({ intent: "recommend_along_route" });
  });

  it("고정 표현이 없으면 고정도 없다", () => {
    expect(parseCommand("7곳만 남겨줘")).not.toHaveProperty("pinnedPlaceNames");
  });
});

describe("개수 목표 풀기", () => {
  it("고정 이름을 장소 ID로 바꾼다", () => {
    const raw = parseCommand("7곳만 남기고 영진해변은 꼭 유지해줘");
    const resolved = resolveCommand(raw, context);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.command).toEqual({
      intent: "limit_places",
      targetPlaceCount: 7,
      pinnedPlaceIds: ["place-yeongjin-beach"],
    });
  });

  /** 사용자가 "꼭"이라고 한 장소를 우리가 임의로 고르면 약속을 무르는 것이다 */
  it("고정 장소를 못 찾으면 되묻는다", () => {
    const resolved = resolveCommand(
      { intent: "limit_places", targetPlaceCount: 7, pinnedPlaceNames: ["없는장소"] },
      context,
    );
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.clarification.code).toBe("PLACE_NOT_FOUND");
  });

  it("고정이 없으면 빈 목록으로 푼다", () => {
    const resolved = resolveCommand({ intent: "limit_places", targetPlaceCount: 5 }, context);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.command).toMatchObject({ pinnedPlaceIds: [] });
  });
});
