/**
 * 브라우저 로컬 저장 어댑터 (#118 §1 로컬 사용자와 저장, P0-3)
 *
 * 대표 데모는 로그인 없이 시작해서 저장하고 다시 열어야 한다. 지금까지 저장은 Supabase
 * 계정 경로뿐이었고, 그 밖은 새로고침하면 사라지는 in-memory 스텁이었다. 이 파일이 그
 * 자리를 대신한다 — 같은 레코드 모양(`SavedItineraryStub`)을 쓰되 브라우저에 남는다.
 *
 * `lib/saved-itineraries-codec.ts`를 재사용하지 않는 이유는 #118이 정한 대로다. 그쪽은
 * `node:crypto`와 `userId`에 묶여 있어 브라우저에서 그대로 돌지 않는다.
 *
 * ## 저장소를 인자로 받는 이유
 *
 * 테스트가 node 환경이라 `localStorage`가 없다. 전역을 흉내 내는 대신 `Storage`를 인자로
 * 받아 기본값만 브라우저 것으로 둔다 — 테스트와 실제가 같은 코드 경로를 쓴다.
 *
 * ## 실패를 던지지 않는다
 *
 * 사파리 프라이빗 모드는 쓰기에서 던지고, 용량이 차도 던진다. 저장 실패로 앱이 죽으면
 * 안 되므로 모든 진입점이 실패를 값으로 돌려주거나 조용히 무시한다. 읽기 실패는 "없음"과
 * 같게 다룬다 — 손상된 데이터로 화면을 그리는 것보다 빈 목록이 낫다.
 */
import { SAVED_SCHEMA_VERSION, type SavedItineraryStub } from "./saved-itineraries-stub";

/**
 * 저장 형식 버전.
 *
 * `SAVED_SCHEMA_VERSION`(레코드 안의 constraints 직렬화 계약)과 다른 축이다. 이 값은
 * **봉투**의 버전이다 — 키 이름·배열 구조가 바뀌면 올린다. 읽을 때 값이 다르면 마이그레이션
 * 하지 않고 버린다. 데모 저장분은 복구 가치보다 잘못된 복원의 위험이 크다.
 */
export const LOCAL_STORAGE_VERSION = 1;

export const SAVED_KEY = `scenaro.itineraries.v${LOCAL_STORAGE_VERSION}`;
export const DRAFT_KEY = `scenaro.draft.v${LOCAL_STORAGE_VERSION}`;

/** 조율 중 초안 — 아직 저장하지 않은 화면 상태. 레인 A가 호출 지점을 연결한다 (#118) */
export type LocalDraft = {
  savedAt: string;
  /** 1단계 여행 조건 입력값 (datetime-local 문자열) */
  trip: Record<string, string>;
  selectedActorIds: string[];
  selectedWorkIds: string[];
  selectedPlaceIds: string[];
};

type Envelope<T> = { version: number; data: T };

/** 브라우저에서만 존재한다. 서버 렌더·테스트에서는 null이며 모든 함수가 무해하게 동작한다 */
function defaultStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null; // 쿠키·저장소 차단 환경
  }
}

function readEnvelope<T>(key: string, storage: Storage | null): T | null {
  if (!storage) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const envelope = parsed as Partial<Envelope<T>>;
    // 버전이 다르면 해석하지 않는다 — 구버전 모양을 새 코드로 읽으면 조용히 어긋난다
    if (envelope.version !== LOCAL_STORAGE_VERSION) return null;
    if (envelope.data === undefined) return null;
    return envelope.data as T;
  } catch {
    return null; // 손상된 JSON — 없는 것과 같게 다룬다
  }
}

function writeEnvelope<T>(key: string, data: T, storage: Storage | null): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify({ version: LOCAL_STORAGE_VERSION, data }));
    return true;
  } catch {
    return false; // 용량 초과·프라이빗 모드
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/** 문자열이면서 Date로 읽을 수 있는가 — 목록의 Intl 포맷과 재열람의 시각 복원이 둘 다 요구한다 */
function isUsableInstant(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(new Date(value).getTime());
}

/**
 * 저장 당시 계산 입력이 재열람에서 실제로 쓸 수 있는 모양인지.
 *
 * `reopenRecord`(planner-wizard)가 네 시각을 `tripInputsFromConstraints`로 되살리고
 * 세 id 배열을 후보 재조회에 그대로 넘긴다. 하나라도 어긋나면 재열람이 깨진다.
 */
function isUsableConstraints(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    isUsableInstant(c.arrivalAt)
    && isUsableInstant(c.departureAt)
    && isUsableInstant(c.airportReadyAt)
    && isUsableInstant(c.airportArrivalDeadline)
    && isStringArray(c.selectedActorIds)
    && isStringArray(c.selectedWorkIds)
    && isStringArray(c.excludedPlaceIds)
  );
}

