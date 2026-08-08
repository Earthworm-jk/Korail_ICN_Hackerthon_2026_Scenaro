/**
 * 대안 시간표 mock 공급자 — #14 안건 ⑨ 확정(추천 1 + 검증 대안, 전체 일정 교체)의 UI 선행 구현.
 * 엔진 alternatives 출력 계약(#33 이후 후속 PR)이 확정되면 이 모듈을 삭제하고 엔진 출력으로 교체한다.
 *
 * mock 규칙(결정적): 열차가 있는 날마다 첫 구간을 +60분·+120분 이동한 가상 일정을 만든다.
 * 실존 시간표의 열차가 아니므로 UI는 항상 목업 배지와 함께 표시한다. 대안 개수·다양성 규칙의
 * 최종 기준은 엔진 계약이 정한다(여기서는 화면 상호작용 검증이 목적).
 */
import type { DayPlan } from "./engine/types";

export type MockAlternative = {
  id: string;
  /** 대안이 출발 시각을 바꾸는 날짜 (KST YYYY-MM-DD) */
  date: string;
  /** 추천 대비 해당 날짜 첫 구간 출발 이동량(분) */
  shiftMinutes: number;
  /** 선택 시 교체되는 전체 일정 — 부분 패치가 아니라 통째 교체 (#14 §7) */
  days: DayPlan[];
  effects: {
    localUseDeltaMinutes: number; // 현지 활용 가능 시간 변화(음수 = 감소)
    excludedPlaceIds: string[]; // 이 대안에서 추가로 배치 제외되는 장소
  };
};

const SHIFTS = [60, 120] as const;

function shiftIso(iso: string, minutes: number): string {
  return new Date(Date.parse(iso) + minutes * 60_000).toISOString();
}

/** 대상 날짜의 구간·장소 시각만 이동하고 나머지 날짜는 그대로 둔 전체 일정을 만든다 */
function shiftedDays(
  days: DayPlan[],
  date: string,
  minutes: number,
  dropPlaceIds: ReadonlySet<string>,
): DayPlan[] {
  return days.map((day) => {
    if (day.date !== date) return day;
    return {
      ...day,
      rides: day.rides.map((ride) => ({
        ...ride,
        departAt: shiftIso(ride.departAt, minutes),
        arriveAt: shiftIso(ride.arriveAt, minutes),
      })),
      items: day.items
        .filter((item) => !dropPlaceIds.has(item.placeId))
        .map((item) => ({
          ...item,
          arriveAt: shiftIso(item.arriveAt, minutes),
          departAt: shiftIso(item.departAt, minutes),
        })),
    };
  });
}

/**
 * 추천 일정에서 mock 대안을 만든다. 열차가 있는 날마다 최대 2개.
 * 가장 큰 이동(+120분)은 그날 장소가 2곳 이상일 때 마지막 장소를 제외해
 * "현지 활용 감소 → 장소 1곳 제외" 시나리오(#14 §7 영향 표기)를 재현한다.
 */
export function buildMockAlternatives(days: DayPlan[]): MockAlternative[] {
  const alternatives: MockAlternative[] = [];
  for (const day of days) {
    if (day.rides.length === 0) continue;
    for (const shift of SHIFTS) {
      const dropLast = shift === 120 && day.items.length >= 2;
      const dropped = dropLast ? [day.items[day.items.length - 1].placeId] : [];
      alternatives.push({
        id: `mock-${day.date}-${shift}`,
        date: day.date,
        shiftMinutes: shift,
        days: shiftedDays(days, day.date, shift, new Set(dropped)),
        effects: {
          localUseDeltaMinutes: -shift,
          excludedPlaceIds: dropped,
        },
      });
    }
  }
  return alternatives;
}
