/**
 * #48 정렬 연결 — 촬영지 랭킹 스냅샷 로더 (서버 전용)
 *
 * data/place-rankings.json은 scripts/build_place_rankings.py가 오프라인으로 생성한다
 * (OpenAI 호출은 그 스크립트에서만 — 런타임 실호출 없음, PLACE_RANKING.md).
 * 파일 미탑재는 오류가 아니라 확정 폴백 경로다: "AI 점수 없음"으로 관계·출처·ID
 * 결정적 정렬을 그대로 쓴다. 파일이 있는데 계약 위반이면 #20 원칙대로 로드에 실패한다.
 */
import "server-only";

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createPlaceRankingSnapshotSchema, type PlaceRankingSnapshot } from "./place-ranking";
import { loadRepositories } from "./repositories/json";

export function loadPlaceRankings(
  filePath: string = join(process.cwd(), "data", "place-rankings.json"),
): PlaceRankingSnapshot | null {
  if (!existsSync(filePath)) return null;
  const raw = JSON.parse(readFileSync(filePath, "utf-8"));
  const repos = loadRepositories();
  const schema = createPlaceRankingSnapshotSchema(
    new Set(repos.works.map((w) => w.id)),
    new Set(repos.places.map((p) => p.id)),
  );
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - [${issue.path.join(".") || "-"}] ${issue.message}`)
      .join("\n");
    throw new Error(`place-rankings.json 검증 실패 — ${result.error.issues.length}건:\n${issues}`);
  }
  return result.data;
}