/** 일정 하루치 — 렌더가 배열 세 개를 그대로 순회한다 */
function isUsableDay(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const day = value as Record<string, unknown>;
  return (
    typeof day.date === "string"
    && Array.isArray(day.items)
    && Array.isArray(day.rides)
    && Array.isArray(day.regionWindows)
  );
}

/**
 * 레코드 한 건이 화면에 쓸 만한 모양인지.
 *
 * PR #123 리뷰 — 겉모양만 보면 안 된다. `id/title/days/constraints`가 있어도
 * `savedAt`이 날짜가 아니면 목록의 `Intl.DateTimeFormat(...).format(new Date(savedAt))`이
 * `RangeError`를 던지고, `context`가 없거나 constraints가 비면 재열람이 깨진다.
 * 그래서 **실제 소비 지점이 요구하는 것**을 기준으로 본다.
 *
 * 전체 Zod 스키마를 다시 돌리지 않는 이유는 그 스키마가 서버 시드용이고, 여기서 막으려는
 * 것은 손으로 고친 값·다른 앱의 같은 키·구버전 잔재이기 때문이다.
 */
function isUsableRecord(value: unknown): value is SavedItineraryStub {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || record.id.length === 0) return false;
  if (typeof record.title !== "string") return false;
  if (!isUsableInstant(record.savedAt)) return false;
  // constraints 직렬화 계약이 다르면 되살린 시각이 조용히 어긋난다 — 버리는 편이 낫다
  if (record.schemaVersion !== SAVED_SCHEMA_VERSION) return false;
  if (typeof record.snapshotVersion !== "string") return false;
  if (!isUsableConstraints(record.constraints)) return false;
  if (!Array.isArray(record.days) || !record.days.every(isUsableDay)) return false;
  const context = record.context as Record<string, unknown> | undefined;
  if (typeof context !== "object" || context === null) return false;
  if (!Array.isArray(context.actors) || !Array.isArray(context.works)) return false;
  // warnings는 optional(#43, PR #44 리뷰 2) — 있으면 배열이어야 한다
  if (record.warnings !== undefined && !Array.isArray(record.warnings)) return false;
  return true;
}

/** 저장 목록 — 최신순. 손상분은 조용히 걸러낸다 */
export function listLocalItineraries(storage: Storage | null = defaultStorage()): SavedItineraryStub[] {
  const data = readEnvelope<unknown>(SAVED_KEY, storage);
  if (!Array.isArray(data)) return [];
  return data.filter(isUsableRecord);
}

/** 브라우저 randomUUID가 없으면(구형·비보안 컨텍스트) 시각 기반으로 떨어진다 */
function newId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // 아래 폴백
  }
  return `local-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

export type LocalSaveResult =
  | { ok: true; record: SavedItineraryStub; records: SavedItineraryStub[] }
  | { ok: false };

/**
 * 저장 — 목록 맨 앞에 넣는다.
 *
 * 쓰기가 실패하면 `ok: false`만 돌려주고 목록을 바꾸지 않는다. 화면에는 저장된 것처럼
 * 보이는데 다시 열면 없는 상태를 만들지 않기 위해서다.
 */
export function saveLocalItinerary(
  entry: Omit<SavedItineraryStub, "id" | "savedAt">,
  storage: Storage | null = defaultStorage(),
  now: Date = new Date(),
): LocalSaveResult {
  const record: SavedItineraryStub = { ...entry, id: newId(), savedAt: now.toISOString() };
  const records = [record, ...listLocalItineraries(storage)];
  if (!writeEnvelope(SAVED_KEY, records, storage)) return { ok: false };
  return { ok: true, record, records };
}

/** 조율 중 초안 저장 — 호출 빈도 조절(디바운스)은 호출부 책임이다 */
export function saveDraft(draft: LocalDraft, storage: Storage | null = defaultStorage()): boolean {
  return writeEnvelope(DRAFT_KEY, draft, storage);
}

/** 초안 복구 — 없거나 손상됐으면 null. 호출부는 그냥 빈 화면에서 시작하면 된다 */
export function loadDraft(storage: Storage | null = defaultStorage()): LocalDraft | null {
  const data = readEnvelope<unknown>(DRAFT_KEY, storage);
  if (typeof data !== "object" || data === null) return null;
  const draft = data as Partial<LocalDraft>;
  if (typeof draft.savedAt !== "string") return null;
  if (typeof draft.trip !== "object" || draft.trip === null) return null;
  const ids = [draft.selectedActorIds, draft.selectedWorkIds, draft.selectedPlaceIds];
  if (!ids.every((list) => Array.isArray(list) && list.every((id) => typeof id === "string"))) return null;
  return draft as LocalDraft;
}

export function clearDraft(storage: Storage | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(DRAFT_KEY);
  } catch {
    // 지우지 못해도 진행한다 — 다음 저장이 덮어쓴다
  }
}
