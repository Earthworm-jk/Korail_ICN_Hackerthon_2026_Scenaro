/**
 * #80 테마체험 권역 — 스키마와 결정적 선택 규칙 (#14 v0.6 · #38 계약)
 *
 * 두 벌로 나뉜다.
 *   - theme-zones.json         검증된 권역 사실 (공식 관광정보 출처·검증일)
 *   - theme-zone-rankings.json 작품×권역 관련성 스냅샷 (오프라인 임베딩 → 사람 검토)
 *
 * 런타임은 검토된 스냅샷만 결정적으로 읽는다 — 실행 중 OpenAI 호출은 없다 (#48 계약 유지).
 * 근거 2종(권역 공식 출처·작품 서사 연결 근거)이 모두 확보된 항목만 화면에 나갈 수 있도록
 * 배지 기준을 넘은 검토 항목에는 reason과 sourceUrls를 함께 요구한다.
 */
import { z } from "zod";
import { HttpUrl, IsoDate, IsoDateTime, LocalizedText, NonEmptyId } from "./types/schema";

export const ThemeZone = z.object({
  id: NonEmptyId,
  name: LocalizedText, // 권역명 — 특정 업체가 아니라 권역 단위 (#38)
  theme: LocalizedText, // 체험 테마 — 카드 제목
  regionId: NonEmptyId, // Station.regionId와 같은 값 공간 (#6 권역 필드 계약)
  sourceUrls: z.array(HttpUrl).min(1), // 권역 자체의 공식 관광정보 출처
  verifiedAt: IsoDate,
});

export type ThemeZoneT = z.infer<typeof ThemeZone>;

const RankingBase = z.object({
  workId: NonEmptyId,
  zoneId: NonEmptyId,
  score: z.number().finite().min(-1).max(1),
});

export const ThemeZoneRanking = z.discriminatedUnion("reviewed", [
  RankingBase.extend({ reviewed: z.literal(false) }),
  RankingBase.extend({
    reviewed: z.literal(true),
    reviewedAt: IsoDate,
    reviewedBy: NonEmptyId,
    // 작품 서사와 테마의 연결 근거 — 권역 공식 출처만으로는 이 연결이 증명되지 않는다 (#80)
    sourceUrls: z.array(HttpUrl).min(1).optional(),
    reason: LocalizedText.optional(),
  }),
]);

const ThemeZoneRankingSnapshotBase = z
  .object({
    meta: z.object({
      model: NonEmptyId,
      inputRuleVersion: NonEmptyId,
      generatedAt: IsoDateTime,
      badgeThreshold: z.number().finite().min(-1).max(1),
    }),
    rankings: z.array(ThemeZoneRanking),
  })
  .superRefine(({ meta, rankings }, ctx) => {
    const seen = new Set<string>();
    rankings.forEach((ranking, index) => {
      const key = `${ranking.workId}|${ranking.zoneId}`;
      if (seen.has(key)) {
        ctx.addIssue({ code: "custom", path: ["rankings", index], message: `중복 랭킹: ${key}` });
      }
      seen.add(key);

      if (!ranking.reviewed || ranking.score < meta.badgeThreshold) return;
      // 화면에 나갈 수 있는 항목 = 검토 완료 + 하한 통과. 근거 2종 중 하나라도 없으면 로드 실패.
      if (!ranking.reason) {
        ctx.addIssue({
          code: "custom",
          path: ["rankings", index, "reason"],
          message: "배지 기준을 넘은 검토 항목에는 reason.ko/en이 필요합니다.",
        });
      }
      if (!ranking.sourceUrls?.length) {
        ctx.addIssue({
          code: "custom",
          path: ["rankings", index, "sourceUrls"],
          message: "배지 기준을 넘은 검토 항목에는 작품 서사 연결 근거 sourceUrls가 필요합니다.",
        });
      }
    });
  });

export type ThemeZoneRankingSnapshot = z.infer<typeof ThemeZoneRankingSnapshotBase>;

/** #20 로드 검증 — 스키마와 참조 무결성을 한 경로로 제공한다. */
export function createThemeZoneRankingSnapshotSchema(
  workIds: ReadonlySet<string>,
  zoneIds: ReadonlySet<string>,
) {
  return ThemeZoneRankingSnapshotBase.superRefine(({ rankings }, ctx) => {
    rankings.forEach((ranking, index) => {
      if (!workIds.has(ranking.workId)) {
        ctx.addIssue({
          code: "custom",
          path: ["rankings", index, "workId"],
          message: `존재하지 않는 작품 참조: ${ranking.workId}`,
        });
      }
      if (!zoneIds.has(ranking.zoneId)) {
        ctx.addIssue({
          code: "custom",
          path: ["rankings", index, "zoneId"],
          message: `존재하지 않는 권역 참조: ${ranking.zoneId}`,
        });
      }
    });
  });
}

/** 카드에 실제로 나가는 값 — 원시 점수·검토 메타는 포함하지 않는다 (PR #70 리뷰와 같은 규율) */
export type ThemeExperiencePick = {
  zone: Pick<ThemeZoneT, "id" | "name" | "theme" | "regionId">;
  workId: string;
  reason: { ko: string; en: string };
};

/**
 * 결정적 선택 — 일정 권역 ∩ 선택 작품으로 후보를 제한하고, 검토·하한 통과 항목 중
 * 점수 내림차순 → zoneId → workId 순으로 1건을 고른다 (#3 타이브레이커 규율).
 * 같은 입력이면 언제나 같은 결과가 나온다.
 */
export function pickThemeExperience(params: {
  zones: ThemeZoneT[];
  snapshot: ThemeZoneRankingSnapshot;
  selectedWorkIds: readonly string[];
  itineraryRegionIds: readonly string[];
}): ThemeExperiencePick | null {
  const { zones, snapshot, selectedWorkIds, itineraryRegionIds } = params;
  const zoneById = new Map(zones.map((zone) => [zone.id, zone]));
  const regionIds = new Set(itineraryRegionIds);
  const workIds = new Set(selectedWorkIds);

  const candidates = snapshot.rankings
    .filter((ranking) => ranking.reviewed && ranking.score >= snapshot.meta.badgeThreshold)
    .filter((ranking) => workIds.has(ranking.workId))
    .filter((ranking) => {
      const zone = zoneById.get(ranking.zoneId);
      return zone !== undefined && regionIds.has(zone.regionId);
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.zoneId.localeCompare(b.zoneId) ||
        a.workId.localeCompare(b.workId),
    );

  const best = candidates[0];
  if (!best || !best.reviewed || !best.reason) return null;
  const zone = zoneById.get(best.zoneId)!;
  return {
    zone: { id: zone.id, name: zone.name, theme: zone.theme, regionId: zone.regionId },
    workId: best.workId,
    reason: best.reason,
  };
}
