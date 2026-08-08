import { z } from "zod";
import { IsoDate, IsoDateTime, LocalizedText, NonEmptyId } from "./types/schema";

const RankingBase = z.object({
  workId: NonEmptyId,
  placeId: NonEmptyId,
  score: z.number().finite().min(-1).max(1),
});

export const PlaceRanking = z.discriminatedUnion("reviewed", [
  RankingBase.extend({ reviewed: z.literal(false) }),
  RankingBase.extend({
    reviewed: z.literal(true),
    reviewedAt: IsoDate,
    reviewedBy: NonEmptyId,
    reason: LocalizedText.optional(),
  }),
]);

const PlaceRankingSnapshotBase = z
  .object({
    meta: z.object({
      model: NonEmptyId,
      inputRuleVersion: NonEmptyId,
      generatedAt: IsoDateTime,
      badgeThreshold: z.number().finite().min(-1).max(1),
    }),
    rankings: z.array(PlaceRanking),
  })
  .superRefine(({ meta, rankings }, ctx) => {
    const seen = new Set<string>();
    rankings.forEach((ranking, index) => {
      const key = `${ranking.workId}|${ranking.placeId}`;
      if (seen.has(key)) {
        ctx.addIssue({ code: "custom", path: ["rankings", index], message: `중복 랭킹: ${key}` });
      }
      seen.add(key);

      if (ranking.reviewed && ranking.score >= meta.badgeThreshold && !ranking.reason) {
        ctx.addIssue({
          code: "custom",
          path: ["rankings", index, "reason"],
          message: "배지 기준을 넘은 검토 항목에는 reason.ko/en이 필요합니다.",
        });
      }
    });
  });

export type PlaceRankingSnapshot = z.infer<typeof PlaceRankingSnapshotBase>;

/** #20 로드 검증에 연결할 수 있도록 스키마 검증과 참조 무결성을 한 경로로 제공한다. */
export function createPlaceRankingSnapshotSchema(workIds: ReadonlySet<string>, placeIds: ReadonlySet<string>) {
  return PlaceRankingSnapshotBase.superRefine(({ rankings }, ctx) => {
    rankings.forEach((ranking, index) => {
      if (!workIds.has(ranking.workId)) {
        ctx.addIssue({
          code: "custom",
          path: ["rankings", index, "workId"],
          message: `존재하지 않는 작품 참조: ${ranking.workId}`,
        });
      }
      if (!placeIds.has(ranking.placeId)) {
        ctx.addIssue({
          code: "custom",
          path: ["rankings", index, "placeId"],
          message: `존재하지 않는 촬영지 참조: ${ranking.placeId}`,
        });
      }
    });
  });
}

type RankablePlace = {
  id: string;
  workIds: string[];
  relation: "selected_work" | "actor_other_work";
  officialSourceCount: number;
};

export function sortCandidatePlaces<T extends RankablePlace>(
  candidates: readonly T[],
  sortBy: "relevance" | "official_sources",
  snapshot?: PlaceRankingSnapshot,
): T[] {
  const scores = new Map<string, number>();
  for (const ranking of snapshot?.rankings ?? []) {
    if (ranking.reviewed) scores.set(`${ranking.workId}|${ranking.placeId}`, ranking.score);
  }

  const scoreOf = (candidate: T): number =>
    Math.max(...candidate.workIds.map((workId) => scores.get(`${workId}|${candidate.id}`) ?? -Infinity));
  const relationOf = (candidate: T): number => candidate.relation === "selected_work" ? 0 : 1;

  return [...candidates].sort((a, b) =>
    sortBy === "relevance"
      ? relationOf(a) - relationOf(b)
        || scoreOf(b) - scoreOf(a)
        || b.officialSourceCount - a.officialSourceCount
        || a.id.localeCompare(b.id, "en")
      : b.officialSourceCount - a.officialSourceCount
        || relationOf(a) - relationOf(b)
        || a.id.localeCompare(b.id, "en"),
  );
}
