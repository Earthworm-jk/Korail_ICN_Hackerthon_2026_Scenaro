/**
 * saved_itineraries 행 ↔ 앱 레코드 변환·중복 판별 해시 (#25 §6, supabase/README.md)
 *
 * 순수 모듈 — 액션과 테스트가 같은 코드 경로를 쓴다.
 * - constraints_hash: 키 순서에 흔들리지 않는 정규화 직렬화의 SHA-256 (중복 "판별"용,
 *   UNIQUE 아님 — 새로 저장 허용은 #25 §6 확정)
 * - itinerary jsonb에는 표시 스냅샷(days)과 재열람 복원 컨텍스트(context·warnings)를 담는다.
 *   전체 재계산 재현은 constraints가 단일 근거다 (PR #35 리뷰 3).
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import type { PlanRequest } from "./actions/itinerary";
import { SAVED_SCHEMA_VERSION, type SavedItineraryStub } from "./saved-itineraries-stub";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b, "en"))
        .map(([key, inner]) => [key, canonicalize(inner)]),
    );
  }
  return value;
}

export function constraintsHash(constraints: PlanRequest): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(constraints))).digest("hex");
}

/** 저장 요청(클라이언트) — id·savedAt은 DB가 만든다 */
export type SavedEntryInput = Omit<SavedItineraryStub, "id" | "savedAt">;

// 재열람 안전을 위한 행 검증 — 구조가 깨진 행은 목록에서 제외하고 개수만 보고한다.
// days·context·warnings의 세부 구조는 앱 스키마 버전 계약(schema_version)이 책임진다.
const SavedRow = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  constraints: z.looseObject({}),
  itinerary: z.looseObject({
    days: z.array(z.looseObject({})),
    context: z.looseObject({ actors: z.array(z.looseObject({})), works: z.array(z.looseObject({})) }),
    warnings: z.array(z.looseObject({})).optional(),
  }),
  schema_version: z.number().int(),
  snapshot_version: z.string().min(1),
  created_at: z.string().min(1),
});

export type SavedRowT = z.infer<typeof SavedRow>;

export function rowToRecord(row: unknown): SavedItineraryStub | null {
  const parsed = SavedRow.safeParse(row);
  if (!parsed.success) return null;
  const data = parsed.data;
  return {
    id: data.id,
    title: data.title,
    savedAt: data.created_at,
    days: data.itinerary.days as SavedItineraryStub["days"],
    constraints: data.constraints as unknown as PlanRequest,
    schemaVersion: data.schema_version,
    snapshotVersion: data.snapshot_version,
    context: data.itinerary.context as SavedItineraryStub["context"],
    warnings: (data.itinerary.warnings ?? []) as SavedItineraryStub["warnings"],
  };
}

export function entryToRow(entry: SavedEntryInput, userId: string) {
  return {
    user_id: userId,
    title: entry.title,
    constraints: entry.constraints,
    constraints_hash: constraintsHash(entry.constraints),
    itinerary: {
      days: entry.days,
      context: entry.context,
      warnings: entry.warnings ?? [], // #43 경고 누락 0건 — 저장에도 보존
    },
    // 기본값 의존 금지 — 앱 계약 버전을 항상 명시 기록 (supabase/README.md)
    schema_version: SAVED_SCHEMA_VERSION,
    snapshot_version: entry.snapshotVersion,
  };
}
