import { describe, expect, it } from "vitest";
import type { SavedItineraryStub } from "../saved-itineraries-stub";
import {
  DRAFT_KEY,
  LOCAL_STORAGE_VERSION,
  SAVED_KEY,
  clearDraft,
  listLocalItineraries,
  loadDraft,
  saveDraft,
  saveLocalItinerary,
  type LocalDraft,
} from "../local-itineraries";

/**
 * 로컬 저장 어댑터 (#118 P0-3)
 *
 * 여기서 고정하는 것은 "정상 저장이 된다"보다 **깨진 입력에서 앱이 안 죽는다**에 가깝다.
 * 발표 중에 저장이 실패하는 것보다 나쁜 것은 손상된 값으로 화면이 터지는 것이다.
 */

/** node 테스트용 최소 Storage — 실제와 같은 인터페이스만 만족시킨다 */
function memoryStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(seed));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => (map.has(key) ? (map.get(key) as string) : null),
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}

/** 쓰기가 항상 던지는 저장소 — 사파리 프라이빗 모드·용량 초과 */
function throwingStorage(): Storage {
  const base = memoryStorage();
  return {
    ...base,
    get length() {
      return base.length;
    },
    getItem: (key: string) => base.getItem(key),
    key: (index: number) => base.key(index),
    setItem: () => {
      throw new DOMException("QuotaExceededError");
    },
    removeItem: () => {
      throw new DOMException("SecurityError");
    },
  };
}

const entry: Omit<SavedItineraryStub, "id" | "savedAt"> = {
  title: "강원 2박 3일",
  days: [],
  constraints: {
    arrivalAt: "2026-08-12T01:00:00.000Z",
    departureAt: "2026-08-14T09:00:00.000Z",
    airportReadyAt: "2026-08-12T03:00:00.000Z",
    airportArrivalDeadline: "2026-08-14T07:00:00.000Z",
    selectedActorIds: [],
    selectedWorkIds: [],
    excludedPlaceIds: [],
  } as SavedItineraryStub["constraints"],
  schemaVersion: 2,
  snapshotVersion: "2026-08-09",
  context: { actors: [], works: [] },
};

describe("저장·목록·다시 열기", () => {
  it("저장한 일정이 목록에 남는다 — 최신이 앞", () => {
    const storage = memoryStorage();
    const first = saveLocalItinerary({ ...entry, title: "첫 번째" }, storage);
    const second = saveLocalItinerary({ ...entry, title: "두 번째" }, storage);
    expect(first.ok && second.ok).toBe(true);

    const list = listLocalItineraries(storage);
    expect(list.map((r) => r.title)).toEqual(["두 번째", "첫 번째"]);
  });

  it("id가 서로 다르다 — 같은 내용을 두 번 저장해도 덮어쓰지 않는다", () => {
    const storage = memoryStorage();
    const a = saveLocalItinerary(entry, storage);
    const b = saveLocalItinerary(entry, storage);
    expect(a.ok && b.ok && a.record.id !== b.record.id).toBe(true);
  });

  it("savedAt은 주입한 시각을 쓴다 — 테스트가 시계에 흔들리지 않는다", () => {
    const storage = memoryStorage();
    const at = new Date("2026-08-10T12:34:56.000Z");
    const result = saveLocalItinerary(entry, storage, at);
    expect(result.ok && result.record.savedAt).toBe(at.toISOString());
  });

  it("저장한 적 없으면 빈 목록이다", () => {
    expect(listLocalItineraries(memoryStorage())).toEqual([]);
  });
});

