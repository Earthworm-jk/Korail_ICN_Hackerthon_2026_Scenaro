import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadPlaceRankings } from "../place-rankings-snapshot";
import { reviewedReasonFor, type PlaceRankingSnapshot } from "../place-ranking";

// #48 정렬 연결 — 스냅샷 로더(미탑재=null 폴백, 계약 위반=로드 실패)와
// 검토된 관련 이유 표시(점수 비노출·선택 관련 작품만·결정적)

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

describe("reviewedReasonFor (#48 — 화면 표시)", () => {
  const snapshot: PlaceRankingSnapshot = {
    meta: META,
    rankings: [
      { workId: "w-a", placeId: "p-1", score: 0.9, reviewed: true, reviewedAt: "2026-08-09", reviewedBy: "r", reason: { ko: "가", en: "A" } },
      { workId: "w-b", placeId: "p-1", score: 0.8, reviewed: true, reviewedAt: "2026-08-09", reviewedBy: "r", reason: { ko: "나", en: "B" } },
      { workId: "w-c", placeId: "p-1", score: 0.95, reviewed: false },
      { workId: "w-d", placeId: "p-1", score: 0.6, reviewed: true, reviewedAt: "2026-08-09", reviewedBy: "r" },
    ],
  };

  it("배지 기준을 넘는 검토 항목 중 최고점의 이유를 준다", () => {
    expect(reviewedReasonFor("p-1", ["w-a", "w-b"], snapshot)?.ko).toBe("가");
  });

  it("미검토(w-c)·하한 미달(w-d)·무관 작품은 쓰지 않는다", () => {
    expect(reviewedReasonFor("p-1", ["w-c", "w-d"], snapshot)).toBeNull();
    // 선택 관련 작품이 w-b뿐이면 최고점(w-a)이 있어도 w-b의 이유를 쓴다 (#65 규칙 정합)
    expect(reviewedReasonFor("p-1", ["w-b"], snapshot)?.ko).toBe("나");
  });

  it("스냅샷 없음·다른 장소면 null이다", () => {
    expect(reviewedReasonFor("p-1", ["w-a"], null)).toBeNull();
    expect(reviewedReasonFor("p-2", ["w-a"], snapshot)).toBeNull();
  });
});
