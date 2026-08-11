/**
 * 하루 일정을 시각순 줄로 펼친다 (#146 2절)
 *
 * 지금 화면은 장소 목록과 이동 구간을 **따로** 그린다 — 장소는 `<ul>`, 열차는 접힌
 * `<details>`. 그래서 "몇 시에 어디로 이동해서 무엇을 보는가"라는 하루의 흐름이 끊긴다.
 *
 * 와이어프레임은 둘을 한 줄씩 섞어 시각순으로 세운다. 그 병합을 화면 밖에 두는 이유는
 * 시각 정렬과 동률 처리를 눈으로 확인할 수 없기 때문이다 — 이동과 방문이 같은 분에
 * 걸리면 **이동이 먼저**여야 한다. 사람은 이동한 뒤에 도착한다.
 */
import type { DayPlan, GatewayRide, ItineraryItem, TrainRide } from "./engine/types";

export type ItineraryRow =
  | { kind: "place"; at: number; item: ItineraryItem }
  | { kind: "train"; at: number; ride: TrainRide }
  | { kind: "gateway"; at: number; leg: GatewayRide };

/** 같은 시각이면 이동을 앞에 둔다 — 이동한 뒤에 도착한다 */
const KIND_ORDER: Record<ItineraryRow["kind"], number> = {
  gateway: 0,
  train: 0,
  place: 1,
};

/**
 * 하루의 줄을 시각순으로 만든다.
 *
 * 정렬은 **결정적**이어야 한다. 같은 시각·같은 종류가 겹치면 열차번호·장소 ID 사전순으로
 * 고정한다. 그러지 않으면 같은 일정이 실행마다 다르게 보인다.
 */
export function itineraryRowsOf(day: DayPlan): ItineraryRow[] {
  const rows: ItineraryRow[] = [
    ...day.items.map((item): ItineraryRow => ({
      kind: "place", at: Date.parse(item.arriveAt), item,
    })),
    ...day.rides.map((ride): ItineraryRow => ({
      kind: "train", at: Date.parse(ride.departAt), ride,
    })),
    ...(day.gatewayLegs ?? []).map((leg): ItineraryRow => ({
      kind: "gateway", at: Date.parse(leg.departAt), leg,
    })),
  ];
  return rows.sort((a, b) =>
    a.at - b.at
    || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
    || rowKey(a).localeCompare(rowKey(b), "en"));
}

/** 안정 정렬용 키 겸 React key — 한 날짜 안에서 고유하다 */
export function rowKey(row: ItineraryRow): string {
  if (row.kind === "place") return `place:${row.item.placeId}`;
  if (row.kind === "train") return `train:${row.ride.trainNo}:${row.ride.departAt}`;
  return `gateway:${row.leg.id}`;
}

/**
 * 그 날 거치는 역 — 역 시설 표시의 단일 기준 (PR #155 리뷰 1)
 *
 * **열차만 보면 안 된다.** 공항버스로만 진입하는 날에는 도착 관문역이 빠지고,
 * 자정 분할로 열차 탑승 없이 권역 체류 창만 이어지는 날에는 그 역이 통째로 사라진다.
 * 셋을 모두 합쳐야 "이 날 내가 있게 되는 역"이 된다.
 *
 * DAY 헤더와 실행 지원 패널이 **같은 함수를 본다.** 따로 계산하면 한쪽만 고쳐져
 * 같은 날에 대해 두 화면이 다른 역을 말하게 된다.
 */
export function stationIdsOf(day: DayPlan): string[] {
  const ids = new Set<string>();
  for (const ride of day.rides) {
    ids.add(ride.fromStationId);
    ids.add(ride.toStationId);
  }
  for (const leg of day.gatewayLegs ?? []) {
    ids.add(leg.fromStationId);
    ids.add(leg.toStationId);
  }
  for (const window of day.regionWindows) {
    ids.add(window.stationId);
  }
  return [...ids].sort((a, b) => a.localeCompare(b, "en"));
}

/** 일정 전체에서 거치는 역 — 실행 지원 패널용, 날짜별 기준을 그대로 합친다 */
export function allStationIdsOf(days: DayPlan[]): string[] {
  const ids = new Set(days.flatMap(stationIdsOf));
  return [...ids].sort((a, b) => a.localeCompare(b, "en"));
}
