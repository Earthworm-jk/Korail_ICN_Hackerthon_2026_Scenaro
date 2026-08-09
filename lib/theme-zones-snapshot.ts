/**
 * #80 테마체험 권역 로더 (서버 전용)
 *
 * data/theme-zone-rankings.json은 scripts/build_theme_zone_rankings.py가 오프라인으로
 * 생성한다 — 런타임 OpenAI 호출은 없다 (#48 계약 유지).
 *
 * 파일 미탑재는 오류가 아니라 계약된 상태다: 권역 카탈로그나 랭킹 스냅샷이 없으면
 * 카드 대신 "추천 불가"를 표시한다 (#14 v0.6). 파일이 있는데 계약 위반이면 #20 원칙대로
 * 로드에 실패한다 — 잘못된 근거가 화면에 나가는 것보다 실패가 낫다.
 */
import "server-only";

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  ThemeZone,
  createThemeZoneRankingSnapshotSchema,
  type ThemeZoneRankingSnapshot,
  type ThemeZoneT,
} from "./theme-zones";
import { loadRepositories } from "./repositories/json";

const ZONES_FILE = join(process.cwd(), "data", "theme-zones.json");
const RANKINGS_FILE = join(process.cwd(), "data", "theme-zone-rankings.json");

function fail(file: string, error: z.ZodError): never {
  const issues = error.issues
    .map((issue) => `  - [${issue.path.join(".") || "-"}] ${issue.message}`)
    .join("\n");
  throw new Error(`${file} 검증 실패 — ${error.issues.length}건:\n${issues}`);
}

export function loadThemeZones(filePath: string = ZONES_FILE): ThemeZoneT[] | null {
  if (!existsSync(filePath)) return null;
  const raw = JSON.parse(readFileSync(filePath, "utf-8"));
  const result = z.array(ThemeZone).safeParse(raw);
  if (!result.success) fail("theme-zones.json", result.error);

  // 권역 참조 무결성 — regionId는 Station.regionId와 같은 값 공간이다 (#6 권역 필드 계약)
  const regionIds = new Set<string>(loadRepositories().stations.map((station) => station.regionId));
  const unknown = result.data.filter((zone) => !regionIds.has(zone.regionId));
  if (unknown.length > 0) {
    throw new Error(
      `theme-zones.json 검증 실패 — 존재하지 않는 권역 참조: ${unknown
        .map((zone) => `${zone.id}(${zone.regionId})`)
        .join(", ")}`,
    );
  }
  const ids = new Set<string>();
  for (const zone of result.data) {
    if (ids.has(zone.id)) throw new Error(`theme-zones.json 검증 실패 — 중복 권역 ID: ${zone.id}`);
    ids.add(zone.id);
  }
  return result.data;
}

export function loadThemeZoneRankings(
  zones: ThemeZoneT[],
  filePath: string = RANKINGS_FILE,
): ThemeZoneRankingSnapshot | null {
  if (!existsSync(filePath)) return null;
  const raw = JSON.parse(readFileSync(filePath, "utf-8"));
  const schema = createThemeZoneRankingSnapshotSchema(
    new Set(loadRepositories().works.map((work) => work.id)),
    new Set(zones.map((zone) => zone.id)),
  );
  const result = schema.safeParse(raw);
  if (!result.success) fail("theme-zone-rankings.json", result.error);
  return result.data;
}
