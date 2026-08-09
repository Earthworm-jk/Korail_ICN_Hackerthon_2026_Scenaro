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

type Localized = z.infer<typeof LocalizedText>;

/**
 * #48 화면 표시 — 배지 기준을 넘는 검토 항목의 관련 이유(ko/en)만 반환한다.
 * 내부 점수는 노출하지 않으며, 선택과 무관한 작품의 이유는 쓰지 않도록
 * 호출부가 선택 관련 workIds(후보의 relationDetails 기준)를 넘긴다 (#65 규칙과 정합).
 * 동점은 workId 오름차순으로 결정적이다.
 */
export function reviewedReasonFor(
  placeId: string,
  relevantWorkIds: readonly string[],
  snapshot: PlaceRankingSnapshot | null | undefined,
): Localized | null {
  if (!snapshot) return null;
  let best: { score: number; workId: string; reason: Localized } | null = null;
  for (const ranking of snapshot.rankings) {
    if (ranking.placeId !== placeId || !ranking.reviewed || !ranking.reason) continue;
    if (ranking.score < snapshot.meta.badgeThreshold) continue;
    if (!relevantWorkIds.includes(ranking.workId)) continue;
    if (
      !best
      || ranking.score > best.score
      || (ranking.score === best.score && ranking.workId.localeCompare(best.workId, "en") < 0)
    ) {
      best = { score: ranking.score, workId: ranking.workId, reason: ranking.reason };
    }
  }
  return best?.reason ?? null;
}

export function sortCandidatePlaces<T extends RankablePlace>(
  candidates: readonly T[],
  sortBy: "relevance" | "official_sources",
  snapshot?: PlaceRankingSnapshot,
): T[] {
  const scores = new Map<string, number>();
  const scoreThreshold = snapshot?.meta.badgeThreshold ?? Infinity;
  for (const ranking of snapshot?.rankings ?? []) {
    // #48 부분 스냅샷: 미검토·하한 미달은 모두 AI 점수 없음으로 취급한다.
    if (ranking.reviewed && ranking.score >= scoreThreshold) {
      scores.set(`${ranking.workId}|${ranking.placeId}`, ranking.score);
    }
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
