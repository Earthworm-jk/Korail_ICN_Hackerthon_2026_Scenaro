/**
 * 실제 철로 선형 스냅샷 로더 (#14 v0.6 지도 4단계 동선)
 *
 * `data/rail-geometry.json`은 scripts/build_rail_geometry.py가 오프라인으로 생성한다
 * (API_SPEC 2.2 — 런타임 실호출 없음). 원천은 OpenStreetMap의 실제 철도 노선이다.
 *
 * 팀 결정: #14 §6이 막은 것은 우리가 서비스하지 않는 버스·택시·도보 경로를 계산한 것처럼
 * 보이게 하는 표현이고, 철도는 실제 선형으로 그린다. 그래서 이 스냅샷의 좌표는 지어낸
 * 보간점이 아니라 OSM way 지오메트리 그대로다 — 선형을 추정으로 채우지 않는다 (A3와 같은 규율).
 *
 * `points`는 **이미 투영된 지도 좌표**다. 파이프라인이 lib/korea-map-projection.ts와 같은
 * 상수로 미리 투영해 굽는다 — 런타임 투영이 없어야 선로와 역 점이 따로 놀지 않는다.
 *
 * `stations[].index`는 앵커다: 폴리라인에서 그 역이 놓인 점의 인덱스. 「서울→만종」 구간은
 * points를 두 앵커 사이로 잘라 쓴다 (lib/map-route.ts railRouteSegments).
 *
 * ODbL 1.0 의무: 이 데이터를 화면에 그리면 출처 표기를 함께 띄운다 (app/korea-map.tsx).
 */
import "server-only";

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { IsoDate, NonEmptyId } from "./types/schema";

/** 투영이 끝난 지도 좌표 한 점 — [x, y] */
export const RailPoint = z.tuple([z.number(), z.number()]);

export const RailStationAnchor = z.object({
  stationId: NonEmptyId,
  index: z.number().int().nonnegative(),
});

export const RailLine = z
  .object({
    id: NonEmptyId,
    name: z.object({ ko: z.string().min(1), en: z.string().min(1) }),
    mode: z.enum(["relation", "graph"]),
    // graph 축은 OSM route 관계가 불완전해 선로 그래프에서 만든다 — 관계 ID가 없다(null)
    relationId: z.number().int().positive().nullable(),
    // 축 하나가 이어 주는 역이 하나뿐이면 자를 구간이 없다 — 그런 축은 실을 이유가 없다
    stations: z.array(RailStationAnchor).min(2),
    points: z.array(RailPoint).min(2),
  })
  .superRefine((line, ctx) => {
    const seen = new Set<string>();
    let previous = -1;
    line.stations.forEach((anchor, position) => {
      if (seen.has(anchor.stationId)) {
        ctx.addIssue({
          code: "custom",
          path: ["stations", position, "stationId"],
          message: `한 축에 같은 역이 두 번 실렸습니다: ${anchor.stationId}`,
        });
      }
      seen.add(anchor.stationId);
      // 앵커가 폴리라인 순서대로 늘어서야 구간 자르기(slice)가 방향을 판단할 수 있다
      if (anchor.index <= previous) {
        ctx.addIssue({
          code: "custom",
          path: ["stations", position, "index"],
          message: "앵커 인덱스는 폴리라인 진행 순서대로 증가해야 합니다",
        });
      }
      previous = anchor.index;
      if (anchor.index >= line.points.length) {
        ctx.addIssue({
          code: "custom",
          path: ["stations", position, "index"],
          message: `앵커 인덱스가 폴리라인 밖입니다 (points ${line.points.length}개)`,
        });
      }
    });
  });

export const RailGeometrySnapshot = z.object({
  source: z.string().min(1),
  /** ODbL 표기에 붙이는 라이선스 링크 */
  sourceUrl: z.url(),
  fetchedAt: IsoDate,
  projection: z.string().min(1),
  simplifyTolerance: z.number().positive(),
  lines: z.array(RailLine).min(1),
});

export type RailStationAnchorT = z.infer<typeof RailStationAnchor>;
export type RailLineT = z.infer<typeof RailLine>;
export type RailGeometrySnapshotT = z.infer<typeof RailGeometrySnapshot>;

export function loadRailGeometry(
  dataDir: string = join(process.cwd(), "data"),
): RailGeometrySnapshotT {
  const raw = JSON.parse(readFileSync(join(dataDir, "rail-geometry.json"), "utf-8"));
  return RailGeometrySnapshot.parse(raw);
}
