/**
 * Repository 계층 — P0는 JSON 구현, 확장 시 PostgreSQL/API 구현으로 교체
 * (docs/ENGINE_SPEC.md §1).
 *
 * 로드 검증(#20, REQ-DATA-004): 잘못된 시드는 앱 실행 중이 아니라 Repository 초기화
 * 단계에서 실패해야 한다. 첫 오류에서 멈추지 않고 다음을 전건 수집해 한 번에 실패시킨다.
 *
 *   1. 파일 단위 JSON 파싱 오류
 *   2. 파일별 Zod 구조·의미 검증 이슈 전부 (safeParse)
 *   3. 구조를 통과한 데이터에 한해 중복 키·참조 무결성 검사
 *      — 구조가 깨진 파일에서 파생되는 참조 오류는 연쇄 노이즈이므로 건너뛴다
 *
 * 오류 표기: [파일][엔티티 종류:ID 또는 #배열인덱스][필드 경로] 메시지
 */
import "server-only";

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  Actor, Work, Place, Station, TrainLeg, Flight, WorkPlaceRelation,
  type ActorT, type WorkT, type PlaceT, type StationT, type TrainLegT, type FlightT,
  type WorkPlaceRelationT,
} from "../types/schema";

export type Repositories = {
  actors: ActorT[];
  works: WorkT[];
  places: PlaceT[];
  stations: StationT[];
  trainLegs: TrainLegT[];
  flights: FlightT[];
  workPlaceRelations: WorkPlaceRelationT[]; // #51 — 회차·장면·출처 관계 (장소 비복제)
};

/** 시드 6종의 파싱 전 원본. 테스트에서는 파일 없이 이 형태로 직접 검증한다. */
export type RawSeedFiles = Record<keyof Repositories, unknown>;

export class SeedValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(
      `시드 검증 실패 — ${issues.length}건:\n${issues.map((m) => `  - ${m}`).join("\n")}`,
    );
    this.name = "SeedValidationError";
  }
}

type SeedKey = keyof Repositories;

type Spec = {
  file: string;
  kind: string;
  schema: z.ZodType<unknown>;
  /** 오류 표기용 식별자 — 없으면 배열 인덱스 사용 */
  idOf: (item: Record<string, unknown>) => string | undefined;
  /** 중복 판정 키 — 열차·항공은 번호가 날짜별로 반복되므로 복합 키 (#20) */
  dupKeyOf: (item: Record<string, unknown>) => string;
};

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.length > 0 ? v : undefined;

// PR #29 리뷰: 오프셋 강제로 Z·+09:00 표기가 모두 유효하므로, 같은 시각의 다른 표기가
// 중복 판정을 빠져나가지 않도록 일시를 UTC로 정규화해 비교한다
const utc = (v: unknown): string => new Date(Date.parse(String(v))).toISOString();

const SPECS: Record<SeedKey, Spec> = {
  actors: {
    file: "actors.json", kind: "Actor", schema: Actor,
    idOf: (a) => str(a.id), dupKeyOf: (a) => String(a.id),
  },
  works: {
    file: "works.json", kind: "Work", schema: Work,
    idOf: (w) => str(w.id), dupKeyOf: (w) => String(w.id),
  },
  places: {
    file: "places.json", kind: "Place", schema: Place,
    idOf: (p) => str(p.id), dupKeyOf: (p) => String(p.id),
  },
  stations: {
    file: "stations.json", kind: "Station", schema: Station,
    idOf: (s) => str(s.id), dupKeyOf: (s) => String(s.id),
  },
  trainLegs: {
    file: "train-snapshot.json", kind: "TrainLeg", schema: TrainLeg,
    idOf: (t) => str(t.trainNo),
    dupKeyOf: (t) => `${t.trainNo}|${t.fromStationId}|${t.toStationId}|${utc(t.departAt)}`,
  },
  flights: {
    file: "flights-snapshot.json", kind: "Flight", schema: Flight,
    idOf: (f) => str(f.flightNo),
    dupKeyOf: (f) => `${f.flightNo}|${f.direction}|${utc(f.scheduledAt)}`,
  },
  workPlaceRelations: {
    file: "work-place-relations.json", kind: "WorkPlaceRelation", schema: WorkPlaceRelation,
    idOf: (r) => (str(r.workId) && str(r.placeId) ? `${r.workId}→${r.placeId}` : undefined),
    dupKeyOf: (r) => `${r.workId}|${r.placeId}`, // 같은 장소·다른 작품은 정상 — 관계 단위 유일 (#51)
  },
};

const SEED_KEYS = Object.keys(SPECS) as SeedKey[];

function labelFor(key: SeedKey, item: unknown, index: number): string {
  const spec = SPECS[key];
  const id = item && typeof item === "object"
    ? spec.idOf(item as Record<string, unknown>)
    : undefined;
  return `${spec.kind}:${id ?? `#${index}`}`;
}

function formatIssue(key: SeedKey, item: unknown, index: number, path: string, message: string): string {
  return `[${SPECS[key].file}][${labelFor(key, item, index)}][${path || "-"}] ${message}`;
}

