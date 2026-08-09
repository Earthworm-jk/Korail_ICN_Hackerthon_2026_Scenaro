import { describe, expect, it } from "vitest";
import { z } from "zod";
import stationsSeed from "../../data/stations.json";
import themeZonesSeed from "../../data/theme-zones.json";
import themeZoneRankingsSeed from "../../data/theme-zone-rankings.json";
import worksSeed from "../../data/works.json";
import { planItinerary } from "../actions/itinerary";
import { getThemeExperience } from "../actions/theme-experience";
import {
  ThemeZone,
  createThemeZoneRankingSnapshotSchema,
  pickThemeExperience,
  type ThemeZoneRankingSnapshot,
  type ThemeZoneT,
} from "../theme-zones";

const zones: ThemeZoneT[] = [
  {
    id: "zone-a",
    name: { ko: "가 권역", en: "Zone A" },
    theme: { ko: "가 테마", en: "Theme A" },
    regionId: "seoul_metro",
    sourceUrls: ["https://example.org/zone-a"],
    verifiedAt: "2026-08-09",
  },
  {
    id: "zone-b",
    name: { ko: "나 권역", en: "Zone B" },
    theme: { ko: "나 테마", en: "Theme B" },
    regionId: "seoul_metro",
    sourceUrls: ["https://example.org/zone-b"],
    verifiedAt: "2026-08-09",
  },
  {
    id: "zone-c",
    name: { ko: "다 권역", en: "Zone C" },
    theme: { ko: "다 테마", en: "Theme C" },
    regionId: "gangwon",
    sourceUrls: ["https://example.org/zone-c"],
    verifiedAt: "2026-08-09",
  },
];

const reviewed = (workId: string, zoneId: string, score: number) => ({
  workId,
  zoneId,
  score,
  reviewed: true as const,
  reviewedAt: "2026-08-09",
  reviewedBy: "tester",
  sourceUrls: ["https://example.org/narrative"],
  reason: { ko: `${zoneId} 이유`, en: `${zoneId} reason` },
});

/** 계약 위반 fixture — 필수 키를 지운 값으로 로드 실패를 확인한다 */
const omit = <T extends object, K extends keyof T>(value: T, key: K) => {
  const copy = { ...value };
  delete copy[key];
  return copy as never;
};

const parsedZones = z.array(ThemeZone).parse(themeZonesSeed);

const snapshotOf = (rankings: ThemeZoneRankingSnapshot["rankings"]): ThemeZoneRankingSnapshot => ({
  meta: {
    model: "text-embedding-model",
    inputRuleVersion: "v1",
    generatedAt: "2026-08-09T12:00:00+09:00",
    badgeThreshold: 0.2,
  },
  rankings,
});

describe("테마체험 권역 선택 (#80 — 결정적 규칙)", () => {
  it("일정 권역·선택 작품과 맞고 검토·하한을 통과한 항목을 고른다", () => {
    const pick = pickThemeExperience({
      zones,
      snapshot: snapshotOf([reviewed("work-x", "zone-a", 0.31)]),
      selectedWorkIds: ["work-x"],
      itineraryRegionIds: ["seoul_metro"],
    });
    expect(pick?.zone.id).toBe("zone-a");
    expect(pick?.reason.en).toBe("zone-a reason");
  });

  it("하한 미달 항목은 고르지 않는다 — '추천 없음' 상태로 이어진다", () => {
    const pick = pickThemeExperience({
      zones,
      snapshot: snapshotOf([reviewed("work-x", "zone-a", 0.19)]),
      selectedWorkIds: ["work-x"],
      itineraryRegionIds: ["seoul_metro"],
    });
    expect(pick).toBeNull();
  });

  it("미검토 항목은 점수가 높아도 고르지 않는다 — 사람 검토가 표시 게이트다", () => {
    const pick = pickThemeExperience({
      zones,
      snapshot: snapshotOf([{ workId: "work-x", zoneId: "zone-a", score: 0.99, reviewed: false }]),
      selectedWorkIds: ["work-x"],
      itineraryRegionIds: ["seoul_metro"],
    });
    expect(pick).toBeNull();
  });

  it("일정에 없는 권역은 고르지 않는다", () => {
    const pick = pickThemeExperience({
      zones,
      snapshot: snapshotOf([reviewed("work-x", "zone-c", 0.9)]),
      selectedWorkIds: ["work-x"],
      itineraryRegionIds: ["seoul_metro"],
    });
    expect(pick).toBeNull();
  });

  it("선택하지 않은 작품의 관계는 고르지 않는다", () => {
    const pick = pickThemeExperience({
      zones,
      snapshot: snapshotOf([reviewed("work-y", "zone-a", 0.9)]),
      selectedWorkIds: ["work-x"],
      itineraryRegionIds: ["seoul_metro"],
    });
    expect(pick).toBeNull();
  });

  it("동점이면 zoneId·workId 순으로 결정적으로 고른다 — 입력 순서에 흔들리지 않는다", () => {
    const rankings = [reviewed("work-x", "zone-b", 0.5), reviewed("work-x", "zone-a", 0.5)];
    const forward = pickThemeExperience({
      zones,
      snapshot: snapshotOf(rankings),
      selectedWorkIds: ["work-x"],
      itineraryRegionIds: ["seoul_metro"],
    });
    const reversed = pickThemeExperience({
      zones,
      snapshot: snapshotOf([...rankings].reverse()),
      selectedWorkIds: ["work-x"],
      itineraryRegionIds: ["seoul_metro"],
    });
    expect(forward?.zone.id).toBe("zone-a");
    expect(reversed?.zone.id).toBe("zone-a");
  });

  it("점수가 높은 항목을 먼저 고른다", () => {
    const pick = pickThemeExperience({
      zones,
      snapshot: snapshotOf([reviewed("work-x", "zone-a", 0.3), reviewed("work-x", "zone-b", 0.8)]),
      selectedWorkIds: ["work-x"],
      itineraryRegionIds: ["seoul_metro"],
    });
    expect(pick?.zone.id).toBe("zone-b");
  });
});

