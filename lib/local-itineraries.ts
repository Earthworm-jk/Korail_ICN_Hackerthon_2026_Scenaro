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
import type { ActorSummary, WorkSummary } from "./actions/search";

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

/**
 * 조율 중 초안 — 아직 저장하지 않은 화면 상태. 레인 A가 호출 지점을 연결한다 (#118)
 *
 * 저장 레코드(`SavedItineraryStub`)와 달리 계산 결과(`days`)를 담지 않는다. 초안은
 * "무엇을 고르는 중이었나"이고, 되살린 뒤 다시 계산하면 되기 때문이다.
 */
export type LocalDraft = {
  savedAt: string;
  /**
   * 1단계 여행 조건 화면 상태 (datetime-local 문자열).
   *
   * `touched` 두 개를 함께 담는 이유는 위저드가 그 값으로 **파생 여부**를 가르기 때문이다
   * (`planner-wizard.tsx` — false면 항공 시각이 바뀔 때 공항 시각을 다시 계산한다).
   * 시각 네 개만 저장하고 복구하면 그 의미가 사라져, 자동으로 따라오던 값이 굳거나
   * 사용자가 직접 고친 값이 덮인다 (PR #127 리뷰 1).
   */
  trip: {
    arrivalAt: string;
    departureAt: string;
    airportReadyAt: string;
    airportArrivalDeadline: string;
    airportReadyTouched: boolean;
    airportDeadlineTouched: boolean;
  };
  /**
   * 선택한 배우·작품 **요약**. ID만으로는 되살릴 수 없다 (PR #127 리뷰 2).
   *
   * 위저드 상태가 `ActorSummary[]`·`WorkSummary[]`이고 선택 칩이 이름·제목을 바로 읽는데,
   * `getCandidatePlaces` 응답에는 works만 있고 actors 요약이 없다. ID→요약 경로가 없으므로
   * 저장 레코드의 `context`와 같은 방식으로 요약을 그대로 담는다.
   */
  context: { actors: ActorSummary[]; works: WorkSummary[] };
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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** 배열이면서 원소가 전부 조건을 만족하는가 — 빈 배열은 통과한다 */
function isArrayOf(value: unknown, check: (item: unknown) => boolean): boolean {
  return Array.isArray(value) && value.every(check);
}

/** `{ ko, en }` — 화면이 `text[locale]`로 바로 읽는다 */
function isLocalizedText(value: unknown): boolean {
  return isObject(value) && typeof value.ko === "string" && typeof value.en === "string";
}

/** `ActorSummary` — 칩이 `name[locale]`을 읽는다 */
function isActorSummary(value: unknown): boolean {
  return isObject(value) && typeof value.id === "string" && isLocalizedText(value.name);
}

/** `WorkSummary` — 제목 키가 name이 아니라 title이다 */
function isWorkSummary(value: unknown): boolean {
  return isObject(value) && typeof value.id === "string" && isLocalizedText(value.title);
}

/** `ItineraryItem` */
function isItineraryItem(value: unknown): boolean {
  return (
    isObject(value)
    && typeof value.placeId === "string"
    && isUsableInstant(value.arriveAt)
    && isUsableInstant(value.departAt)
    && typeof value.accessMinutes === "number"
  );
}

/** `TrainRide` — 렌더가 key로 `trainNo`+`departAt`을 쓴다 */
function isTrainRide(value: unknown): boolean {
  return (
    isObject(value)
    && typeof value.trainNo === "string"
    && typeof value.fromStationId === "string"
    && typeof value.toStationId === "string"
    && isUsableInstant(value.departAt)
    && isUsableInstant(value.arriveAt)
  );
}

/** `RegionWindow` — 활용 가능 시간 표시가 분을 그대로 포맷한다 */
function isRegionWindow(value: unknown): boolean {
  return (
    isObject(value)
    && typeof value.stationId === "string"
    && typeof value.regionId === "string"
    && isUsableInstant(value.startAt)
    && isUsableInstant(value.endAt)
    && typeof value.availableMinutes === "number"
  );
}

/** `GatewayRide` — 목록이 `fromName[locale]`·`serviceName[locale]`까지 읽는다 */
function isGatewayRide(value: unknown): boolean {
  return (
    isObject(value)
    && typeof value.id === "string"
    && typeof value.fromStationId === "string"
    && typeof value.toStationId === "string"
    && isUsableInstant(value.departAt)
    && isUsableInstant(value.arriveAt)
    && isLocalizedText(value.fromName)
    && isLocalizedText(value.toName)
    && isLocalizedText(value.serviceName)
    && isLocalizedText(value.operator)
  );
}

/**
 * 표시 이름 스냅샷 (#130) — optional이다.
 *
 * **없으면 통과시킨다.** 이 필드가 생기기 전에 저장한 레코드가 이미 브라우저에 있고,
 * 그것들을 목록에서 지워 버리면 사용자는 저장했던 일정을 잃는다. 화면은 스냅샷이 없으면
 * 현지화된 대체 문구로 떨어지므로, 없다고 레코드를 버릴 이유가 없다.
 *
 * 반대로 **있는데 모양이 깨졌으면 그 레코드는 버린다.** 화면이 `names[id][locale]`을
 * 바로 읽기 때문에 `null`이나 한쪽 언어만 있는 값이 들어오면 그 자리에서 죽는다.
 */
function isDisplayNameSnapshot(value: unknown): boolean {
  if (!isObject(value) || Array.isArray(value)) return false;
  const groups = [value.places, value.stations];
  return groups.every((group) => {
    // 배열도 object라 `places: []`가 Record처럼 통과한다 — 명시적으로 막는다 (PR #133 리뷰)
    if (!isObject(group) || Array.isArray(group)) return false;
    return Object.values(group).every(isNonEmptyLocalizedText);
  });
}

/** 이름은 화면에 그대로 찍힌다 — 공백만 있는 값은 ID만큼이나 쓸모가 없다 */
function isNonEmptyLocalizedText(value: unknown): boolean {
  return (
    isObject(value)
    && typeof value.ko === "string"
    && value.ko.trim().length > 0
    && typeof value.en === "string"
    && value.en.trim().length > 0
  );
}

/** `CandidateWarning` — 경고 목록이 `placeId`와 `detail`을 문구 키로 쓴다 */
function isCandidateWarning(value: unknown): boolean {
  return (
    isObject(value)
    && typeof value.code === "string"
    && typeof value.placeId === "string"
    && typeof value.detail === "string"
  );
}

/**
 * 일정 하루치.
 *
 * PR #123 2차 리뷰 — 배열인지만 보면 `items: [null]`이 통과하고, 다시 열었을 때 렌더가
 * `null.placeId`를 읽으며 죽는다. 원소까지 본다.
 */
function isUsableDay(value: unknown): boolean {
  if (!isObject(value)) return false;
  return (
    typeof value.date === "string"
    && isArrayOf(value.items, isItineraryItem)
    && isArrayOf(value.rides, isTrainRide)
    && isArrayOf(value.regionWindows, isRegionWindow)
    // gatewayLegs는 저장 레코드 v2 호환을 위한 additive optional (#58)
    && (value.gatewayLegs === undefined || isArrayOf(value.gatewayLegs, isGatewayRide))
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
/**
 * 레코드 한 건을 화면이 쓸 수 있는 모양으로 정규화한다. 못 쓰면 `null`.
 *
 * PR #123 리뷰 — 겉모양만 보면 안 된다. `id/title/days/constraints`가 있어도
 * `savedAt`이 날짜가 아니면 목록의 `Intl.DateTimeFormat(...).format(new Date(savedAt))`이
 * `RangeError`를 던지고, `context`가 없거나 constraints가 비면 재열람이 깨진다.
 * 그래서 **실제 소비 지점이 요구하는 것**을 기준으로 본다.
 *
 * PR #133 리뷰 — **보조 필드 하나 때문에 일정 전체를 버리지 않는다.** `displayNames`는
 * 없어도 화면이 대체 문구로 돌아가는 optional 메타데이터인데, 그것이 깨졌다고 레코드를
 * 걸러내면 성한 `days`·`constraints`·`context`까지 잃는다. 게다가 걸러진 레코드는 다음
 * 저장 때 목록을 다시 쓰면서 **저장소에서 영구히 사라진다**(`saveLocalItinerary`가
 * `listLocalItineraries` 결과 위에 쓴다). 그래서 그 필드만 떼고 일정은 남긴다.
 *
 * 전체 Zod 스키마를 다시 돌리지 않는 이유는 그 스키마가 서버 시드용이고, 여기서 막으려는
 * 것은 손으로 고친 값·다른 앱의 같은 키·구버전 잔재이기 때문이다.
 */
function normalizeUsableRecord(value: unknown): SavedItineraryStub | null {
  if (!isObject(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || record.id.length === 0) return null;
  if (typeof record.title !== "string") return null;
  if (!isUsableInstant(record.savedAt)) return null;
  // constraints 직렬화 계약이 다르면 되살린 시각이 조용히 어긋난다 — 버리는 편이 낫다
  if (record.schemaVersion !== SAVED_SCHEMA_VERSION) return null;
  if (typeof record.snapshotVersion !== "string") return null;
  if (!isUsableConstraints(record.constraints)) return null;
  if (!isArrayOf(record.days, isUsableDay)) return null;
  if (!isObject(record.context)) return null;
  if (!isArrayOf(record.context.actors, isActorSummary)) return null;
  if (!isArrayOf(record.context.works, isWorkSummary)) return null;
  // warnings는 optional(#43, PR #44 리뷰 2) — 있으면 원소까지 성해야 한다
  if (record.warnings !== undefined && !isArrayOf(record.warnings, isCandidateWarning)) return null;

  const usable = record as unknown as SavedItineraryStub;
  // displayNames도 optional(#130). 깨졌으면 그 필드만 떼고 일정은 살린다 (PR #133 리뷰)
  if (usable.displayNames !== undefined && !isDisplayNameSnapshot(usable.displayNames)) {
    const rest = { ...usable };
    delete rest.displayNames;
    return rest;
  }
  return usable;
}

/** 저장 목록 — 최신순. 손상분은 조용히 걸러낸다 */
export function listLocalItineraries(storage: Storage | null = defaultStorage()): SavedItineraryStub[] {
  const data = readEnvelope<unknown>(SAVED_KEY, storage);
  if (!Array.isArray(data)) return [];
  return data.flatMap((value) => {
    const record = normalizeUsableRecord(value);
    return record === null ? [] : [record];
  });
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
  if (!isObject(data)) return null;
  if (typeof data.savedAt !== "string") return null;

  // 복구 코드가 `draft.trip.arrivalAt`을 바로 읽는다. 하나라도 없으면 undefined가
  // 입력칸에 들어가 화면이 빈 채로 되살아난다.
  const trip = data.trip;
  if (!isObject(trip)) return null;
  const times = [trip.arrivalAt, trip.departureAt, trip.airportReadyAt, trip.airportArrivalDeadline];
  if (!times.every((value) => typeof value === "string" && value.length > 0)) return null;
  // 두 플래그가 없으면 파생 여부를 알 수 없다 — 기본값으로 채우면 원래 의미가 아니게 된다
  if (typeof trip.airportReadyTouched !== "boolean") return null;
  if (typeof trip.airportDeadlineTouched !== "boolean") return null;

  const context = data.context;
  if (!isObject(context)) return null;
  if (!isArrayOf(context.actors, isActorSummary)) return null;
  if (!isArrayOf(context.works, isWorkSummary)) return null;

  if (!isStringArray(data.selectedPlaceIds)) return null;
  return data as LocalDraft;
}

export function clearDraft(storage: Storage | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(DRAFT_KEY);
  } catch {
    // 지우지 못해도 진행한다 — 다음 저장이 덮어쓴다
  }
}
