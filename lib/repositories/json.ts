/**
 * Repository 계층 — P0는 JSON 구현, 확장 시 PostgreSQL/API 구현으로 교체
 * (docs/ENGINE_SPEC.md §1). 로드 시 Zod 검증: 스키마 불일치는 기동 단계에서 실패한다
 * (REQ-DATA-004).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  Actor, Work, Place, Station, TrainLeg, Flight,
  type ActorT, type WorkT, type PlaceT, type StationT, type TrainLegT, type FlightT,
} from "../types/schema";

export type Repositories = {
  actors: ActorT[];
  works: WorkT[];
  places: PlaceT[];
  stations: StationT[];
  trainLegs: TrainLegT[];
  flights: FlightT[];
};

const DATA_DIR = join(process.cwd(), "data");

function load<T>(file: string, schema: z.ZodType<T>): T[] {
  const raw = JSON.parse(readFileSync(join(DATA_DIR, file), "utf-8"));
  return z.array(schema).parse(raw);
}

export function loadRepositories(): Repositories {
  return {
    actors: load("actors.json", Actor),
    works: load("works.json", Work),
    places: load("places.json", Place),
    stations: load("stations.json", Station),
    trainLegs: load("train-snapshot.json", TrainLeg),
    flights: load("flights-snapshot.json", Flight),
  };
}
