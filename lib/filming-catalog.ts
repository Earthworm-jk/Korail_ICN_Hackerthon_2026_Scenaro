/**
 * 검색용 전체 촬영지 카탈로그.
 *
 * 이 파일은 일정 엔진의 검증 시드(data/places.json)를 대체하지 않는다. 전체 카탈로그는
 * 배우·작품 검색과 향후 검증 대기열에 쓰고, 시간표·운영시간까지 갖춘 장소만 별도로
 * 플래너 시드에 승격한다.
 */
import "server-only";

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { deriveStrictSelectionMemberships, selectionGroupsOf } from "./selection-candidates";
import {
  Actor,
  HttpUrl,
  IsoDate,
  LocalizedText,
  NonEmptyId,
  Work,
  WorkPlaceRelation,
} from "./types/schema";

const CatalogPlace = z.object({
  id: NonEmptyId,
  name: LocalizedText,
  translationStatus: z.literal("ko_fallback"),
  placeType: z.enum([
    "cafe",
    "filming_set",
    "golf_club",
    "playground",
    "restaurant",
    "station",
    "stay",
    "store",
  ]),
  address: z.string().min(1),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  nearestStationName: z.string().min(1),
  driveMinutes: z.number().positive().max(60),
  status: z.enum(["confirmed", "conditional"]),
  workIds: z.array(NonEmptyId).min(1),
  verifiedAt: IsoDate,
  sourceUrls: z.array(HttpUrl).min(1),
  visitNote: LocalizedText.optional(),
}).superRefine((place, ctx) => {
  if ((place.status === "conditional") !== (place.visitNote !== undefined)) {
    ctx.addIssue({
      code: "custom",
      path: ["visitNote"],
      message: "conditional 장소만 방문 전 확인 안내를 가져야 합니다",
    });
  }
});

const CatalogRelation = z.intersection(
  WorkPlaceRelation,
  z.object({
    sourceRowId: NonEmptyId,
    sourcePlaceName: z.string().min(1),
  }),
);

const CountMap = z.record(z.string(), z.number().int().nonnegative());

export const FilmingCatalog = z.object({
  metadata: z.object({
    version: z.literal(1),
    verifiedAt: IsoDate,
    relationCount: z.number().int().positive(),
    placeCount: z.number().int().positive(),
    placeStatusCounts: CountMap,
    relationStatusCounts: CountMap,
    workRelationCounts: CountMap,
    sourceUrls: z.array(HttpUrl).min(1),
    plannerSeedSeparated: z.literal(true),
    translationStatus: z.literal("ko_fallback"),
    accessScreeningMethod: z.string().min(1),
  }),
  actors: z.array(Actor),
  works: z.array(Work),
  places: z.array(CatalogPlace),
  relations: z.array(CatalogRelation),
});

export type FilmingCatalogT = z.infer<typeof FilmingCatalog>;
export type FilmingCatalogPlaceT = z.infer<typeof CatalogPlace>;
export type FilmingCatalogRelationT = z.infer<typeof CatalogRelation>;

const DEFAULT_FILE = join(process.cwd(), "data", "filming-catalog.json");

function fail(message: string): never {
  throw new Error(`filming-catalog.json 검증 실패 — ${message}`);
}