describe("테마체험 스냅샷 계약 (#80 — 근거 2종 강제)", () => {
  const schema = createThemeZoneRankingSnapshotSchema(
    new Set(["work-x"]),
    new Set(["zone-a"]),
  );

  it("하한을 넘은 검토 항목에 reason이 없으면 로드에 실패한다", () => {
    const result = schema.safeParse(snapshotOf([omit(reviewed("work-x", "zone-a", 0.5), "reason")]));
    expect(result.success).toBe(false);
  });

  it("하한을 넘은 검토 항목에 서사 근거 sourceUrls가 없으면 로드에 실패한다", () => {
    const result = schema.safeParse(snapshotOf([omit(reviewed("work-x", "zone-a", 0.5), "sourceUrls")]));
    expect(result.success).toBe(false);
  });

  it("존재하지 않는 작품·권역 참조는 로드에 실패한다", () => {
    expect(schema.safeParse(snapshotOf([reviewed("work-none", "zone-a", 0.5)])).success).toBe(false);
    expect(schema.safeParse(snapshotOf([reviewed("work-x", "zone-none", 0.5)])).success).toBe(false);
  });

  it("같은 작품×권역 쌍이 중복되면 로드에 실패한다", () => {
    const result = schema.safeParse(
      snapshotOf([reviewed("work-x", "zone-a", 0.5), reviewed("work-x", "zone-a", 0.6)]),
    );
    expect(result.success).toBe(false);
  });
});

