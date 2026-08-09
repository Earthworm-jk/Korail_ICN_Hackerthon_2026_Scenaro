/**
 * 역·공항 좌표 스냅샷 로더 (#14 v0.6 지도)
 *
 * `data/station-coordinates.json`은 scripts/build_station_coordinates.py가 오프라인으로
 * 생성한다(API_SPEC 2.2 — 런타임 실호출 없음). 4단계 "전체 이동 동선" 지도가 역·공항 점을
 * 실좌표에 찍는 데 쓴다.
 *
 * 출처가 두 갈래다 — 행마다 `source`로 구분한다:
 *   primary  — 국가철도공단_철도역 정보 (공공데이터포털 15067652)
 *   fallback — 원천에 없거나 좌표가 0,0 결측인 역. 시안이 지도 출처로 명시한
 *              OpenStreetMap 역 노드를 쓰고, 행에 출처 URL과 확인일을 남긴다.
 *
 * 좌표 범위를 대한민국 육지로 제한한다. 원천 215행 중 12행이 0,0으로 내려오므로(2026-08-09
 * 확인) 스키마 단계에서 막지 않으면 결측이 조용히 지도에 실린다 — 추정값 대체 금지 (A3).
 */
import "server-only";

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { IsoDate, NonEmptyId } from "./types/schema";

/** 대한민국 육지 범위 — build_station_coordinates.py의 KOREA_BOUNDS와 같은 값 */
const Latitude = z.number().min(33).max(39);
const Longitude = z.number().min(124).max(132);

export const StationCoordinate = z
  .object({
    stationId: NonEmptyId,
    sourceName: z.string().min(1),
    latitude: Latitude,
    longitude: Longitude,
    source: z.enum(["primary", "fallback"]),
    address: z.string().min(1).optional(),
    sourceNote: z.string().min(1).optional(),
    sourceRef: z.url().optional(),
    verifiedAt: IsoDate.optional(),
  })
  .superRefine((station, ctx) => {
    // 보조 출처는 어디서 온 값인지 추적할 수 있어야 리뷰·시연에서 방어된다
    if (station.source !== "fallback") return;
    for (const field of ["sourceNote", "sourceRef", "verifiedAt"] as const) {
      if (station[field] === undefined) {
        ctx.addIssue({
          code: "custom",
          path: [field],
          message: `보조 출처 좌표는 ${field}를 함께 기록해야 합니다 (출처 추적)`,
        });
      }
    }
  });

export const StationCoordinatesSnapshot = z.object({
  source: z.string().min(1),
  fetchedAt: IsoDate,
  totalStationsInSource: z.number().int().positive(),
  stations: z.array(StationCoordinate),
});

export type StationCoordinateT = z.infer<typeof StationCoordinate>;
export type StationCoordinatesSnapshotT = z.infer<typeof StationCoordinatesSnapshot>;

export function loadStationCoordinates(
  dataDir: string = join(process.cwd(), "data"),
): StationCoordinatesSnapshotT {
  const raw = JSON.parse(readFileSync(join(dataDir, "station-coordinates.json"), "utf-8"));
  return StationCoordinatesSnapshot.parse(raw);
}
