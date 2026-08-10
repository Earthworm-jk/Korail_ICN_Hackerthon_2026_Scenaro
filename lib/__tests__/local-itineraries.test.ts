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

/**
 * 실제 저장 레코드에 가까운 fixture.
 *
 * 빈 배열만으로 검증하면 "원소까지 본다"는 계약을 확인할 수 없다 — 통과도 실패도 공허해진다.
 * 그래서 하루·탑승·방문·권역창·경고·선택 칩을 모두 한 건씩 채운다.
 */
const day = {
  date: "2026-08-12",
  items: [{ placeId: "place-yeongjin-beach", arriveAt: "2026-08-12T05:00:00.000Z", departAt: "2026-08-12T06:00:00.000Z", accessMinutes: 25 }],
  rides: [{ trainNo: "KTX-001", fromStationId: "station-seoul", toStationId: "station-gangneung", departAt: "2026-08-12T02:00:00.000Z", arriveAt: "2026-08-12T04:00:00.000Z" }],
  regionWindows: [{ stationId: "station-gangneung", regionId: "region-gangwon", startAt: "2026-08-12T04:00:00.000Z", endAt: "2026-08-12T12:00:00.000Z", availableMinutes: 480, startBoundary: "TRAIN_ARRIVAL", endBoundary: "DAY_END" }],
};