function validateIntegrity(catalog: FilmingCatalogT): void {
  const unique = (kind: string, values: readonly string[]) => {
    const seen = new Set<string>();
    for (const value of values) {
      if (seen.has(value)) fail(`중복 ${kind} ID: ${value}`);
      seen.add(value);
    }
  };
  unique("배우", catalog.actors.map(({ id }) => id));
  unique("작품", catalog.works.map(({ id }) => id));
  unique("장소", catalog.places.map(({ id }) => id));

  const actorIds = new Set(catalog.actors.map(({ id }) => id));
  const workIds = new Set(catalog.works.map(({ id }) => id));
  const placeIds = new Set(catalog.places.map(({ id }) => id));
  const relationKeys = new Set<string>();
  const relationWorkIdsByPlace = new Map<string, Set<string>>();

  for (const actor of catalog.actors) {
    for (const workId of actor.workIds) {
      if (!workIds.has(workId)) fail(`${actor.id}가 존재하지 않는 작품 ${workId}를 참조합니다`);
    }
  }
  for (const relation of catalog.relations) {
    if (!workIds.has(relation.workId)) fail(`관계가 존재하지 않는 작품 ${relation.workId}를 참조합니다`);
    if (!placeIds.has(relation.placeId)) fail(`관계가 존재하지 않는 장소 ${relation.placeId}를 참조합니다`);
    for (const actorId of relation.featuredActorIds ?? []) {
      if (!actorIds.has(actorId)) fail(`관계가 존재하지 않는 배우 ${actorId}를 참조합니다`);
    }
    const key = `${relation.workId}|${relation.placeId}`;
    if (relationKeys.has(key)) fail(`중복 작품–장소 관계: ${key}`);
    relationKeys.add(key);
    const linked = relationWorkIdsByPlace.get(relation.placeId) ?? new Set<string>();
    linked.add(relation.workId);
    relationWorkIdsByPlace.set(relation.placeId, linked);
  }
  for (const place of catalog.places) {
    const linked = [...(relationWorkIdsByPlace.get(place.id) ?? [])].sort();
    if (JSON.stringify([...place.workIds].sort()) !== JSON.stringify(linked)) {
      fail(`${place.id}의 workIds가 관계 데이터와 일치하지 않습니다`);
    }
  }

  if (catalog.metadata.placeCount !== catalog.places.length) fail("metadata.placeCount가 실제 개수와 다릅니다");
  if (catalog.metadata.relationCount !== catalog.relations.length) fail("metadata.relationCount가 실제 개수와 다릅니다");

  const countBy = <T>(values: readonly T[], keyOf: (value: T) => string) =>
    Object.fromEntries(
      [...values.reduce((counts, value) => {
        const key = keyOf(value);
        counts.set(key, (counts.get(key) ?? 0) + 1);
        return counts;
      }, new Map<string, number>())].sort(([a], [b]) => a.localeCompare(b, "en")),
    );
  const placeStatusCounts = countBy(catalog.places, ({ status }) => status);
  const statusByPlace = new Map(catalog.places.map(({ id, status }) => [id, status]));
  const relationStatusCounts = countBy(
    catalog.relations,
    ({ placeId }) => statusByPlace.get(placeId) ?? "unknown",
  );
  const workRelationCounts = countBy(catalog.relations, ({ workId }) => workId);
  for (const [label, actual, declared] of [
    ["placeStatusCounts", placeStatusCounts, catalog.metadata.placeStatusCounts],
    ["relationStatusCounts", relationStatusCounts, catalog.metadata.relationStatusCounts],
    ["workRelationCounts", workRelationCounts, catalog.metadata.workRelationCounts],
  ] as const) {
    if (JSON.stringify(actual) !== JSON.stringify(declared)) {
      fail(`metadata.${label}가 실제 집계와 다릅니다`);
    }
  }
}

export function loadFilmingCatalog(filePath: string = DEFAULT_FILE): FilmingCatalogT {
  const raw = JSON.parse(readFileSync(filePath, "utf-8"));
  const result = FilmingCatalog.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `[${issue.path.join(".") || "-"}] ${issue.message}`)
      .join("; ");
    fail(issues);
  }
  validateIntegrity(result.data);
  return result.data;
}

export type FilmingCatalogCandidate = FilmingCatalogPlaceT & {
  selectionGroups: ("actor" | "work")[];
  relations: FilmingCatalogRelationT[];
};

/** #51과 동일한 엄격 후보 합집합 규칙을 전체 카탈로그에도 적용한다. */
export function deriveFilmingCatalogCandidates(
  catalog: FilmingCatalogT,
  selection: { selectedActorIds: string[]; selectedWorkIds: string[] },
): FilmingCatalogCandidate[] {
  const memberships = deriveStrictSelectionMemberships(
    catalog.relations,
    new Set(selection.selectedActorIds),
    new Set(selection.selectedWorkIds),
  );
  return catalog.places
    .flatMap((place) => {
      const membership = memberships.get(place.id);
      if (!membership) return [];
      return [{
        ...place,
        selectionGroups: selectionGroupsOf(membership),
        relations: membership.relations as FilmingCatalogRelationT[],
      }];
    })
    .sort((a, b) => a.name.ko.localeCompare(b.name.ko, "ko"));
}
