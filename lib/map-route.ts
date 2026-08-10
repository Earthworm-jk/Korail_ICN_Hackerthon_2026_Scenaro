/**
 * 일정 → 지도 동선 순서 (#14 v0.6 4단계 "전체 이동 동선")
 *
 * 엔진이 내린 rides를 그대로 이어 붙인 역 순서다. 지도는 이 순서로만 선을 긋는다 —
 * 정렬·최적화·경유지 추가를 하지 않는다. 화면의 동선이 일정과 어긋나면 사용자는 둘 중
 * 어느 쪽이 맞는지 알 수 없게 되므로, 여기서 새로운 판단을 만들지 않는 것이 계약이다.
 *
 * 선의 성격은 구간마다 다르다:
 *   철도 구간 — 실제 선로 선형을 그린다. data/rail-geometry.json(OSM)에 그 OD가 있으면
 *               두 역 앵커 사이를 잘라 실좌표 폴리라인으로 잇는다.
 *   그 밖의 구간 — 권역이 이어지는 순서를 보여주는 보조 곡선이다 (#14 §6). 우리가 서비스하지
 *               않는 도로 수단(공항버스 등)을 실제 경로처럼 보이게 하지 않는다.
 *
 * 선형 데이터가 없다고 선이 사라지면 안 된다 — 축을 못 찾은 구간은 기존 곡선으로 폴백한다.
 */
import type { MapPosition } from "./korea-map-projection";

export type RouteRide = {
  fromStationId: string;
  toStationId: string;
};

/** data/rail-geometry.json의 축 하나 — 렌더가 실제로 읽는 부분만 (lib/rail-geometry.ts가 원형) */
export type RailLineGeometry = {
  id: string;
  points: readonly (readonly [number, number])[];
  stations: readonly { stationId: string; index: number }[];
};

/**
 * 동선을 그리는 조각 하나.
 *   rail  — 실제 선로 선형. points는 이미 투영된 지도 좌표라 그대로 잇는다.
 *   curve — 폴백. 역 좌표를 catmullRomPath로 잇는 기존 보조 곡선이다.
 */
export type RouteSegment =
  | { kind: "rail"; lineId: string; points: readonly MapPosition[] }
  | { kind: "curve"; stationIds: readonly string[] };

/**
 * 구간 키 — 방향을 구분하지 않는다. 인천공항↔강릉 공항버스는 어느 방향이든 도로 수단이다.
 * 구분자는 `|`다. 역 ID는 kebab-case라 충돌하지 않는다 (NUL 바이트 사고 재발 방지 — PR #91).
 */
export function routePairKey(fromStationId: string, toStationId: string): string {
  return [fromStationId, toStationId].sort().join("|");
}

/** 두 역을 모두 담은 첫 축에서 구간을 잘라 온다. 없으면 undefined — 호출부가 폴백한다 */
function sliceRail(
  lines: readonly RailLineGeometry[],
  fromStationId: string,
  toStationId: string,
): { lineId: string; points: MapPosition[] } | undefined {
  for (const line of lines) {
    const from = line.stations.find((anchor) => anchor.stationId === fromStationId)?.index;
    const to = line.stations.find((anchor) => anchor.stationId === toStationId)?.index;
    if (from === undefined || to === undefined || from === to) continue;
    const [low, high] = from < to ? [from, to] : [to, from];
    const points = line.points.slice(low, high + 1).map(([x, y]) => ({ x, y }));
    if (points.length < 2) continue;
    // 일정이 가는 방향으로 그린다 — 화살표·애니메이션을 붙일 때 방향이 뒤집히지 않도록
    return { lineId: line.id, points: from < to ? points : points.reverse() };
  }
  return undefined;
}

/**
 * 역 순서 → 그릴 조각들. 실선형이 있는 구간만 rail로 떼어내고 나머지는 곡선 run으로 묶는다.
 *
 * run으로 묶는 이유: 폴백 곡선은 이어진 여러 역을 한 번에 지나야 지금과 같은 모양이 된다.
 * 축이 하나도 안 걸리면 결과는 시퀀스 전체를 담은 곡선 하나 — 지금 화면과 정확히 같다.
 *
 * `roadPairKeys`에 든 구간은 축에 있어도 rail로 그리지 않는다. 공항버스처럼 우리가 도로로
 * 실어 나르는 구간을 선로 위에 얹으면 화면이 일정과 다른 말을 하게 된다.
 */
export function railRouteSegments(
  stationIds: readonly string[],
  lines: readonly RailLineGeometry[],
  roadPairKeys: ReadonlySet<string> = new Set(),
): RouteSegment[] {
  if (stationIds.length < 2) {
    return stationIds.length === 0 ? [] : [{ kind: "curve", stationIds: [...stationIds] }];
  }

  const segments: RouteSegment[] = [];
  let runStart = 0;
  const flushCurve = (endExclusive: number) => {
    if (endExclusive - runStart >= 2) {
      segments.push({ kind: "curve", stationIds: stationIds.slice(runStart, endExclusive) });
    }
  };

  for (let index = 0; index + 1 < stationIds.length; index += 1) {
    const from = stationIds[index];
    const to = stationIds[index + 1];
    const rail = roadPairKeys.has(routePairKey(from, to)) ? undefined : sliceRail(lines, from, to);
    if (!rail) continue; // 폴백 — 지금까지의 run에 계속 쌓는다
    flushCurve(index + 1);
    segments.push({ kind: "rail", lineId: rail.lineId, points: rail.points });
    runStart = index + 1;
  }
  flushCurve(stationIds.length);

  return segments;
}

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

/**
 * 경로 path의 React key — 인덱스가 아니라 **내용**으로 잡는다 (#118 P0-2).
 *
 * 경로 재생성 애니메이션은 React가 어떤 path를 다시 마운트하는지에 그대로 얹힌다. 인덱스를
 * key로 쓰면 구간이 하나 늘거나 줄 때 뒤의 모든 구간이 새 것으로 취급돼 화면 전체가 다시
 * 그려진다. 사용자가 봐야 하는 것은 "무엇이 달라졌나"이므로, 그대로인 구간은 가만히 있고
 * 바뀐 구간만 다시 그려져야 한다.
 *
 * 같은 모양이 두 번 나오는 경우(왕복 등)에만 순번을 붙여 key 충돌을 피한다.
 */
export function routePathKeys(paths: readonly { kind: string; d: string }[]): string[] {
  const seen = new Map<string, number>();
  return paths.map(({ kind, d }) => {
    const base = `${kind}:${d}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}#${count}`;
  });
}
