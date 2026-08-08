import { describe, expect, it } from "vitest";
import { compareCandidates, type Candidate } from "../engine/compare";

function cand(partial: Partial<Candidate> & { stableId: string }): Candidate {
  return {
    keys: {
      relevanceKey: { selectedWorkPlaceCount: 3, actorOtherWorkPlaceCount: 1 },
      visitablePlaceCount: 3,
      activityWarningCount: 0,
      totalRailMinutes: 120,
      transferCount: 1,
      slackSatisfied: true,
      ...(partial.keys ?? {}),
    },
    departureSlackMinutes: partial.departureSlackMinutes ?? 180,
    stableId: partial.stableId,
  };
}

describe("사전식 비교 (#3 — 가중합 아님)", () => {
  it("관련성 벡터가 다르면 뒤 키와 무관하게 관련성이 이긴다", () => {
    const high = cand({ stableId: "a", keys: { relevanceKey: { selectedWorkPlaceCount: 3, actorOtherWorkPlaceCount: 0 }, totalRailMinutes: 999 } as never });
    const low = cand({ stableId: "b", keys: { relevanceKey: { selectedWorkPlaceCount: 2, actorOtherWorkPlaceCount: 9 }, totalRailMinutes: 1 } as never });
    expect(compareCandidates(high, low)).toBeLessThan(0);
  });

  it("선택 작품 개수 동점이면 배우 타출연작 개수로 비교한다", () => {
    const moreOther = cand({ stableId: "a", keys: { relevanceKey: { selectedWorkPlaceCount: 2, actorOtherWorkPlaceCount: 2 } } as never });
    const lessOther = cand({ stableId: "b", keys: { relevanceKey: { selectedWorkPlaceCount: 2, actorOtherWorkPlaceCount: 1 } } as never });
    expect(compareCandidates(moreOther, lessOther)).toBeLessThan(0);
  });

  it("여유시간은 충족 여부만 본다 — 초과 가점 없음", () => {
    const satisfied = cand({ stableId: "a" });
    const notSatisfied = cand({ stableId: "b", keys: { slackSatisfied: false } as never });
    expect(compareCandidates(satisfied, notSatisfied)).toBeLessThan(0);
  });

  it("완전 동점은 사전순으로 고정된다 — 결정성", () => {
    const a = cand({ stableId: "place-a/801" });
    const b = cand({ stableId: "place-b/801" });
    expect(compareCandidates(a, b)).toBeLessThan(0);
    expect(compareCandidates(b, a)).toBeGreaterThan(0);
    expect(compareCandidates(a, cand({ stableId: "place-a/801" }))).toBe(0);
  });

  it("정렬 결과가 입력 순서와 무관하게 동일하다", () => {
    const list = [cand({ stableId: "c" }), cand({ stableId: "a" }), cand({ stableId: "b" })];
    const sorted1 = [...list].sort(compareCandidates).map((c) => c.stableId);
    const sorted2 = [...list].reverse().sort(compareCandidates).map((c) => c.stableId);
    expect(sorted1).toEqual(sorted2);
    expect(sorted1).toEqual(["a", "b", "c"]);
  });
});

describe("운영시간 경고 수 키 (#43 결정 3 — 방문 수 뒤·이동시간 앞)", () => {
  it("방문 수가 같으면 경고가 적은 일정이 이동시간과 무관하게 우선한다", () => {
    const clean = cand({ stableId: "a", keys: { activityWarningCount: 0, totalRailMinutes: 999 } as never });
    const warned = cand({ stableId: "b", keys: { activityWarningCount: 1, totalRailMinutes: 1 } as never });
    expect(compareCandidates(clean, warned)).toBeLessThan(0);
  });

  it("방문 수가 다르면 경고 수보다 방문 수가 먼저다 — 사용자 선택 의도 우선", () => {
    const moreVisits = cand({ stableId: "a", keys: { visitablePlaceCount: 3, activityWarningCount: 2 } as never });
    const fewerClean = cand({ stableId: "b", keys: { visitablePlaceCount: 2, activityWarningCount: 0 } as never });
    expect(compareCandidates(moreVisits, fewerClean)).toBeLessThan(0);
  });

  it("경고 수가 같으면 기존 이동시간 순서로 비교한다", () => {
    const faster = cand({ stableId: "a", keys: { activityWarningCount: 1, totalRailMinutes: 100 } as never });
    const slower = cand({ stableId: "b", keys: { activityWarningCount: 1, totalRailMinutes: 200 } as never });
    expect(compareCandidates(faster, slower)).toBeLessThan(0);
  });
});

describe("결정적 타이브레이커 (PR #16 비차단 권고)", () => {
  it("비교 키가 모두 같으면 출국 전 여유가 큰 후보가 우선한다", () => {
    const roomier = cand({ stableId: "b", departureSlackMinutes: 240 });
    const tighter = cand({ stableId: "a", departureSlackMinutes: 180 });
    expect(compareCandidates(roomier, tighter)).toBeLessThan(0);
    expect([tighter, roomier].sort(compareCandidates).map((c) => c.stableId)).toEqual(["b", "a"]);
  });
});
