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
 * 그 날 환승 수 — 앞 구간과 열차번호가 다르면 갈아탄 것이다.
 *
 * DAY 헤더의 환승 배지에 쓴다. 공항 진입 구간(gateway)은 열차가 아니라 별도 수단이므로
 * 환승 계산에 넣지 않는다 — 엔진의 `transferCount`와 같은 기준이다.
 */
export function transferCountOf(day: DayPlan): number {
  let count = 0;
  for (let index = 1; index < day.rides.length; index += 1) {
    if (day.rides[index - 1].trainNo !== day.rides[index].trainNo) count += 1;
  }
  return count;
}

/** 그 날 거치는 역 — DAY 헤더의 역 시설 팝오버 대상 */
export function stationIdsOf(day: DayPlan): string[] {
  const ids = new Set<string>();
  for (const ride of day.rides) {
    ids.add(ride.fromStationId);
    ids.add(ride.toStationId);
  }
  return [...ids].sort((a, b) => a.localeCompare(b, "en"));
}
