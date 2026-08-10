/**
 * 조율 중 초안 저장 판단 (#118 P0-3 레인 B) — 순수 함수
 *
 * `lib/auto-plan.ts`(#85)·`lib/save-routing.ts`(#123)와 같은 이유로 훅 밖에 둔다. 언제
 * 쓰고 언제 건너뛸지를 effect 안에 흩어 두면 "재열람 중에 초안이 덮였다" 같은 전이를
 * 테스트로 고정할 수 없다.
 */
import type { LocalDraft } from "./local-itineraries";
import type { TripInputFields } from "./saved-itineraries-stub";

export type DraftInput = {
  trip: TripInputFields;
  selectedActorIds: string[];
  selectedWorkIds: string[];
  selectedPlaceIds: string[];
};

export type DraftDecision =
  /** 쓰지 않는다 — 재열람 중이거나, 직전에 쓴 것과 같다 */
  | "skip"
  /** 디바운스 후 저장 */
  | "save";

/**
 * 언제 초안을 쓰는가.
 *
 * **재열람 중에는 쓰지 않는다.** 저장된 일정을 보여주는 중인데 그 상태를 초안으로 덮으면,
 * 새로고침했을 때 사용자가 만들던 조율이 아니라 남의 일정이 복구된다. 자동 재계산이
 * 재열람을 건너뛰는 것(`autoPlanDecision`)과 같은 이유다.
 *
 * 선택이 0곳이어도 쓴다 — 여행 조건만 입력하고 새로고침한 경우가 실제로 흔하고, 그때
 * 날짜·시각이 되살아나는 것만으로 값이 있다.
 */
export function draftDecision(input: { enabled: boolean; changed: boolean }): DraftDecision {
  if (!input.enabled) return "skip";
  return input.changed ? "save" : "skip";
}

/**
 * 같은 내용인지 — 불필요한 쓰기를 막는다.
 *
 * `savedAt`은 비교에서 뺀다. 그 값은 쓸 때마다 달라지므로 포함하면 항상 "바뀜"이 되어
 * 디바운스가 무의미해진다.
 */
export function draftContentEquals(a: LocalDraft | null, b: DraftInput): boolean {
  if (a === null) return false;
  return (
    a.trip.arrivalAt === b.trip.arrivalAt
    && a.trip.departureAt === b.trip.departureAt
    && a.trip.airportReadyAt === b.trip.airportReadyAt
    && a.trip.airportArrivalDeadline === b.trip.airportArrivalDeadline
    && sameIds(a.selectedActorIds, b.selectedActorIds)
    && sameIds(a.selectedWorkIds, b.selectedWorkIds)
    && sameIds(a.selectedPlaceIds, b.selectedPlaceIds)
  );
}

/** 순서는 선택 순서일 뿐 의미가 없다 — 정렬해서 비교한다 */
function sameIds(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const x = [...a].sort();
  const y = [...b].sort();
  return x.every((id, i) => id === y[i]);
}

/** 화면 상태 → 저장 형태. `savedAt`은 쓰는 시점에 붙인다 */
export function draftFromInput(input: DraftInput, now: Date): LocalDraft {
  return {
    savedAt: now.toISOString(),
    trip: input.trip,
    selectedActorIds: input.selectedActorIds,
    selectedWorkIds: input.selectedWorkIds,
    selectedPlaceIds: input.selectedPlaceIds,
  };
}
