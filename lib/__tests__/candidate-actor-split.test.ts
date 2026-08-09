import { describe, expect, it } from "vitest";
import { getCandidatePlaces } from "../actions/places";
import { initialSelectedIds } from "../candidates";
import { formatEpisodeLabel } from "../episode-label";
import { deriveStrictSelectionMemberships } from "../selection-candidates";
import type { WorkPlaceRelationT } from "../types/schema";

const KIM = "actor-kim-go-eun";
const THE_KING = "work-the-king";

const relation = (
  placeId: string,
  workId: string,
  extra: Partial<WorkPlaceRelationT> = {},
): WorkPlaceRelationT => ({
  placeId,
  workId,
  sourceUrls: ["https://example.com/source"],
  verifiedAt: "2026-08-09",
  reviewed: true,
  ...extra,
});

describe("#51 엄격 후보 집합 순수 계약", () => {
  const relations: WorkPlaceRelationT[] = [
    relation("actor-confirmed", "actor-work", {
      actorPresenceReviewed: true,
      featuredActorIds: [KIM],
    }),
    relation("actor-absent", "actor-work", {
      actorPresenceReviewed: true,
      featuredActorIds: [],
    }),
    relation("actor-unreviewed", "actor-work"),
    relation("work-only", THE_KING, {
      actorPresenceReviewed: true,
      featuredActorIds: [],
    }),
    relation("both", THE_KING, {
      actorPresenceReviewed: true,
      featuredActorIds: [KIM],
    }),
    relation("unreviewed-relation", THE_KING, { reviewed: false }),
  ];

  it("배우 후보는 장면 등장 확정 관계만 반환한다", () => {
    const memberships = deriveStrictSelectionMemberships(
      relations,
      new Set([KIM]),
      new Set(),
    );
    expect([...memberships.keys()].sort()).toEqual(["actor-confirmed", "both"]);
  });

  it("작품 후보는 검토된 작품 관계 전체이며 장면 배우 미등장을 요구하지 않는다", () => {
    const memberships = deriveStrictSelectionMemberships(
      relations,
      new Set(),
      new Set([THE_KING]),
    );
    expect([...memberships.keys()].sort()).toEqual(["both", "work-only"]);
  });

  it("배우+작품은 합집합이고, 겹치는 장소는 양쪽 그룹 소속으로 한 번만 남는다", () => {
    const memberships = deriveStrictSelectionMemberships(
      relations,
      new Set([KIM]),
      new Set([THE_KING]),
    );
    expect([...memberships.keys()].sort()).toEqual(["actor-confirmed", "both", "work-only"]);
    expect(memberships.get("both")).toMatchObject({ actor: true, work: true });
  });
});

describe("formatEpisodeLabel — 영어 경로 한글 잔류 방지", () => {
  it("ko는 원문, en은 Ep. 숫자 표기로 바꾼다", () => {
    expect(formatEpisodeLabel("ko", "1화")).toBe("1화");
    expect(formatEpisodeLabel("en", "1화")).toBe("Ep. 1");
    expect(formatEpisodeLabel("en", "7–8화")).toBe("Ep. 7–8");
    expect(formatEpisodeLabel("en", "1화·14화")).toBe("Ep. 1·14");
  });

  it("숫자 패턴이 아닌 표기는 영어에서 숨기고, 시드 전체 회차가 en 포맷에서 한글 0건이다", async () => {
    expect(formatEpisodeLabel("en", "특별편")).toBeNull();
    expect(formatEpisodeLabel("en", undefined)).toBeNull();
    const { candidates } = await getCandidatePlaces({ selectedActorIds: [KIM], selectedWorkIds: [] });
    for (const candidate of candidates) {
      for (const detail of candidate.relationDetails) {
        const formatted = formatEpisodeLabel("en", detail.episodeLabel);
        if (formatted) expect(/[가-힣]/.test(formatted), `${candidate.id}: ${formatted}`).toBe(false);
      }
    }
  });
});

describe("실시드 엄격 후보 회귀", () => {
  it("김고은 배우 결과는 등장 확정 20곳만 반환하고 타 배우 전용 장소를 노출하지 않는다", async () => {
    const { candidates } = await getCandidatePlaces({ selectedActorIds: [KIM], selectedWorkIds: [] });
    expect(candidates).toHaveLength(20);
    expect(candidates.every(({ selectionGroups }) => selectionGroups.includes("actor"))).toBe(true);
    expect(candidates.some(({ id }) => id === "place-yeongjin-beach")).toBe(true);
    for (const id of [
      "place-samyang-ranch",
      "place-deoksugung-stone-wall-road",
      "place-gyeonggijeon-shrine",
    ]) {
      expect(candidates.some((candidate) => candidate.id === id), id).toBe(false);
    }
  });

  it("작품 결과는 선택 배우 등장 여부와 무관하게 검토 관계 전체를 유지한다", async () => {
    const { candidates } = await getCandidatePlaces({
      selectedActorIds: [],
      selectedWorkIds: [THE_KING],
    });
    expect(candidates.map(({ id }) => id)).toContain("place-gyeonggijeon-shrine");
    expect(candidates.every(({ selectionGroups }) => selectionGroups.includes("work"))).toBe(true);
  });

  it("복합 결과는 배우·작품 단독 결과의 장소 합집합과 정확히 같다", async () => {
    const [actor, work, combined] = await Promise.all([
      getCandidatePlaces({ selectedActorIds: [KIM], selectedWorkIds: [] }),
      getCandidatePlaces({ selectedActorIds: [], selectedWorkIds: [THE_KING] }),
      getCandidatePlaces({ selectedActorIds: [KIM], selectedWorkIds: [THE_KING] }),
    ]);
    const union = [...new Set([
      ...actor.candidates.map(({ id }) => id),
      ...work.candidates.map(({ id }) => id),
    ])].sort();
    expect(combined.candidates.map(({ id }) => id).sort()).toEqual(union);
    for (const candidate of combined.candidates) {
      expect(new Set(candidate.relationDetails.map(({ workId }) => workId)).size)
        .toBe(candidate.relationDetails.length);
    }
  });

  it("엄격 후보는 전부 초기 선택하며 카드 회차·장면은 검증 관계 그대로 내려온다", async () => {
    const { candidates } = await getCandidatePlaces({ selectedActorIds: [KIM], selectedWorkIds: [] });
    expect(initialSelectedIds(candidates)).toEqual(candidates.map(({ id }) => id));
    const lalaMuri = candidates.find(({ id }) => id === "place-lala-muri");
    expect(lalaMuri?.relationDetails).toHaveLength(1);
    expect(lalaMuri?.relationDetails[0].episodeLabel).toBe("1화");
    expect(lalaMuri?.relationDetails[0].sceneNote?.en).toBeTruthy();
  });
});