function validate(
  raw: Partial<RawSeedFiles>,
  initialIssues: string[],
  unreadable: Set<SeedKey>,
): Repositories {
  const issues = [...initialIssues];
  const parsed: Partial<Repositories> = {};
  const failed = new Set<SeedKey>(unreadable);

  // 1단계 — 파일별 구조·의미 검증 (이슈 전부 수집)
  for (const key of SEED_KEYS) {
    if (unreadable.has(key)) continue;
    const value = raw[key];
    const result = z.array(SPECS[key].schema).safeParse(value);
    if (result.success) {
      parsed[key] = result.data as never;
      continue;
    }
    failed.add(key);
    for (const issue of result.error.issues) {
      const [index, ...rest] = issue.path;
      const isItem = typeof index === "number" && Array.isArray(value);
      const item = isItem ? (value as unknown[])[index] : undefined;
      issues.push(
        isItem
          ? formatIssue(key, item, index, rest.join("."), issue.message)
          : `[${SPECS[key].file}][(파일)][${issue.path.join(".") || "-"}] ${issue.message}`,
      );
    }
  }

  // 2단계 — 중복 키 (구조 통과 파일만)
  for (const key of SEED_KEYS) {
    if (failed.has(key)) continue;
    const seen = new Map<string, number>();
    (parsed[key] as unknown[]).forEach((item, index) => {
      const dupKey = SPECS[key].dupKeyOf(item as Record<string, unknown>);
      const firstIndex = seen.get(dupKey);
      if (firstIndex !== undefined) {
        issues.push(formatIssue(key, item, index, "-", `중복 키: ${dupKey} (#${firstIndex}와 중복)`));
      } else {
        seen.set(dupKey, index);
      }
    });
  }

  // 3단계 — 참조 무결성 (참조하는 쪽·되는 쪽 모두 구조 통과 시에만)
  const idsOf = (key: SeedKey): Set<string> =>
    new Set((parsed[key] as { id: string }[]).map(({ id }) => id));

  if (!failed.has("works")) {
    const workIds = idsOf("works");
    if (!failed.has("actors")) {
      parsed.actors!.forEach((actor, index) => {
        for (const workId of actor.workIds) {
          if (!workIds.has(workId)) {
            issues.push(formatIssue("actors", actor, index, "workIds", `존재하지 않는 작품 참조: ${workId}`));
          }
        }
      });
    }
    if (!failed.has("places")) {
      parsed.places!.forEach((place, index) => {
        for (const workId of place.workIds) {
          if (!workIds.has(workId)) {
            issues.push(formatIssue("places", place, index, "workIds", `존재하지 않는 작품 참조: ${workId}`));
          }
        }
      });
    }
  }
  // #51 — 관계 파일은 작품·장소 양쪽 구조 통과 시에만 참조 검사 (연쇄 노이즈 스킵 규칙 동일)
  if (!failed.has("workPlaceRelations")) {
    const workIds = failed.has("works") ? null : idsOf("works");
    const actorIds = failed.has("actors") ? null : idsOf("actors");
    const placeById = failed.has("places")
      ? null
      : new Map(parsed.places!.map((place) => [place.id, place]));
    parsed.workPlaceRelations!.forEach((relation, index) => {
      // #51 장면 배우 — 검증된 배우만 참조해야 한다 (featuredActorIds → actors)
      if (actorIds && relation.featuredActorIds) {
        for (const actorId of relation.featuredActorIds) {
          if (!actorIds.has(actorId)) {
            issues.push(formatIssue(
              "workPlaceRelations", relation, index, "featuredActorIds",
              `존재하지 않는 배우 참조: ${actorId}`,
            ));
          }
        }
      }
      const workExists = workIds?.has(relation.workId) ?? false;
      if (workIds && !workExists) {
        issues.push(formatIssue("workPlaceRelations", relation, index, "workId", `존재하지 않는 작품 참조: ${relation.workId}`));
      }
      const place = placeById?.get(relation.placeId);
      if (placeById && !place) {
        issues.push(formatIssue("workPlaceRelations", relation, index, "placeId", `존재하지 않는 장소 참조: ${relation.placeId}`));
      }
      // PR #52 리뷰: 엔진 후보 분류는 Place.workIds를, 회차 표시는 관계를 읽는다 —
      // 두 화면의 사실이 갈라지지 않도록 관계의 workId가 장소의 workIds에 포함돼야 한다
      if (workExists && place && !place.workIds.includes(relation.workId)) {
        issues.push(formatIssue(
          "workPlaceRelations", relation, index, "workId",
          `장소 ${relation.placeId}의 workIds에 없는 작품: ${relation.workId} (Place.workIds와 정합 필요)`,
        ));
      }
    });
  }
  if (!failed.has("stations")) {
    const stationIds = idsOf("stations");
    if (!failed.has("places")) {
      parsed.places!.forEach((place, index) => {
        if (!stationIds.has(place.nearestStationId)) {
          issues.push(formatIssue(
            "places", place, index, "nearestStationId",
            `존재하지 않는 역 참조: ${place.nearestStationId}`,
          ));
        }
      });
    }
    if (!failed.has("trainLegs")) {
      parsed.trainLegs!.forEach((leg, index) => {
        for (const field of ["fromStationId", "toStationId"] as const) {
          if (!stationIds.has(leg[field])) {
            issues.push(formatIssue("trainLegs", leg, index, field, `존재하지 않는 역 참조: ${leg[field]}`));
          }
        }
      });
    }
  }

  if (issues.length > 0) throw new SeedValidationError(issues);
  return parsed as Repositories;
}

/** 파일 없이 원본 객체를 직접 검증한다 — 테스트·파이프라인 재사용용 순수 함수. */
export function parseRepositories(raw: RawSeedFiles): Repositories {
  return validate(raw, [], new Set());
}

export function loadRepositories(dataDir: string = join(process.cwd(), "data")): Repositories {
  const issues: string[] = [];
  const raw: Partial<RawSeedFiles> = {};
  const unreadable = new Set<SeedKey>();

  for (const key of SEED_KEYS) {
    const file = SPECS[key].file;
    try {
      raw[key] = JSON.parse(readFileSync(join(dataDir, file), "utf-8"));
    } catch (error) {
      unreadable.add(key);
      issues.push(`[${file}][(파일)][-] 읽기·JSON 파싱 실패: ${(error as Error).message}`);
    }
  }
  return validate(raw, issues, unreadable);
}