// #80 완료 조건 1 — 운영 시드와 실제 일정으로 성공 경로를 고정한다.
// fixture가 아니라 커밋된 시드를 읽으므로, 검토 항목이 빠지면 이 테스트가 실패한다.
describe("운영 성공 경로 (#80 — 실제 일정에서 카드가 나온다)", () => {
  const request = {
    arrivalAt: "2026-08-12T10:00:00+09:00",
    departureAt: "2026-08-14T18:00:00+09:00",
    airportReadyAt: "2026-08-12T12:00:00+09:00",
    airportArrivalDeadline: "2026-08-14T16:00:00+09:00",
    selectedActorIds: [],
    selectedWorkIds: ["work-the-king"],
    excludedPlaceIds: [],
  };

  it("《더 킹》 일정의 서울 권역에서 status ok와 ko/en 이유가 나온다", async () => {
    const planned = await planItinerary(request);
    expect(planned.ok).toBe(true);
    if (!planned.ok || planned.result.status !== "planned") return;

    const regionIds = [
      ...new Set(planned.result.days.flatMap((day) => day.regionWindows.map((w) => w.regionId))),
    ];
    expect(regionIds).toContain("seoul_metro");

    const result = await getThemeExperience({
      selectedWorkIds: request.selectedWorkIds,
      itineraryRegionIds: regionIds,
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.regionId).toBe("seoul_metro");
    expect(result.zoneName.ko).toBeTruthy();
    expect(result.zoneName.en).toBeTruthy();
    expect(result.reason.ko).toBeTruthy();
    expect(result.reason.en).toBeTruthy();
    // 원시 점수·검토 메타는 응답에 실리지 않는다 (PR #70 리뷰 규율)
    expect(Object.keys(result).sort()).toEqual(["reason", "regionId", "status", "theme", "zoneName"]);
  });

  it("서사 근거가 없는 《도깨비》 단독 선택은 같은 일정에서도 추천 없음이다", async () => {
    const planned = await planItinerary({ ...request, selectedWorkIds: ["work-goblin"] });
    expect(planned.ok).toBe(true);
    if (!planned.ok || planned.result.status !== "planned") return;

    const regionIds = [
      ...new Set(planned.result.days.flatMap((day) => day.regionWindows.map((w) => w.regionId))),
    ];
    const result = await getThemeExperience({
      selectedWorkIds: ["work-goblin"],
      itineraryRegionIds: regionIds,
    });
    expect(result.status).toBe("none");
  });
});

describe("운영 시드 (#20 참조 무결성)", () => {
  it("권역 시드는 계약을 통과하고 공식 출처·검증일을 갖는다", () => {
    expect(parsedZones.length).toBeGreaterThan(0);
    for (const zone of parsedZones) {
      expect(zone.sourceUrls.length, zone.id).toBeGreaterThan(0);
    }
  });

  it("권역의 regionId는 역 시드의 권역과 같은 값 공간을 쓴다", () => {
    const regionIds = new Set(stationsSeed.map((station) => station.regionId));
    for (const zone of parsedZones) {
      expect(regionIds.has(zone.regionId), `${zone.id}: ${zone.regionId}`).toBe(true);
    }
  });

  // #80 보완 1 — API 호출 전에 등록한 양성·음성 기대 조합. 임계값과 무관하게 순서를 고정한다.
  // 양성: 대한제국 배경 작품 × 대한제국 황궁 권역 / 음성: 시대 연결이 없는 현대물
  it("사전 등록한 양성 조합이 음성 조합보다 높은 점수를 받는다", () => {
    const scoreOf = (workId: string, zoneId: string) => {
      const row = themeZoneRankingsSeed.rankings.find(
        (r) => r.workId === workId && r.zoneId === zoneId,
      );
      expect(row, `${workId} × ${zoneId}`).toBeDefined();
      return row!.score;
    };
    const positive = scoreOf("work-the-king", "zone-seoul-jeongdong-daehan");
    const negatives = [
      scoreOf("work-yumi-cells", "zone-seoul-jeongdong-daehan"),
      scoreOf("work-little-women", "zone-seoul-jeongdong-daehan"),
      scoreOf("work-little-women", "zone-seoul-bukchon-hanok"),
    ];
    for (const negative of negatives) expect(positive).toBeGreaterThan(negative);
  });

  // #80 승인 계약 — 표시 게이트는 사람 검토와 근거 완비다. badgeThreshold는 v1 호환 필드로
  // 음수 유사도만 배제하며, 표시 여부를 결정하지 않는다.
  it("검토 항목은 근거 2종(권역 공식 출처·작품 서사 근거)을 모두 갖는다", () => {
    const reviewedRows = themeZoneRankingsSeed.rankings.filter((r) => r.reviewed);
    expect(reviewedRows.length).toBeGreaterThan(0);
    const zoneById = new Map(parsedZones.map((zone) => [zone.id, zone]));
    for (const row of reviewedRows) {
      expect(row.sourceUrls?.length, `${row.workId} × ${row.zoneId}: 서사 근거`).toBeGreaterThan(0);
      expect(row.reason?.ko, `${row.workId} × ${row.zoneId}: reason.ko`).toBeTruthy();
      expect(row.reason?.en, `${row.workId} × ${row.zoneId}: reason.en`).toBeTruthy();
      expect(zoneById.get(row.zoneId)?.sourceUrls.length, `${row.zoneId}: 권역 출처`).toBeGreaterThan(0);
    }
  });

  it("공식 서사 근거가 없는 도깨비 항목은 미검토로 남아 화면에 나가지 않는다", () => {
    const goblinRows = themeZoneRankingsSeed.rankings.filter((r) => r.workId === "work-goblin");
    expect(goblinRows.length).toBeGreaterThan(0);
    for (const row of goblinRows) expect(row.reviewed, `${row.zoneId}`).toBe(false);
  });

  it("랭킹 스냅샷은 시드 참조 무결성을 만족한다", () => {
    const schema = createThemeZoneRankingSnapshotSchema(
      new Set(worksSeed.map((work) => work.id)),
      new Set(parsedZones.map((zone) => zone.id)),
    );
    expect(schema.safeParse(themeZoneRankingsSeed).success).toBe(true);
  });
});
