"use server";
/**
 * 저장 일정 액션 (#25 §6 — saved_itineraries + RLS) — API_SPEC 3.2
 *
 * - 저장·조회 모두 서버에서 사용자를 재검증한다(getUser, #36 리뷰 후속 조건).
 *   RLS(auth.uid() = user_id)가 DB 계층에서 한 번 더 소유자를 강제한다.
 * - schema_version은 DB 기본값에 의존하지 않고 앱 계약 버전을 명시 기록한다.
 * - env 미설정은 NOT_CONFIGURED — UI 스텁 폴백 경로 (#35).
 */
import {
  entryToRow,
  rowToRecord,
  type SavedEntryInput,
} from "../saved-itineraries-codec";
import type { SavedItineraryStub } from "../saved-itineraries-stub";
import { createSupabaseServerClient } from "../supabase/server";

export type SaveFailureReason = "NOT_CONFIGURED" | "UNAUTHENTICATED" | "STORAGE_FAILED";

export type SaveItineraryResult =
  | { ok: true; record: SavedItineraryStub }
  | { ok: false; reason: SaveFailureReason };

export type ListItinerariesResult =
  | { ok: true; records: SavedItineraryStub[]; invalidCount: number }
  | { ok: false; reason: SaveFailureReason };

export async function saveItinerary(entry: SavedEntryInput): Promise<SaveItineraryResult> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false, reason: "NOT_CONFIGURED" };
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { ok: false, reason: "UNAUTHENTICATED" };

  const { data, error } = await supabase
    .from("saved_itineraries")
    .insert(entryToRow(entry, userData.user.id))
    .select()
    .single();
  if (error || !data) {
    if (error) console.error("saveItinerary 실패:", error.code ?? error.message);
    return { ok: false, reason: "STORAGE_FAILED" };
  }
  const record = rowToRecord(data);
  if (!record) {
    console.error("saveItinerary: 저장 직후 행이 계약과 다릅니다", data.id);
    return { ok: false, reason: "STORAGE_FAILED" };
  }
  return { ok: true, record };
}

export async function listSavedItineraries(): Promise<ListItinerariesResult> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false, reason: "NOT_CONFIGURED" };
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { ok: false, reason: "UNAUTHENTICATED" };

  const { data, error } = await supabase
    .from("saved_itineraries")
    .select()
    .order("updated_at", { ascending: false });
  if (error || !data) {
    if (error) console.error("listSavedItineraries 실패:", error.code ?? error.message);
    return { ok: false, reason: "STORAGE_FAILED" };
  }
  const records: SavedItineraryStub[] = [];
  let invalidCount = 0;
  for (const row of data) {
    const record = rowToRecord(row);
    if (record) records.push(record);
    else invalidCount += 1; // 깨진 행은 재열람 사고 대신 목록 제외 — 개수만 보고
  }
  return { ok: true, records, invalidCount };
}
