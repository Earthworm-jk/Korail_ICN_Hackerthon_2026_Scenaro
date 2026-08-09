/**
 * 일정 → 지도 동선 순서 (#14 v0.6 4단계 "전체 이동 동선")
 *
 * 엔진이 내린 rides를 그대로 이어 붙인 역 순서다. 지도는 이 순서로만 선을 긋는다 —
 * 정렬·최적화·경유지 추가를 하지 않는다. 화면의 동선이 일정과 어긋나면 사용자는 둘 중
 * 어느 쪽이 맞는지 알 수 없게 되므로, 여기서 새로운 판단을 만들지 않는 것이 계약이다.
 *
 * 이 선은 실제 도로·철도 선형이 아니라 권역이 이어지는 순서를 보여주는 보조 시각화다
 * (#14 §6). 그래서 역 지점만 잇고 중간 경유지를 만들지 않는다.
 */

export type RouteRide = {
  fromStationId: string;
  toStationId: string;
};

/**
 * rides를 역 시퀀스로 편다. 연속 중복만 접는다 —
 * 왕복(A→B→A)의 되돌아오는 구간은 접지 않고 남겨 시안처럼 겹쳐 그린다.
 */
export function routeStationSequence(rides: readonly RouteRide[]): string[] {
  const sequence: string[] = [];
  const push = (stationId: string) => {
    if (sequence[sequence.length - 1] !== stationId) sequence.push(stationId);
  };
  for (const ride of rides) {
    push(ride.fromStationId);
    push(ride.toStationId);
  }
  return sequence;
}
