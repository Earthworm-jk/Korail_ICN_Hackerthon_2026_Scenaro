import { describe, expect, it } from "vitest";
import { createPlaceRankingSnapshotSchema, sortCandidatePlaces } from "../place-ranking";

const ids = {
  works: new Set(["work-a", "work-b"]),
  places: new Set(["place-a", "place-b", "place-c"]),
};

const snapshot = {
  meta: {
    model: "text-embedding-model",
    inputRuleVersion: "v1",
    generatedAt: "2026-08-08T12:00:00+09:00",
    badgeThreshold: 0.7,
  },
  rankings: [
    {
      workId: "work-a",
      placeId: "place-a",
      score: 0.8,
      reviewed: true as const,
      reviewedAt: "2026-08-08",
      reviewedBy: "reviewer",
      reason: { ko: "관련 장면", en: "Related scene" },
    },
  ],
};

describe("촬영지 랭킹 스냅샷 계약 (#48)", () => {
  it("검토 이력·노출 이유·참조가 유효한 스냅샷을 허용한다", () => {
    expect(createPlaceRankingSnapshotSchema(ids.works, ids.places).safeParse(snapshot).success).toBe(true);
  });

  it("배지 기준 이상인데 이유가 없거나 참조가 깨지면 거절한다", () => {
    const invalid = {
      ...snapshot,
      rankings: [{ ...snapshot.rankings[0], workId: "work-missing", reason: undefined }],
    };
    const result = createPlaceRankingSnapshotSchema(ids.works, ids.places).safeParse(invalid);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map(({ path }) => path.join("."))).toEqual(
        expect.arrayContaining(["rankings.0.reason", "rankings.0.workId"]),
      );
    }
  });
});

describe("촬영지 후보 정렬 (#48)", () => {
  const candidates = [
    { id: "place-a", workIds: ["work-a"], relation: "selected_work" as const, officialSourceCount: 1 },
    { id: "place-b", workIds: ["work-a"], relation: "selected_work" as const, officialSourceCount: 3 },
    { id: "place-c", workIds: ["work-b"], relation: "actor_other_work" as const, officialSourceCount: 9 },
  ];

  it("스냅샷이 없으면 후보를 유지하고 관계·출처·ID로 결정적으로 폴백한다", () => {
    expect(sortCandidatePlaces(candidates, "relevance").map(({ id }) => id)).toEqual([
      "place-b",
      "place-a",
      "place-c",
    ]);
  });

  it("검토된 AI 점수는 같은 관계 범주의 순서만 바꾸고 후보를 제거하지 않는다", () => {
    const withUnreviewedHighScore = {
      ...snapshot,
      rankings: [
        ...snapshot.rankings,
        { workId: "work-a", placeId: "place-b", score: 0.99, reviewed: false as const },
      ],
    };
    expect(sortCandidatePlaces(candidates, "relevance", withUnreviewedHighScore).map(({ id }) => id)).toEqual([
      "place-a",
      "place-b",
      "place-c",
    ]);
  });

  it("공식 출처순은 AI 점수와 무관하게 기존 계약을 유지한다", () => {
    expect(sortCandidatePlaces(candidates, "official_sources", snapshot).map(({ id }) => id)).toEqual([
      "place-c",
      "place-b",
      "place-a",
    ]);
  });
});
