/**
 * 실행 지원 — 역 편의시설 스냅샷 로더 (#24 A5)
 *
 * `data/station-facilities.json`은 scripts/build_station_facilities.py가 오프라인으로
 * 생성한다(API_SPEC 2.2 — 런타임 실호출 없음). 원천에 없는 역(춘천·인천공항1터미널)은
 * 수록하지 않으며, 화면은 수록된 역만 안내한다 — 추정값 대체 금지 (A3).
 */
import "server-only";

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { IsoDate, NonEmptyId } from "./types/schema";

export const StationFacility = z.object({
  stationId: NonEmptyId,
  stationCode: z.string().min(1),
  sourceName: z.string().min(1),
  elevatorCount: z.number().int().min(0),
  escalatorCount: z.number().int().min(0),
  hasToilet: z.boolean(),
  hasNursingRoom: z.boolean(),
  hasInfoCenter: z.boolean(),
});

export const StationFacilitiesSnapshot = z.object({
  source: z.string().min(1),
  fetchedAt: IsoDate,
  totalStationsInSource: z.number().int().positive(),
  stations: z.array(StationFacility),
});

export type StationFacilityT = z.infer<typeof StationFacility>;
export type StationFacilitiesSnapshotT = z.infer<typeof StationFacilitiesSnapshot>;

export function loadStationFacilities(
  dataDir: string = join(process.cwd(), "data"),
): StationFacilitiesSnapshotT {
  const raw = JSON.parse(readFileSync(join(dataDir, "station-facilities.json"), "utf-8"));
  return StationFacilitiesSnapshot.parse(raw);
}
