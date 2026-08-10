/**
 * 표시 이름 수집·조회 (#130) — 순수 함수
 *
 * `lib/auto-plan.ts`(#85)·`lib/save-routing.ts`(#123)·`lib/local-draft.ts`(#118)와 같은
 * 이유로 화면 밖에 둔다. 조회 순서와 수집 범위가 컴포넌트 안에 흩어져 있으면 "네트워크가
 * 끊겼을 때 무엇이 보이는가"를 테스트로 고정할 수 없다.
 *
 * #130은 정확히 그 자리에서 났다 — 이름을 후보 응답에서만 찾고 없으면 `?? id`로 떨어져,
 * 오프라인 재열람에서 `place-seoullo-7017` 같은 내부 ID가 화면에 나왔다.
 */
import type { DayPlan } from "./engine/types";
import type { DisplayNameSnapshot, LocalizedName } from "./saved-itineraries-stub";
import type { Locale } from "./i18n/messages";

/** 저장 시점에 이름을 찾아 주는 쪽(후보 응답)을 함수로 받는다 — 이 모듈은 데이터를 모른다 */
export type NameFinder = {
  place: (id: string) => LocalizedName | undefined;
  station: (id: string) => LocalizedName | undefined;
};

/**
 * 저장 레코드에 담을 이름을 모은다.
 *
 * **이 일정에 실제로 쓰인 것만** 담는다 — 전체 후보를 담을 이유가 없고, 저장 용량은
 * 브라우저 몫이다.
 *
 * - 장소: `days[].items[].placeId`
 * - 역: `days[].rides`의 출발·도착역
 *
 * gateway leg는 레코드가 `fromName`·`toName`을 이미 갖고 있어 제외한다.
 * 찾지 못한 id는 담지 않는다 — 빈 값을 넣으면 화면이 공백을 찍는다.
 */
export function collectDisplayNames(days: readonly DayPlan[], find: NameFinder): DisplayNameSnapshot {
  const places: Record<string, LocalizedName> = {};
  const stations: Record<string, LocalizedName> = {};
  for (const day of days) {
    for (const item of day.items) {
      const name = find.place(item.placeId);
      if (name) places[item.placeId] = { ko: name.ko, en: name.en };
    }
    for (const ride of day.rides) {
      for (const id of [ride.fromStationId, ride.toStationId]) {
        const name = find.station(id);
        if (name) stations[id] = { ko: name.ko, en: name.en };
      }
    }
  }
  return { places, stations };
}

/**
 * 화면에 쓸 이름 하나를 정한다.
 *
 * 순서가 계약이다.
 *
 * 1. **현재 데이터** — 저장 이후 이름이 바뀌었을 수 있으므로 살아 있으면 이쪽이 먼저다
 * 2. **저장 당시 스냅샷** — 재조회가 실패해도 이름을 보여줄 수 있는 이유
 * 3. **대체 문구** — 마지막이 내부 ID가 되어서는 안 된다 (#130)
 */
export function resolveDisplayName(input: {
  locale: Locale;
  current?: LocalizedName;
  saved?: LocalizedName;
  fallback: string;
}): string {
  return input.current?.[input.locale] ?? input.saved?.[input.locale] ?? input.fallback;
}
