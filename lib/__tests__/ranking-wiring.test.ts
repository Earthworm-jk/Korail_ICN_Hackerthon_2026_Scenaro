import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadPlaceRankings } from "../place-rankings-snapshot";
import { deriveAiRelevance, type PlaceRankingSnapshot } from "../place-ranking";
import { getCandidatePlaces } from "../actions/places";

// #48 정렬 연결 (PR #70 리뷰 반영) — 스냅샷 로더(미탑재=null·계약 위반=실패)와
// 서버 파생값: 원시 점수·검토 메타는 클라이언트 응답에 실리지 않는다

const META = {
  model: "text-embedding-3-small",
  inputRuleVersion: "v1",
  generatedAt: "2026-08-09T12:00:00+09:00",
  badgeThreshold: 0.7,
};

function writeSnapshot(content: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "rankings-"));
  const file = join(dir, "place-rankings.json");
  writeFileSync(file, JSON.stringify(content));
  return file;
}

describe("loadPlaceRankings (#48)", () => {
  it("파일이 없으면 null — 결정적 폴백이 확정 경로다", () => {
    expect(loadPlaceRankings(join(tmpdir(), "no-such-dir", "place-rankings.json"))).toBeNull();
  });

  it("실시드 참조가 유효한 스냅샷을 로드한다", () => {
    const file = writeSnapshot({
      meta: META,
      rankings: [{
        workId: "work-goblin", placeId: "place-yeongjin-beach", score: 0.82,
        reviewed: true, reviewedAt: "2026-08-09", reviewedBy: "reviewer",
        reason: { ko: "이유", en: "Reason" },
      }],
    });
    const snapshot = loadPlaceRankings(file);
    expect(snapshot?.rankings).toHaveLength(1);
  });

  it("존재하지 않는 작품·장소 참조는 로드에 실패한다 (#20 원칙)", () => {
    const file = writeSnapshot({
      meta: META,
      rankings: [{ workId: "work-ghost", placeId: "place-yeongjin-beach", score: 0.5, reviewed: false }],
    });
    expect(() => loadPlaceRankings(file)).toThrow(/존재하지 않는 작품 참조/);
  });
});

describe("deriveAiRelevance (#48 — 서버 파생, 점수 비노출)", () => {
  const reviewed = (workId: string, placeId: string, score: number, reason: string) => ({
    workId, placeId, score,
    reviewed: true as const, reviewedAt: "2026-08-09", reviewedBy: "r",
    reason: { ko: reason, en: reason },
  });
  const snapshot: PlaceRankingSnapshot = {
    meta: META,
    rankings: [
      reviewed("w-a", "p-1", 0.9, "가"),
      reviewed("w-b", "p-1", 0.8, "나"),
      { workId: "w-c", placeId: "p-1", score: 0.95, reviewed: false },
      { ...reviewed("w-d", "p-1", 0.6, "하한"), reason: undefined },
      reviewed("w-a", "p-2", 0.8, "다"),
    ],
  };
  const cand = (id: string, workIds: string[]) => ({
    id,
    relationDetails: workIds.map((workId) => ({ workId })),
  });

  it("선택 관련 관계의 최고점 기준으로 순위·이유를 파생한다 (동점은 같은 순위)", () => {
    const derived = deriveAiRelevance([cand("p-1", ["w-a", "w-b"]), cand("p-2", ["w-a"])], snapshot);
    expect(derived.get("p-1")).toEqual({ aiRank: 1, aiReason: { ko: "가", en: "가" } });
    expect(derived.get("p-2")?.aiRank).toBe(2); // 0.8 — dense rank
  });

  it("미검토는 제외하고 하한 미달 점수는 이유 없이 순위만 파생한다", () => {
    expect(deriveAiRelevance([cand("p-1", ["w-c"])], snapshot).size).toBe(0);
    expect(deriveAiRelevance([cand("p-1", ["w-c", "w-d"])], snapshot).get("p-1"))
      .toEqual({ aiRank: 1, aiReason: undefined });
    // 선택 관련 작품이 w-b뿐이면 최고점(w-a)이 아니라 w-b의 이유를 쓴다 (#65 정합)
    expect(deriveAiRelevance([cand("p-1", ["w-b"])], snapshot).get("p-1")?.aiReason?.ko).toBe("나");
    expect(deriveAiRelevance([cand("p-1", ["w-a"])], null).size).toBe(0);
  });

  it("파생값에는 원시 점수·검토 메타가 없다 (PR #70 리뷰 1)", () => {
    const derived = deriveAiRelevance([cand("p-1", ["w-a"])], snapshot);
    const serialized = JSON.stringify([...derived.values()]);
    for (const forbidden of ['"score"', '"reviewedBy"', '"reviewedAt"', '"badgeThreshold"', '"model"']) {
      expect(serialized, `${forbidden} 노출 금지`).not.toContain(forbidden);
    }
    expect(Object.keys([...derived.values()][0]).sort()).toEqual(["aiRank", "aiReason"]);
  });
});

describe("getCandidatePlaces 응답 직렬화 가드 (#48)", () => {
  it("후보 응답에 원시 점수·검토 메타 키가 실리지 않는다", async () => {
    const response = await getCandidatePlaces({
      selectedActorIds: ["actor-kim-go-eun"],
      selectedWorkIds: [],
    });
    const serialized = JSON.stringify(response);
    for (const forbidden of ['"score"', '"reviewedBy"', '"badgeThreshold"']) {
      expect(serialized, `${forbidden} 노출 금지`).not.toContain(forbidden);
    }
  });
});
