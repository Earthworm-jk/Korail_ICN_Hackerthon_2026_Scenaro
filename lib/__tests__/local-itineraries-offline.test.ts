import { afterEach, describe, expect, it, vi } from "vitest";
import type { SavedItineraryStub } from "../saved-itineraries-stub";
import {
  clearDraft,
  listLocalItineraries,
  loadDraft,
  saveDraft,
  saveLocalItinerary,
  type LocalDraft,
} from "../local-itineraries";

/**
 * 로컬 저장 어댑터의 fetch-free 회귀 (#118 P0-4 관련)
 *
 * ## 이 파일이 보장하는 것과 보장하지 않는 것
 *
 * 보장: `lib/local-itineraries.ts`의 저장·목록·초안 함수가 **`fetch`를 부르지 않는다.**
 * 나중에 이 경로에 원격 조회를 끼워 넣으면 여기서 걸린다 — 발표장에서가 아니라.
 *
 * 보장하지 않음: 제품의 오프라인 동작 전체. 여기서는 `useSaveStub`도, 실제
 * `window.localStorage`도, 모달의 목록 열기도, `reopenRecord`도 지나지 않는다.
 * 특히 **다시 열기는 이 파일이 검증하지 못한다** — 저장 레코드의 필드를 읽을 뿐이다.
 * 그 경계는 PR #124(`오프라인 저장 일정 재열람 복구`)가 다루며, 통합 확인은 실화면
 * 검증으로 남는다 (PR #125 리뷰).
 *
 * 차단하는 것도 `globalThis.fetch` 하나다. 다른 네트워크 API(WebSocket·EventSource 등)까지
 * 막지는 않는다.
 */

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

/** `fetch` 호출을 즉시 실패시키고, 호출 여부까지 기록한다 */
function cutNetwork(): { calls: () => number } {
  const spy = vi.fn(() => Promise.reject(new TypeError("Failed to fetch (오프라인 회귀)")));
  globalThis.fetch = spy as unknown as typeof fetch;
  return { calls: () => spy.mock.calls.length };
}

function memoryStorage(): Storage {
  const map = new Map<string, string>();
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

const day = {
  date: "2026-08-12",
  items: [{ placeId: "place-yeongjin-beach", arriveAt: "2026-08-12T05:00:00.000Z", departAt: "2026-08-12T06:00:00.000Z", accessMinutes: 25 }],
  rides: [{ trainNo: "KTX-001", fromStationId: "station-seoul", toStationId: "station-gangneung", departAt: "2026-08-12T02:00:00.000Z", arriveAt: "2026-08-12T04:00:00.000Z" }],
  regionWindows: [{ stationId: "station-gangneung", regionId: "region-gangwon", startAt: "2026-08-12T04:00:00.000Z", endAt: "2026-08-12T12:00:00.000Z", availableMinutes: 480, startBoundary: "TRAIN_ARRIVAL", endBoundary: "DAY_END" }],
};

const entry: Omit<SavedItineraryStub, "id" | "savedAt"> = {
  title: "강원 2박 3일",
  days: [day] as unknown as SavedItineraryStub["days"],
  constraints: {
    arrivalAt: "2026-08-12T01:00:00.000Z",
    departureAt: "2026-08-14T09:00:00.000Z",
    airportReadyAt: "2026-08-12T03:00:00.000Z",
    airportArrivalDeadline: "2026-08-14T07:00:00.000Z",
    selectedActorIds: ["actor-kim-go-eun"],
    selectedWorkIds: [],
    excludedPlaceIds: [],
  } as SavedItineraryStub["constraints"],
  schemaVersion: 2,
  snapshotVersion: "2026-08-09",
  context: {
    actors: [{ id: "actor-kim-go-eun", name: { ko: "김고은", en: "Kim Go-eun" } }],
    works: [],
  },
};

describe("저장 어댑터가 fetch를 부르지 않는다", () => {
  it("저장 → 목록 → 레코드 읽기가 fetch 호출 0건으로 완결된다", () => {
    const net = cutNetwork();
    const storage = memoryStorage();

    const saved = saveLocalItinerary(entry, storage);
    expect(saved.ok).toBe(true);

    const list = listLocalItineraries(storage);
    expect(list).toHaveLength(1);
    expect(saved.ok && list[0].id).toBe(saved.ok && saved.record.id);

    // 다시 열기가 읽어 갈 필드들. 재열람 동작 자체는 여기서 호출하지 않는다 —
    // 저장 레코드만으로 복원에 필요한 값이 남아 있는지만 본다.
    expect(list[0].days).toHaveLength(1);
    expect(list[0].context.actors[0].name.ko).toBe("김고은");
    expect(list[0].constraints.selectedActorIds).toEqual(["actor-kim-go-eun"]);

    expect(net.calls()).toBe(0);
  });

  it("초안 저장·복구도 fetch를 쓰지 않는다", () => {
    const net = cutNetwork();
    const storage = memoryStorage();
    const draft: LocalDraft = {
      savedAt: "2026-08-10T00:00:00.000Z",
      trip: { arrivalAt: "2026-08-12T10:00" },
      selectedActorIds: ["actor-kim-go-eun"],
      selectedWorkIds: [],
      selectedPlaceIds: ["place-yeongjin-beach"],
    };

    expect(saveDraft(draft, storage)).toBe(true);
    expect(loadDraft(storage)).toEqual(draft);
    clearDraft(storage);
    expect(loadDraft(storage)).toBeNull();

    expect(net.calls()).toBe(0);
  });

  // 새로고침·모듈 재초기화·기본 window.localStorage 연결은 여기서 검증하지 않는다 (PR #125 리뷰)
  it("같은 저장소에서 다시 읽으면 목록이 복구된다", () => {
    const net = cutNetwork();
    const storage = memoryStorage();
    saveLocalItinerary(entry, storage);

    // 모듈 안에 캐시를 두지 않고 저장소에서만 읽는지 — 새로고침 복구의 필요조건이다
    const afterReload = listLocalItineraries(storage);
    expect(afterReload.map((r) => r.title)).toEqual(["강원 2박 3일"]);

    expect(net.calls()).toBe(0);
  });
});