describe("깨진 저장소에서 죽지 않는다", () => {
  it("쓰기가 던지면 ok:false이고 목록은 그대로다", () => {
    const storage = throwingStorage();
    const result = saveLocalItinerary(entry, storage);
    expect(result.ok).toBe(false);
    // 화면에는 저장됐다고 하고 다시 열면 없는 상태를 만들지 않는다
    expect(listLocalItineraries(storage)).toEqual([]);
  });

  it("손상된 JSON은 빈 목록으로 읽는다", () => {
    const storage = memoryStorage({ [SAVED_KEY]: "{이건 JSON이 아니다" });
    expect(listLocalItineraries(storage)).toEqual([]);
  });

  it("봉투 버전이 다르면 해석하지 않는다", () => {
    const stale = JSON.stringify({
      version: LOCAL_STORAGE_VERSION + 1,
      data: [{ id: "x", title: "미래", savedAt: "2026-08-10T00:00:00.000Z", days: [], constraints: {} }],
    });
    expect(listLocalItineraries(memoryStorage({ [SAVED_KEY]: stale }))).toEqual([]);
  });

  it("배열이 아닌 데이터도 빈 목록이다", () => {
    const wrong = JSON.stringify({ version: LOCAL_STORAGE_VERSION, data: { nope: true } });
    expect(listLocalItineraries(memoryStorage({ [SAVED_KEY]: wrong }))).toEqual([]);
  });

  it("모양이 깨진 레코드만 걸러내고 성한 것은 남긴다", () => {
    const storage = memoryStorage();
    saveLocalItinerary(entry, storage);
    const good = listLocalItineraries(storage);
    const mixed = JSON.stringify({
      version: LOCAL_STORAGE_VERSION,
      data: [{ id: "", title: "빈 id" }, null, "문자열", ...good],
    });
    const list = listLocalItineraries(memoryStorage({ [SAVED_KEY]: mixed }));
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(good[0].id);
  });

  /**
   * PR #123 리뷰 2 — 겉모양만 보면 통과하지만 **실제 소비 지점에서 깨지는** 레코드들.
   *
   * 목록은 `Intl.DateTimeFormat(...).format(new Date(savedAt))`을 부르고, 재열람은
   * `tripInputsFromConstraints(constraints)`와 `record.context.actors/works`를 그대로 쓴다.
   * 여기서 걸러내지 못하면 저장 목록을 여는 순간 또는 다시 열기에서 앱이 죽는다.
   */
  it("겉모양은 성해도 소비 지점에서 깨질 레코드를 걸러낸다", () => {
    const [ok] = (() => {
      const storage = memoryStorage();
      saveLocalItinerary(entry, storage);
      return listLocalItineraries(storage);
    })();

    const broken: Record<string, unknown>[] = [
      { ...ok, id: "bad-savedAt", savedAt: "not-a-date" },
      { ...ok, id: "no-context", context: undefined },
      { ...ok, id: "context-not-array", context: { actors: "김고은", works: [] } },
      { ...ok, id: "empty-constraints", constraints: {} },
      { ...ok, id: "bad-instant", constraints: { ...ok.constraints, arrivalAt: "언제" } },
      {
        ...ok,
        id: "ids-not-strings",
        constraints: { ...ok.constraints, selectedActorIds: [1, 2] },
      },
      { ...ok, id: "old-schema", schemaVersion: 1 },
      { ...ok, id: "no-snapshot", snapshotVersion: undefined },
      { ...ok, id: "days-not-days", days: [{ date: "2026-08-12" }] },
      { ...ok, id: "warnings-not-array", warnings: "경고" },
    ];

    for (const record of broken) {
      const raw = JSON.stringify({ version: LOCAL_STORAGE_VERSION, data: [record, ok] });
      const list = listLocalItineraries(memoryStorage({ [SAVED_KEY]: raw }));
      expect(list.map((r) => r.id), String(record.id)).toEqual([ok.id]);
    }
  });

  it("걸러낸 뒤 남은 레코드는 목록 포맷과 재열람이 실제로 쓸 수 있다", () => {
    const storage = memoryStorage();
    saveLocalItinerary(entry, storage);
    const [record] = listLocalItineraries(storage);
    // 목록이 부르는 그 식 — 잘못된 값이면 RangeError를 던진다
    expect(() =>
      new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul" }).format(new Date(record.savedAt)),
    ).not.toThrow();
    // 재열람이 참조하는 지점들
    expect(Array.isArray(record.context.actors)).toBe(true);
    expect(Number.isNaN(new Date(record.constraints.airportArrivalDeadline).getTime())).toBe(false);
  });

  it("저장소 자체가 없어도(서버 렌더) 무해하다", () => {
    expect(listLocalItineraries(null)).toEqual([]);
    expect(saveLocalItinerary(entry, null).ok).toBe(false);
    expect(loadDraft(null)).toBeNull();
    expect(saveDraft({} as LocalDraft, null)).toBe(false);
    expect(() => clearDraft(null)).not.toThrow();
  });
});

describe("조율 중 초안", () => {
  const draft: LocalDraft = {
    savedAt: "2026-08-10T00:00:00.000Z",
    trip: { arrivalAt: "2026-08-12T10:00" },
    selectedActorIds: ["actor-kim-go-eun"],
    selectedWorkIds: [],
    selectedPlaceIds: ["place-yeongjin-beach"],
  };

  it("저장한 초안을 그대로 되찾는다", () => {
    const storage = memoryStorage();
    expect(saveDraft(draft, storage)).toBe(true);
    expect(loadDraft(storage)).toEqual(draft);
  });

  it("초안이 없으면 null이다 — 호출부는 빈 화면에서 시작한다", () => {
    expect(loadDraft(memoryStorage())).toBeNull();
  });

  it("손상된 초안은 null이다", () => {
    expect(loadDraft(memoryStorage({ [DRAFT_KEY]: "깨짐" }))).toBeNull();
  });

  it("필드 모양이 계약과 다르면 null이다", () => {
    const wrong = JSON.stringify({
      version: LOCAL_STORAGE_VERSION,
      data: { savedAt: "2026-08-10T00:00:00.000Z", trip: {}, selectedActorIds: [1, 2] },
    });
    expect(loadDraft(memoryStorage({ [DRAFT_KEY]: wrong }))).toBeNull();
  });

  it("초안을 지우면 최종 저장 목록은 남는다", () => {
    const storage = memoryStorage();
    saveLocalItinerary(entry, storage);
    saveDraft(draft, storage);
    clearDraft(storage);
    expect(loadDraft(storage)).toBeNull();
    expect(listLocalItineraries(storage)).toHaveLength(1);
  });

  it("쓰기가 던져도 false만 돌려준다", () => {
    expect(saveDraft(draft, throwingStorage())).toBe(false);
  });
});
