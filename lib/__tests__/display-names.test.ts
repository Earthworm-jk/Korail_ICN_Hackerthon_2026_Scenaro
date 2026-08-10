import { describe, expect, it } from "vitest";
import { collectDisplayNames, resolveDisplayName, type NameFinder } from "../display-names";
import type { DayPlan } from "../engine/types";

/**
 * 표시 이름 계약 (#130)
 *
 * 오프라인 재열람에서 `place-seoullo-7017` 같은 내부 ID가 화면에 나오던 결함을 고정한다.
 * 조회 순서와 수집 범위가 컴포넌트 안에만 있으면 UI를 손볼 때 조용히 되돌아온다.
 */

const NAMES: Record<string, { ko: string; en: string }> = {
  "place-seoullo-7017": { ko: "서울로7017", en: "Seoullo 7017" },
  "place-yeongjin-beach": { ko: "영진해변", en: "Yeongjin Beach" },
  "station-seoul": { ko: "서울역", en: "Seoul Station" },
  "station-gangneung": { ko: "강릉역", en: "Gangneung Station" },
};

const find: NameFinder = {
  place: (id) => NAMES[id],
  station: (id) => NAMES[id],
};

function day(placeIds: string[], rides: [string, string][] = []): DayPlan {
  return {
    date: "2026-08-12",
    items: placeIds.map((placeId) => ({
      placeId,
      arriveAt: "2026-08-12T03:00:00.000Z",
      departAt: "2026-08-12T04:00:00.000Z",
      accessMinutes: 10,
    })),
    rides: rides.map(([from, to], i) => ({
      trainNo: `KTX-${i}`,
      fromStationId: from,
      toStationId: to,
      departAt: "2026-08-12T00:00:00.000Z",
      arriveAt: "2026-08-12T02:00:00.000Z",
    })),
    regionWindows: [],
  };
}

describe("저장 시점 이름 수집", () => {
  it("일정에 실제로 쓰인 장소·역만 담는다", () => {
    const snapshot = collectDisplayNames(
      [day(["place-seoullo-7017"], [["station-seoul", "station-gangneung"]])],
      find,
    );
    expect(Object.keys(snapshot.places)).toEqual(["place-seoullo-7017"]);
    expect(Object.keys(snapshot.stations).sort()).toEqual(["station-gangneung", "station-seoul"]);
    // 쓰이지 않은 장소는 후보에 있어도 담지 않는다
    expect(snapshot.places["place-yeongjin-beach"]).toBeUndefined();
  });

  it("두 언어를 모두 담는다 — 재열람 뒤에도 ko/en 전환이 동작해야 한다", () => {
    const snapshot = collectDisplayNames([day(["place-seoullo-7017"])], find);
    expect(snapshot.places["place-seoullo-7017"]).toEqual({ ko: "서울로7017", en: "Seoullo 7017" });
  });

  it("찾지 못한 id는 담지 않는다 — 빈 값을 넣으면 화면이 공백을 찍는다", () => {
    const snapshot = collectDisplayNames([day(["place-unknown"], [["station-unknown", "station-seoul"]])], find);
    expect(snapshot.places).toEqual({});
    expect(Object.keys(snapshot.stations)).toEqual(["station-seoul"]);
  });

  it("여러 날에 걸쳐 중복 없이 모은다", () => {
    const snapshot = collectDisplayNames(
      [
        day(["place-seoullo-7017"], [["station-seoul", "station-gangneung"]]),
        day(["place-seoullo-7017", "place-yeongjin-beach"], [["station-gangneung", "station-seoul"]]),
      ],
      find,
    );
    expect(Object.keys(snapshot.places).sort()).toEqual(["place-seoullo-7017", "place-yeongjin-beach"]);
    expect(Object.keys(snapshot.stations)).toHaveLength(2);
  });

  it("빈 일정에서도 죽지 않는다", () => {
    expect(collectDisplayNames([], find)).toEqual({ places: {}, stations: {} });
  });
});

describe("이름 조회 우선순위", () => {
  const current = { ko: "지금 이름", en: "Current" };
  const saved = { ko: "저장 당시 이름", en: "Saved" };

  it("현재 데이터가 저장 스냅샷보다 먼저다 — 저장 이후 이름이 바뀌었을 수 있다", () => {
    expect(resolveDisplayName({ locale: "ko", current, saved, fallback: "대체" })).toBe("지금 이름");
    expect(resolveDisplayName({ locale: "en", current, saved, fallback: "fallback" })).toBe("Current");
  });

  it("현재 데이터가 없으면 저장 스냅샷을 쓴다 — 오프라인 재열람이 이 경로다", () => {
    expect(resolveDisplayName({ locale: "ko", saved, fallback: "대체" })).toBe("저장 당시 이름");
    expect(resolveDisplayName({ locale: "en", saved, fallback: "fallback" })).toBe("Saved");
  });

  /** #130의 본체 — 마지막 폴백이 내부 ID였다 */
  it("둘 다 없으면 대체 문구다 — 절대 내부 ID가 아니다", () => {
    const result = resolveDisplayName({ locale: "ko", fallback: "이름을 불러오지 못했습니다" });
    expect(result).toBe("이름을 불러오지 못했습니다");
    expect(result).not.toMatch(/^(place|station)-/);
  });

  it("locale마다 같은 순서를 탄다", () => {
    for (const locale of ["ko", "en"] as const) {
      expect(resolveDisplayName({ locale, current, saved, fallback: "x" })).toBe(current[locale]);
      expect(resolveDisplayName({ locale, saved, fallback: "x" })).toBe(saved[locale]);
      expect(resolveDisplayName({ locale, fallback: "x" })).toBe("x");
    }
  });
});