const entry: Omit<SavedItineraryStub, "id" | "savedAt"> = {
  title: "강원 2박 3일",
  days: [day] as unknown as SavedItineraryStub["days"],
  warnings: [{ code: "ACTIVITY_WINDOW_MISMATCH", placeId: "place-lala-muri", detail: "UNVERIFIED_HOURS" }],
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
  context: {
    actors: [{ id: "actor-kim-go-eun", name: { ko: "김고은", en: "Kim Go-eun" } }],
    works: [{ id: "work-goblin", title: { ko: "도깨비", en: "Goblin" } }],
  },
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

  /**
   * PR #123 2차 리뷰 — 배열 여부만 보면 `[null]`이 통과한다. 다시 열었을 때 렌더가
   * 원소의 `placeId`·`trainNo`·`name[locale]`을 바로 읽으므로 그 자리에서 죽는다.
   */
  it("중첩 배열의 원소가 깨진 레코드를 걸러낸다", () => {
    const [ok] = (() => {
      const storage = memoryStorage();
      saveLocalItinerary(entry, storage);
      return listLocalItineraries(storage);
    })();
    const [firstDay] = ok.days as unknown as Record<string, unknown>[];

    const broken: Record<string, unknown>[] = [
      { ...ok, id: "actor-null", context: { ...ok.context, actors: [null] } },
      { ...ok, id: "actor-no-name", context: { ...ok.context, actors: [{ id: "a" }] } },
      // WorkSummary의 제목 키는 title이다 — name을 넣으면 화면이 undefined를 읽는다
      { ...ok, id: "work-wrong-key", context: { ...ok.context, works: [{ id: "w", name: { ko: "도깨비", en: "Goblin" } }] } },
      { ...ok, id: "item-null", days: [{ ...firstDay, items: [null] }] },
      { ...ok, id: "item-no-placeId", days: [{ ...firstDay, items: [{ arriveAt: "2026-08-12T05:00:00.000Z", departAt: "2026-08-12T06:00:00.000Z", accessMinutes: 10 }] }] },
      { ...ok, id: "ride-null", days: [{ ...firstDay, rides: [null] }] },
      { ...ok, id: "ride-bad-instant", days: [{ ...firstDay, rides: [{ ...(firstDay.rides as unknown[])[0] as object, departAt: "언제" }] }] },
      { ...ok, id: "window-null", days: [{ ...firstDay, regionWindows: [null] }] },
      { ...ok, id: "window-minutes-string", days: [{ ...firstDay, regionWindows: [{ ...(firstDay.regionWindows as unknown[])[0] as object, availableMinutes: "480" }] }] },
      { ...ok, id: "gateway-null", days: [{ ...firstDay, gatewayLegs: [null] }] },
      { ...ok, id: "warning-null", warnings: [null] },
      { ...ok, id: "warning-no-detail", warnings: [{ code: "ACTIVITY_WINDOW_MISMATCH", placeId: "p" }] },
    ];

    for (const record of broken) {
      const raw = JSON.stringify({ version: LOCAL_STORAGE_VERSION, data: [record, ok] });
      const list = listLocalItineraries(memoryStorage({ [SAVED_KEY]: raw }));
      expect(list.map((r) => r.id), String(record.id)).toEqual([ok.id]);
    }
  });

  /**
   * 표시 이름 스냅샷 (#130) — optional이다.
   *
   * 이 필드가 생기기 전 저장분이 이미 브라우저에 있다. 없다고 걸러내면 사용자가 저장했던
   * 일정이 목록에서 사라진다. 반대로 있는데 모양이 깨졌으면, 화면이 `names[id][locale]`을
   * 바로 읽으므로 그 자리에서 죽는다.
   */
  it("표시 이름 스냅샷이 없어도 기존 저장분은 살아남는다", () => {
    const storage = memoryStorage();
    saveLocalItinerary(entry, storage);
    const [legacy] = listLocalItineraries(storage);
    expect(legacy.displayNames).toBeUndefined();

    const raw = JSON.stringify({ version: LOCAL_STORAGE_VERSION, data: [legacy] });
    expect(listLocalItineraries(memoryStorage({ [SAVED_KEY]: raw })).map((r) => r.id)).toEqual([legacy.id]);
  });

  it("성한 스냅샷이 있으면 그대로 실려 온다", () => {
    const storage = memoryStorage();
    const withNames = {
      ...entry,
      displayNames: {
        places: { "place-yeongjin-beach": { ko: "영진해변", en: "Yeongjin Beach" } },
        stations: { "station-seoul": { ko: "서울역", en: "Seoul Station" } },
      },
    };
    saveLocalItinerary(withNames, storage);
    const [record] = listLocalItineraries(storage);
    expect(record.displayNames?.places["place-yeongjin-beach"].ko).toBe("영진해변");
    expect(record.displayNames?.stations["station-seoul"].en).toBe("Seoul Station");
  });

  /**
   * PR #133 리뷰 — 보조 필드 하나 때문에 일정 전체를 버리면 안 된다.
   *
   * 걸러진 레코드는 목록에서만 사라지는 게 아니다. 다음 저장이 `listLocalItineraries`
   * 결과 위에 다시 쓰므로 **저장소에서 영구히 사라진다.**
   */
  it("스냅샷만 깨졌으면 그 필드만 떼고 일정은 살린다", () => {
    const storage = memoryStorage();
    saveLocalItinerary(entry, storage);
    const [ok] = listLocalItineraries(storage);

    const brokenSnapshots: Record<string, unknown>[] = [
      "이름",
      { places: {} }, // stations 누락
      { places: { p: null }, stations: {} },
      { places: { p: { ko: "영진해변" } }, stations: {} }, // en 누락
      { places: {}, stations: { s: "서울역" } },
      { places: [], stations: {} }, // 배열도 object라 Record처럼 통과하던 경우
      { places: { p: { ko: " ", en: " " } }, stations: {} }, // 공백만
    ].map((displayNames) => ({ ...ok, displayNames }));

    for (const [i, record] of brokenSnapshots.entries()) {
      const raw = JSON.stringify({ version: LOCAL_STORAGE_VERSION, data: [record] });
      const list = listLocalItineraries(memoryStorage({ [SAVED_KEY]: raw }));
      // 일정은 살아 있고
      expect(list.map((r) => r.id), `case ${i}`).toEqual([ok.id]);
      // 못 쓰는 필드만 사라진다
      expect(list[0].displayNames, `case ${i}`).toBeUndefined();
      // 나머지는 그대로다
      expect(list[0].days, `case ${i}`).toEqual(ok.days);
    }
  });

  it("깨진 스냅샷을 실은 일정도 이후 새 저장에서 지워지지 않는다", () => {
    const seedStorage = memoryStorage();
    saveLocalItinerary(entry, seedStorage);
    const [ok] = listLocalItineraries(seedStorage);

    const storage = memoryStorage({
      [SAVED_KEY]: JSON.stringify({
        version: LOCAL_STORAGE_VERSION,
        data: [{ ...ok, displayNames: { places: { p: null }, stations: {} } }],
      }),
    });

    const added = saveLocalItinerary({ ...entry, title: "새 일정" }, storage);
    expect(added.ok).toBe(true);

    const list = listLocalItineraries(storage);
    expect(list.map((r) => r.title)).toEqual(["새 일정", ok.title]);
    expect(list[1].displayNames).toBeUndefined();
  });

  it("core가 깨진 레코드는 여전히 통째로 제외한다", () => {
    const storage = memoryStorage();
    saveLocalItinerary(entry, storage);
    const [ok] = listLocalItineraries(storage);
    const raw = JSON.stringify({
      version: LOCAL_STORAGE_VERSION,
      data: [{ ...ok, id: "no-context", context: undefined, displayNames: { places: {}, stations: {} } }, ok],
    });
    expect(listLocalItineraries(memoryStorage({ [SAVED_KEY]: raw })).map((r) => r.id)).toEqual([ok.id]);
  });

  it("걸러낸 뒤 남은 레코드는 목록 포맷과 재열람이 실제로 쓸 수 있다", () => {
    const storage = memoryStorage();
    saveLocalItinerary(entry, storage);
    const [record] = listLocalItineraries(storage);

    // 목록이 부르는 그 식 — 잘못된 값이면 RangeError를 던진다
    expect(() =>
      new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul" }).format(new Date(record.savedAt)),
    ).not.toThrow();

    // 재열람 직후 화면이 원소를 읽는 지점들 — 여기서 죽지 않아야 걸러내기가 의미가 있다
    expect(() => {
      for (const actor of record.context.actors) void actor.name.ko;
      for (const work of record.context.works) void work.title.en;
      for (const d of record.days) {
        for (const item of d.items) void item.placeId.length;
        for (const ride of d.rides) void `${ride.trainNo}-${ride.departAt}`;
        for (const w of d.regionWindows) void w.availableMinutes.toFixed(0);
      }
      for (const warning of record.warnings ?? []) void warning.placeId.length;
    }).not.toThrow();

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
    trip: {
      arrivalAt: "2026-08-12T10:00",
      departureAt: "2026-08-14T18:00",
      airportReadyAt: "2026-08-12T12:00",
      airportArrivalDeadline: "2026-08-14T16:00",
      airportReadyTouched: false,
      airportDeadlineTouched: true,
    },
    context: {
      actors: [{ id: "actor-kim-go-eun", name: { ko: "김고은", en: "Kim Go-eun" } }],
      works: [],
    },
    selectedPlaceIds: ["place-yeongjin-beach"],
    preferredVisitDates: { "place-yeongjin-beach": "2026-08-13" },
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
      data: { savedAt: "2026-08-10T00:00:00.000Z", trip: {}, selectedPlaceIds: [1, 2] },
    });
    expect(loadDraft(memoryStorage({ [DRAFT_KEY]: wrong }))).toBeNull();
  });

  /**
   * PR #127 리뷰 1·2 — 복구 코드가 바로 읽는 값들이다. `touched`가 없으면 파생 여부를
   * 알 수 없고(기본값으로 채우면 원래 의미가 아니다), 배우 요약이 없으면 선택 칩이
   * 이름을 읽지 못한다.
   */
  it("복구에 필요한 값이 빠진 초안은 null이다", () => {
    const storage = memoryStorage();
    saveDraft(draft, storage);
    const ok = loadDraft(storage) as LocalDraft;

    const broken: Record<string, unknown>[] = [
      { ...ok, trip: { ...ok.trip, airportReadyTouched: undefined } },
      { ...ok, trip: { ...ok.trip, airportDeadlineTouched: "true" } },
      { ...ok, trip: { ...ok.trip, arrivalAt: "" } },
      { ...ok, context: undefined },
      { ...ok, context: { actors: [null], works: [] } },
      { ...ok, context: { actors: [{ id: "a" }], works: [] } },
      { ...ok, context: { actors: [], works: [{ id: "w", name: { ko: "도깨비", en: "Goblin" } }] } },
      { ...ok, selectedPlaceIds: [1] },
      { ...ok, preferredVisitDates: { "place-yeongjin-beach": "둘째 날" } },
    ];

    for (const [i, value] of broken.entries()) {
      const raw = JSON.stringify({ version: LOCAL_STORAGE_VERSION, data: value });
      expect(loadDraft(memoryStorage({ [DRAFT_KEY]: raw })), `case ${i}`).toBeNull();
    }
  });

  it("성한 초안은 복구 코드가 읽는 지점에서 죽지 않는다", () => {
    const storage = memoryStorage();
    saveDraft(draft, storage);
    const ok = loadDraft(storage) as LocalDraft;
    expect(() => {
      void ok.trip.arrivalAt.length;
      void ok.trip.airportReadyTouched;
      for (const actor of ok.context.actors) void actor.name.ko;
      for (const work of ok.context.works) void work.title.en;
      for (const id of ok.selectedPlaceIds) void id.length;
      for (const [id, date] of Object.entries(ok.preferredVisitDates)) void `${id}:${date}`;
    }).not.toThrow();
  });

  it("방문일 필드 추가 전 v1 초안은 빈 선호로 하위 호환 복구한다", () => {
    const legacy: Partial<LocalDraft> = { ...draft };
    delete legacy.preferredVisitDates;
    const raw = JSON.stringify({ version: LOCAL_STORAGE_VERSION, data: legacy });
    expect(loadDraft(memoryStorage({ [DRAFT_KEY]: raw }))).toEqual({
      ...legacy,
      preferredVisitDates: {},
    });
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
