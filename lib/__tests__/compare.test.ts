import { describe, expect, it } from "vitest";
import { compareCandidates, type Candidate } from "../engine/compare";

function cand(partial: Partial<Candidate> & { stableId: string }): Candidate {
  return {
    keys: {
      selectionGroupCoverageCount: 2,
      representativePlaceCount: 0,
      selectedUnionPlaceCount: 3,
      verifiedHoursMismatchCount: 0,
      preferredDateMismatchCount: 0,
      preferredOrderMismatchCount: 0,
      totalTravelMinutes: 120,
      transferCount: 1,
      slackSatisfied: true,
      ...(partial.keys ?? {}),
    },
    departureSlackMinutes: partial.departureSlackMinutes ?? 180,
    stableId: partial.stableId,
  };
}

describe("사전식 비교 (#3 — 가중합 아님)", () => {
  /**
   * #145 — 순서 선호가 실제로 최종 승자를 정하는지. 계산만 하고 비교에서 안 읽으면
   * beam에서 보존해도 마지막에 이동시간이 승자를 뒤집는다 (PR #153 리뷰 1번에서 잡힌 결함).
   */
  describe("순서 선호 서열", () => {
    it("다른 키가 모두 같으면 순서를 더 지킨 쪽이 이긴다", () => {
      const kept = cand({ stableId: "a", keys: { preferredOrderMismatchCount: 0 } as never });
      const broken = cand({ stableId: "b", keys: { preferredOrderMismatchCount: 1 } as never });
      expect(compareCandidates(kept, broken)).toBeLessThan(0);
      expect(compareCandidates(broken, kept)).toBeGreaterThan(0);
    });

    it("순서는 이동시간보다 앞이다 — 더 빨라도 순서를 어기면 진다", () => {
      const slowButKept = cand({
        stableId: "a",
        keys: { preferredOrderMismatchCount: 0, totalTravelMinutes: 999 } as never,
      });
      const fastButBroken = cand({
        stableId: "b",
        keys: { preferredOrderMismatchCount: 1, totalTravelMinutes: 1 } as never,
      });
      expect(compareCandidates(slowButKept, fastButBroken)).toBeLessThan(0);
    });

    it("순서는 방문일보다 뒤다 — 방문일을 어기면서 순서를 지키지 않는다", () => {
      const dateKept = cand({
        stableId: "a",
        keys: { preferredDateMismatchCount: 0, preferredOrderMismatchCount: 9 } as never,
      });
      const dateBroken = cand({
        stableId: "b",
        keys: { preferredDateMismatchCount: 1, preferredOrderMismatchCount: 0 } as never,
      });
      expect(compareCandidates(dateKept, dateBroken)).toBeLessThan(0);
    });

    it("순서는 검증된 운영시간 충돌보다 뒤다 — 충돌을 늘리면서까지 순서를 지키지 않는다", () => {
      const noWarning = cand({
        stableId: "a",
        keys: { verifiedHoursMismatchCount: 0, preferredOrderMismatchCount: 9 } as never,
      });
      const warned = cand({
        stableId: "b",
        keys: { verifiedHoursMismatchCount: 1, preferredOrderMismatchCount: 0 } as never,
      });
      expect(compareCandidates(noWarning, warned)).toBeLessThan(0);
    });
  });

  it("배우·작품 그룹을 모두 충족한 일정이 작품 장소만 많은 일정보다 우선한다", () => {
    const both = cand({
      stableId: "a",
      keys: { selectionGroupCoverageCount: 2, selectedUnionPlaceCount: 2, totalTravelMinutes: 999 } as never,
    });
    const workOnly = cand({
      stableId: "b",
      keys: { selectionGroupCoverageCount: 1, selectedUnionPlaceCount: 9, totalTravelMinutes: 1 } as never,
    });
    expect(compareCandidates(both, workOnly)).toBeLessThan(0);
  });

  it("그룹 충족 수가 같으면 검수된 대표 촬영지를 포함한 일정이 방문 수보다 우선한다", () => {
    const iconic = cand({
      stableId: "a",
      keys: { representativePlaceCount: 1, selectedUnionPlaceCount: 2 } as never,
    });
    const moreButGeneric = cand({
      stableId: "b",
      keys: { representativePlaceCount: 0, selectedUnionPlaceCount: 9 } as never,
    });
    expect(compareCandidates(iconic, moreButGeneric)).toBeLessThan(0);
  });

  it("그룹·대표 촬영지 수가 같으면 엄격 합집합의 고유 방문 장소 수로 비교한다", () => {
    const moreUnion = cand({ stableId: "a", keys: { selectedUnionPlaceCount: 4 } as never });
    const lessUnion = cand({ stableId: "b", keys: { selectedUnionPlaceCount: 3 } as never });
    expect(compareCandidates(moreUnion, lessUnion)).toBeLessThan(0);
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

describe("검증 운영시간 충돌 수 키 (#198 — 방문 수 뒤·이동시간 앞)", () => {
  it("방문 수가 같으면 검증 충돌이 적은 일정이 이동시간과 무관하게 우선한다", () => {
    const clean = cand({ stableId: "a", keys: { verifiedHoursMismatchCount: 0, totalTravelMinutes: 999 } as never });
    const warned = cand({ stableId: "b", keys: { verifiedHoursMismatchCount: 1, totalTravelMinutes: 1 } as never });
    expect(compareCandidates(clean, warned)).toBeLessThan(0);
  });

  it("방문 수가 다르면 검증 충돌 수보다 방문 수가 먼저다 — 사용자 선택 의도 우선", () => {
    const moreVisits = cand({ stableId: "a", keys: { selectedUnionPlaceCount: 3, verifiedHoursMismatchCount: 2 } as never });
    const fewerClean = cand({ stableId: "b", keys: { selectedUnionPlaceCount: 2, verifiedHoursMismatchCount: 0 } as never });
    expect(compareCandidates(moreVisits, fewerClean)).toBeLessThan(0);
  });

  it("검증 충돌 수가 같으면 기존 이동시간 순서로 비교한다", () => {
    const faster = cand({ stableId: "a", keys: { verifiedHoursMismatchCount: 1, totalTravelMinutes: 100 } as never });
    const slower = cand({ stableId: "b", keys: { verifiedHoursMismatchCount: 1, totalTravelMinutes: 200 } as never });
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
