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
    reviewMethod: z.enum(["manual", "verified_relation_auto"]).optional(),
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
  relation: "selected_work" | "actor_other_work";
  officialSourceCount: number;
  aiRank?: number; // #48 — 서버 파생 순위(1=최고). 원시 점수는 클라이언트로 내리지 않는다
};

type Localized = z.infer<typeof LocalizedText>;

export type AiRelevance = { aiRank: number; aiReason?: Localized };

/**
 * #48 서버 파생 — 후보별 AI 관련성 순위·검토된 이유.
 * PR #70 리뷰 반영: ① 원시 점수·검토 메타는 RSC/액션 응답으로 직렬화하지 않도록
 * 순위(aiRank, dense rank)와 이유(ko/en)만 파생한다. ② 정렬·이유 모두 후보의
 * 선택 관련 작품(relationDetails) 범위만 사용한다 — 무관 작품 고득점은 순서에 영향 없음(#65 정합).
 * 미검토·스냅샷 없음은 파생 없음(폴백). 배지 하한은 이유 노출에만 적용하며, 검토된
 * 점수는 하한 아래여도 관련성 정렬에 사용한다. 동점은 workId 오름차순으로 결정적.
 */
export function deriveAiRelevance(
  candidates: readonly { id: string; relationDetails: { workId: string }[] }[],
  snapshot: PlaceRankingSnapshot | null | undefined,
): Map<string, AiRelevance> {
  if (!snapshot) return new Map();
  const eligible = new Map<string, { score: number; workId: string; reason?: Localized }>();
  for (const ranking of snapshot.rankings) {
    if (!ranking.reviewed) continue;
    eligible.set(`${ranking.workId}|${ranking.placeId}`, {
      score: ranking.score,
      workId: ranking.workId,
      reason: ranking.score >= snapshot.meta.badgeThreshold ? ranking.reason : undefined,
    });
  }

  const best = new Map<string, { score: number; workId: string; reason?: Localized }>();
  for (const candidate of candidates) {
    for (const detail of candidate.relationDetails) {
      const hit = eligible.get(`${detail.workId}|${candidate.id}`);
      if (!hit) continue;
      const current = best.get(candidate.id);
      if (
        !current
        || hit.score > current.score
        || (hit.score === current.score && hit.workId.localeCompare(current.workId, "en") < 0)
      ) {
        best.set(candidate.id, hit);
      }
    }
  }

  const uniqueScores = [...new Set([...best.values()].map(({ score }) => score))].sort((a, b) => b - a);
  const rankOf = new Map(uniqueScores.map((score, index) => [score, index + 1]));
  return new Map(
    [...best].map(([placeId, { score, reason }]) => [
      placeId,
      { aiRank: rankOf.get(score)!, aiReason: reason },
    ]),
  );
}

export function sortCandidatePlaces<T extends RankablePlace>(
  candidates: readonly T[],
  sortBy: "relevance" | "official_sources",
): T[] {
  // #48: aiRank는 서버가 선택 관련 작품 범위로 파생한 순위 — 없으면 출처·ID 폴백
  const rankOf = (candidate: T): number => candidate.aiRank ?? Infinity;
  const relationOf = (candidate: T): number => candidate.relation === "selected_work" ? 0 : 1;

  return [...candidates].sort((a, b) =>
    sortBy === "relevance"
      ? relationOf(a) - relationOf(b)
        || rankOf(a) - rankOf(b)
        || b.officialSourceCount - a.officialSourceCount
        || a.id.localeCompare(b.id, "en")
      : b.officialSourceCount - a.officialSourceCount
        || relationOf(a) - relationOf(b)
        || a.id.localeCompare(b.id, "en"),
  );
}
