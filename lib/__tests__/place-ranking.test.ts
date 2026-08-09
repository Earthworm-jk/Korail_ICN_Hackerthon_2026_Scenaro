import { describe, expect, it } from "vitest";
import placeRankingsSeed from "../../data/place-rankings.json";
import placesSeed from "../../data/places.json";
import workPlaceRelationsSeed from "../../data/work-place-relations.json";
import worksSeed from "../../data/works.json";
import { createPlaceRankingSnapshotSchema, deriveAiRelevance, sortCandidatePlaces } from "../place-ranking";

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
  it("실스냅은 참조·검토 계약과 공식 촬영 관계 12건을 충족한다", () => {
    const schema = createPlaceRankingSnapshotSchema(
      new Set(worksSeed.map(({ id }) => id)),
      new Set(placesSeed.map(({ id }) => id)),
    );
    expect(schema.safeParse(placeRankingsSeed).success).toBe(true);
    expect(placeRankingsSeed.meta).toMatchObject({
      model: "text-embedding-3-small",
      inputRuleVersion: "v1",
      badgeThreshold: 0.25,
    });
    expect(placeRankingsSeed.rankings).toHaveLength(worksSeed.length * placesSeed.length);

    const reviewedPairs = placeRankingsSeed.rankings
      .filter(({ reviewed }) => reviewed)
      .map(({ workId, placeId }) => `${workId}|${placeId}`)
      .sort();
    const relationPairs = workPlaceRelationsSeed
      .map(({ workId, placeId }) => `${workId}|${placeId}`)
      .sort();
    expect(reviewedPairs).toEqual(relationPairs);
    expect(placeRankingsSeed.rankings.filter(({ reviewed }) => reviewed).every(
      ({ score, reason }) => score >= placeRankingsSeed.meta.badgeThreshold && Boolean(reason?.ko && reason.en),
    )).toBe(true);
  });

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

describe("촬영지 후보 정렬 (#48 — PR #70 리뷰: 서버 파생 aiRank 사용)", () => {
  const candidates = [
    { id: "place-a", relationDetails: [{ workId: "work-a" }], relation: "selected_work" as const, officialSourceCount: 1 },
    { id: "place-b", relationDetails: [{ workId: "work-a" }], relation: "selected_work" as const, officialSourceCount: 3 },
    { id: "place-c", relationDetails: [{ workId: "work-b" }], relation: "actor_other_work" as const, officialSourceCount: 9 },
  ];

  /** 서버 액션과 동일한 경로 — 파생 순위를 붙인 뒤 정렬한다 */
  const withRank = (snap: Parameters<typeof deriveAiRelevance>[1]) => {
    const relevance = deriveAiRelevance(candidates, snap);
    return candidates.map((c) => ({ ...c, aiRank: relevance.get(c.id)?.aiRank }));
  };

  it("스냅샷이 없으면 후보를 유지하고 관계·출처·ID로 결정적으로 폴백한다", () => {
    expect(sortCandidatePlaces(withRank(null), "relevance").map(({ id }) => id)).toEqual([
      "place-b",
      "place-a",
      "place-c",
    ]);
  });

  it("검토된 AI 순위는 같은 관계 범주의 순서만 바꾸고 후보를 제거하지 않는다", () => {
    const withUnreviewedHighScore = {
      ...snapshot,
      rankings: [
        ...snapshot.rankings,
        { workId: "work-a", placeId: "place-b", score: 0.99, reviewed: false as const },
      ],
    };
    expect(sortCandidatePlaces(withRank(withUnreviewedHighScore), "relevance").map(({ id }) => id)).toEqual([
      "place-a",
      "place-b",
      "place-c",
    ]);
  });

  it("검토됐어도 하한 미달이면 미탑재와 같게 출처·ID 폴백을 사용한다", () => {
    const belowThreshold = {
      ...snapshot,
      rankings: [{
        ...snapshot.rankings[0],
        score: 0.69,
        reason: undefined,
      }],
    };
    expect(sortCandidatePlaces(withRank(belowThreshold), "relevance").map(({ id }) => id)).toEqual([
      "place-b",
      "place-a",
      "place-c",
    ]);
  });

  it("선택과 무관한 작품의 고득점은 순서에 영향을 주지 않는다 (PR #70 리뷰 2)", () => {
    // place-b의 relationDetails는 work-a뿐 — work-b 고득점은 선택 관련 범위 밖이라 무시된다
    const unrelatedHighScore = {
      ...snapshot,
      rankings: [{
        workId: "work-b",
        placeId: "place-b",
        score: 0.99,
        reviewed: true as const,
        reviewedAt: "2026-08-09",
        reviewedBy: "reviewer",
        reason: { ko: "무관 작품", en: "Unrelated" },
      }],
    };
    expect(sortCandidatePlaces(withRank(unrelatedHighScore), "relevance").map(({ id }) => id)).toEqual([
      "place-b", // 출처·ID 폴백 그대로 — work-b 점수가 place-b를 올리지 않는다
      "place-a",
      "place-c",
    ]);
  });

  it("공식 출처순은 AI 순위와 무관하게 기존 계약을 유지한다", () => {
    expect(sortCandidatePlaces(withRank(snapshot), "official_sources").map(({ id }) => id)).toEqual([
      "place-c",
      "place-b",
      "place-a",
    ]);
  });
});
