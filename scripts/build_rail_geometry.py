#!/usr/bin/env python3
"""data/rail-geometry.json 생성 파이프라인 (오프라인 — 런타임 실호출 아님, API_SPEC 2.2)

역할: 실제 철도 선형을 v0.6 지도 좌표계로 투영해 스냅샷으로 굽는다.

배경: 4단계 동선은 역과 역을 곡선으로 이어 왔다. 지역 관계는 보이지만 실제 선로가
어디로 휘는지는 보여주지 못한다. 강릉선이 대관령을 어떻게 넘는지, 경부선이 어디서
꺾이는지가 그 자체로 근거가 된다(팀 결정: #14 §6이 막은 것은 우리가 서비스하지 않는
버스·택시·도보 경로이며, 철도는 실제 선형으로 그린다).

**선형을 지어내지 않는다.** OpenStreetMap의 실제 철도 노선 관계에서 받아온 좌표만 쓴다.

출처: OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright)
  Overpass API로 route=train 관계의 way 지오메트리를 받아 잇는다.

투영: lib/korea-map-projection.ts 와 같은 상수를 쓴다. 어긋나면 선로와 역 점이 따로 논다.

실행:
    python3 scripts/build_rail_geometry.py --dry-run
    python3 scripts/build_rail_geometry.py
"""
from __future__ import annotations

import argparse
import datetime
import json
import math
import shutil
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_PATH = REPO_ROOT / "data" / "rail-geometry.json"
STATION_COORDS_PATH = REPO_ROOT / "data" / "station-coordinates.json"

OVERPASS_MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.osm.jp/api/interpreter",
]
USER_AGENT = "scenaro-hackathon/1.0 (rail geometry snapshot; contact via repo)"

# lib/korea-map-projection.ts 와 동일 (시안 기준점 3개 최소제곱 해)
SCALE = 1983.2751905175248
TRANSLATE_X = -4234.162150478736
TRANSLATE_Y = 1675.0702691478289

# 우리 스냅샷의 구간은 모두 아래 세 축 안에 있다. 전라선은 열차 스냅샷 범위 밖이라 뺀다.
#
# 축마다 받는 방식이 다르다:
#   relation — OSM에 완결된 route 관계가 있는 축. 관계의 way를 순서대로 이으면 끝난다.
#   graph    — 관계가 불완전한 축(강릉선은 이름만 "서울 → 강릉"이고 지오메트리가 양평까지다).
#              회랑의 railway=rail 전체를 받아 선로 그래프를 만들고 역 사이를 최단경로로 잇는다.
#   spliced  — 한 관계로는 안 되는 축. 관계 여러 개를 역 기준으로 잘라 이어 붙인다.
AXES = [
    {
        "id": "gangneung",
        "name": {"ko": "강릉선 축", "en": "Gangneung axis"},
        "mode": "graph",
        # 서울역부터 강릉역까지. usage=main으로 좁히면 역 구내·분기 연결선이 빠져 그래프가 끊긴다.
        "bbox": (37.20, 126.90, 37.95, 129.05),
        "endpoints": ("station-seoul", "station-gangneung"),
        "via": ["station-manjong", "station-jinbu"],
    },
    {
        "id": "gyeongbu",
        "name": {"ko": "경부선 축", "en": "Gyeongbu axis"},
        "mode": "relation",
        "relationId": 11214334,
        "endpoints": ("station-seoul", "station-busan"),
        "via": [],
    },
    {
        "id": "arex",
        "name": {"ko": "공항철도 축", "en": "Airport Railroad axis"},
        "mode": "relation",
        "relationId": 9961459,
        "endpoints": ("station-seoul", "station-incheon-airport-t1"),
        "via": [],
    },
    {
        "id": "jeolla",
        "name": {"ko": "전라선 축", "en": "Jeolla axis"},
        "mode": "spliced",
        # OSM에 서울역에서 출발하는 전라선 관계가 없다(전라선 KTX 관계는 모두 용산 시작).
        # 실제 열차가 지나는 선로 그대로 두 관계를 잘라 붙인다:
        #   서울-용산  경부선 KTX 관계에서 (용산은 그 관계 42번째 점, 역과 118m)
        #   용산-전주  전라선 KTX 관계 그대로 (용산 시작, 전주 끝)
        # 선형을 지어내지 않는다는 규율은 그대로다 — 두 조각 모두 OSM way 지오메트리다.
        "parts": [
            {"relationId": 11214334, "from": "station-seoul", "to": "station-yongsan"},
            {"relationId": 11314593, "from": "station-yongsan", "to": "station-jeonju"},
        ],
        "endpoints": ("station-seoul", "station-jeonju"),
        "via": ["station-yongsan"],
    },
]

# 역이 이 노선 위에 있다고 볼 최대 거리(m). 선로 정점과 역 좌표는 정확히 겹치지 않는다.
STATION_SNAP_METERS = 2500
# 투영 좌표계에서의 단순화 허용오차. 1 단위가 약 1.4km이고 화면에서 약 2px이므로
# 0.2는 약 280m — 눈에 보이는 굴곡은 남기고 점 수만 줄인다.
SIMPLIFY_TOLERANCE = 0.2


def project(latitude: float, longitude: float) -> tuple[float, float]:
    x = SCALE * math.radians(longitude) + TRANSLATE_X
    y = TRANSLATE_Y - SCALE * math.log(math.tan(math.pi / 4 + math.radians(latitude) / 2))
    return x, y


def haversine_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    """(lat, lon) 두 점 사이 거리(m)"""
    lat1, lon1 = math.radians(a[0]), math.radians(a[1])
    lat2, lon2 = math.radians(b[0]), math.radians(b[1])
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 2 * 6_371_000 * math.asin(math.sqrt(h))


CACHE_DIR = REPO_ROOT / "data" / "raw"


def overpass(query: str, attempts: int = 3, cache_key: str | None = None) -> dict:
    """Overpass 호출. cache_key를 주면 원천 응답을 data/raw에 두고 재실행 시 재사용한다.

    공개 인스턴스에 같은 대용량 질의를 반복해 던지지 않기 위해서다. 캐시 파일은
    커밋하지 않는다(.gitignore). 새로 받으려면 해당 파일을 지우면 된다.
    """
    if cache_key:
        cached = CACHE_DIR / f"osm-{cache_key}.json"
        if cached.exists():
            print(f"    캐시 사용: {cached.relative_to(REPO_ROOT)}")
            return json.loads(cached.read_text(encoding="utf-8"))

    last: str | None = None
    for attempt in range(attempts):
        for base in OVERPASS_MIRRORS:
            request = urllib.request.Request(
                base,
                data=urllib.parse.urlencode({"data": query}).encode(),
                headers={"User-Agent": USER_AGENT},
            )
            try:
                with urllib.request.urlopen(request, timeout=300) as response:
                    payload = json.loads(response.read().decode("utf-8"))
                if cache_key:
                    CACHE_DIR.mkdir(parents=True, exist_ok=True)
                    (CACHE_DIR / f"osm-{cache_key}.json").write_text(
                        json.dumps(payload), encoding="utf-8"
                    )
                return payload
            except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as error:
                last = f"{base.split('/')[2]}: {error}"
                print(f"    미러 실패 — {last}")
        time.sleep(5 * (attempt + 1))
    raise SystemExit(f"Overpass 모든 미러 실패: {last}")


def stitch(members: list[dict]) -> list[tuple[float, float]]:
    """관계의 way 조각을 끝점끼리 이어 하나의 선으로 만든다.

    OSM 관계의 way는 순서가 대체로 맞지만 방향이 뒤집힌 조각이 섞인다. 앞 조각의 끝점과
    가까운 쪽 끝을 골라 붙인다. 끊긴 구간이 있으면 그대로 이어 붙이되 몇 번 끊겼는지 알린다.
    """
    chains = [
        [(p["lat"], p["lon"]) for p in member.get("geometry") or []]
        for member in members
        if member["type"] == "way" and member.get("geometry")
    ]
    if not chains:
        raise SystemExit("way 지오메트리가 없다")

    line = list(chains[0])
    gaps = 0
    for chain in chains[1:]:
        end = line[-1]
        # 이 조각을 정방향/역방향 중 끝점에 더 가까운 쪽으로 붙인다
        if haversine_m(end, chain[-1]) < haversine_m(end, chain[0]):
            chain = list(reversed(chain))
        if haversine_m(end, chain[0]) > 200:
            gaps += 1
        line.extend(chain[1:] if haversine_m(end, chain[0]) < 1 else chain)
    if gaps:
        print(f"    이어붙일 때 끊긴 지점 {gaps}곳 (터널·분기 표현 차이일 수 있다)")
    return line


def simplify(points: list[tuple[float, float]], tolerance: float) -> list[tuple[float, float]]:
    """Douglas-Peucker. 투영 좌표계에서 수행한다 — 화면에서 보이는 오차가 기준이다."""
    if len(points) < 3:
        return list(points)

    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        start, end = stack.pop()
        ax, ay = points[start]
        bx, by = points[end]
        dx, dy = bx - ax, by - ay
        norm = math.hypot(dx, dy)
        worst, worst_index = -1.0, -1
        for i in range(start + 1, end):
            px, py = points[i]
            if norm == 0:
                distance = math.hypot(px - ax, py - ay)
            else:
                distance = abs(dx * (ay - py) - (ax - px) * dy) / norm
            if distance > worst:
                worst, worst_index = distance, i
        if worst > tolerance and worst_index > 0:
            keep[worst_index] = True
            stack.append((start, worst_index))
            stack.append((worst_index, end))
    return [p for p, k in zip(points, keep) if k]


def build_graph(ways: list[dict]) -> dict:
    """선로 그래프. 좌표를 그대로 노드 id로 쓴다 — OSM way는 공유 노드에서 좌표가 정확히 같다."""
    adjacency: dict[tuple[float, float], list[tuple[tuple[float, float], float]]] = {}
    for way in ways:
        geometry = way.get("geometry") or []
        for a, b in zip(geometry, geometry[1:]):
            ka = (round(a["lat"], 6), round(a["lon"], 6))
            kb = (round(b["lat"], 6), round(b["lon"], 6))
            if ka == kb:
                continue
            distance = haversine_m(ka, kb)
            adjacency.setdefault(ka, []).append((kb, distance))
            adjacency.setdefault(kb, []).append((ka, distance))
    return adjacency


def largest_component(adjacency: dict) -> set:
    """가장 큰 연결 성분.

    역 좌표에서 그냥 최근접 노드를 잡으면 안 된다. 큰 역 주변에는 본선과 이어지지 않은
    측선·승강장 조각이 있어서, 서울역이 308노드짜리 고립 조각에 붙는 일이 실제로 생겼다.
    경로 탐색은 반드시 최대 성분 안에서 한다.
    """
    seen: set = set()
    best: set = set()
    for start_node in adjacency:
        if start_node in seen:
            continue
        component = {start_node}
        queue = [start_node]
        seen.add(start_node)
        while queue:
            node = queue.pop()
            for neighbour, _ in adjacency[node]:
                if neighbour not in seen:
                    seen.add(neighbour)
                    component.add(neighbour)
                    queue.append(neighbour)
        if len(component) > len(best):
            best = component
    return best


def shortest_path(adjacency: dict, source, target) -> list:
    import heapq

    distances = {source: 0.0}
    previous: dict = {}
    queue = [(0.0, source)]
    while queue:
        current, node = heapq.heappop(queue)
        if node == target:
            break
        if current > distances.get(node, math.inf):
            continue
        for neighbour, weight in adjacency[node]:
            candidate = current + weight
            if candidate < distances.get(neighbour, math.inf):
                distances[neighbour] = candidate
                previous[neighbour] = node
                heapq.heappush(queue, (candidate, neighbour))
    if target not in distances:
        raise SystemExit("선로 그래프에서 두 역을 잇는 경로를 찾지 못했다")
    path = [target]
    while path[-1] != source:
        path.append(previous[path[-1]])
    path.reverse()
    return path


def nearest_index(line: list[tuple[float, float]], target: tuple[float, float]) -> tuple[int, float]:
    """선형에서 역에 가장 가까운 점의 인덱스와 그 거리(m)"""
    best_index, best_distance = -1, math.inf
    for index, point in enumerate(line):
        distance = haversine_m(target, point)
        if distance < best_distance:
            best_index, best_distance = index, distance
    return best_index, best_distance


def relation_line(relation_id: int) -> list[tuple[float, float]]:
    print(f"    route 관계 rel/{relation_id} 사용")
    payload = overpass(
        f"[out:json][timeout:180];rel({relation_id});out geom;",
        cache_key=f"rel-{relation_id}",
    )
    return stitch(payload["elements"][0]["members"])


def axis_line(spec: dict, seed_by_id: dict) -> list[tuple[float, float]]:
    """축 하나의 (lat, lon) 선형을 얻는다."""
    if spec["mode"] == "spliced":
        line: list[tuple[float, float]] = []
        for part in spec["parts"]:
            raw = relation_line(part["relationId"])
            start, start_distance = nearest_index(raw, seed_by_id[part["from"]])
            end, end_distance = nearest_index(raw, seed_by_id[part["to"]])
            for station_id, distance in ((part["from"], start_distance), (part["to"], end_distance)):
                if distance > STATION_SNAP_METERS:
                    raise SystemExit(
                        f"{station_id}이 rel/{part['relationId']} 선형에서 {distance/1000:.1f}km 떨어져 있다"
                    )
            # 관계가 반대 방향이면 뒤집어 붙인다 — 축은 endpoints 순서로 진행해야 한다
            piece = raw[start : end + 1] if start <= end else list(reversed(raw[end : start + 1]))
            print(
                f"      {part['from']} → {part['to']}: {len(piece)}점"
                f" (관계 {start}-{end}, 스냅 {start_distance:.0f}m/{end_distance:.0f}m)"
            )
            # 이음매의 첫 점은 앞 조각의 끝점과 같은 역이다 — 한 번만 남긴다
            line.extend(piece if not line else piece[1:])
            time.sleep(3)
        return line

    if spec["mode"] == "relation":
        return relation_line(spec["relationId"])

    south, west, north, east = spec["bbox"]
    print(f"    회랑 railway=rail 전체 수신 ({south},{west},{north},{east})")
    payload = overpass(
        f'[out:json][timeout:300];way["railway"="rail"]({south},{west},{north},{east});out geom;',
        cache_key=f"rail-{spec['id']}",
    )
    adjacency = build_graph(payload["elements"])
    component = largest_component(adjacency)
    print(f"    그래프 {len(adjacency)}노드 → 최대 성분 {len(component)}노드")

    def snap(station_id: str):
        target = seed_by_id[station_id]
        return min(component, key=lambda node: haversine_m(target, node))

    a, b = spec["endpoints"]
    path = shortest_path(adjacency, snap(a), snap(b))
    length_km = sum(haversine_m(p, q) for p, q in zip(path, path[1:])) / 1000
    print(f"    {a} → {b}: {len(path)}점, 선로 {length_km:.1f} km")
    return path


def build() -> dict:
    seed = json.loads(STATION_COORDS_PATH.read_text(encoding="utf-8"))["stations"]
    seed_by_id = {s["stationId"]: (s["latitude"], s["longitude"]) for s in seed}
    lines_out = []

    for spec in AXES:
        print(f"받는 중: {spec['name']['ko']}")
        raw = axis_line(spec, seed_by_id)

        # 이 축 위에 있는 시드 역을 선 위 인덱스로 찾는다
        wanted = [spec["endpoints"][0], *spec["via"], spec["endpoints"][1]]
        on_line: list[tuple[str, int]] = []
        for station_id in wanted:
            best_index, best_distance = nearest_index(raw, seed_by_id[station_id])
            if best_distance > STATION_SNAP_METERS:
                raise SystemExit(
                    f"{station_id}이 {spec['id']} 축 선형에서 {best_distance/1000:.1f}km 떨어져 있다"
                )
            on_line.append((station_id, best_index))
        on_line.sort(key=lambda pair: pair[1])

        first, last = on_line[0][1], on_line[-1][1]
        trimmed = raw[first : last + 1]
        projected = [project(lat, lon) for lat, lon in trimmed]

        # 역 앵커를 지우지 않도록 역과 역 사이를 따로 단순화해 이어 붙인다.
        # 전체를 한 번에 줄이면 직선 구간의 점이 사라지면서 역 근처 점도 함께 없어져,
        # 앵커가 실제 역에서 수 km 떨어진다(만종 2.7km·진부 3.7km 실측). 그러면
        # 구간을 자를 때 엉뚱한 곳에서 잘린다.
        cuts = [index - first for _, index in on_line]
        reduced: list[tuple[float, float]] = []
        stations_out = []
        for order, (station_id, _) in enumerate(on_line):
            stations_out.append({"stationId": station_id, "index": len(reduced)})
            if order == len(on_line) - 1:
                reduced.append(projected[cuts[order]])
                break
            segment = simplify(projected[cuts[order] : cuts[order + 1] + 1], SIMPLIFY_TOLERANCE)
            reduced.extend(segment[:-1])  # 끝점은 다음 구간의 시작점으로 이어진다

        print(f"    {len(trimmed)}점 → 단순화 {len(reduced)}점, 역 {len(stations_out)}개\n")
        lines_out.append(
            {
                "id": spec["id"],
                "name": spec["name"],
                "mode": spec["mode"],
                "relationId": spec.get("relationId"),
                "stations": stations_out,
                "points": [[round(x, 2), round(y, 2)] for x, y in reduced],
            }
        )
        time.sleep(3)

    return {
        "source": "OpenStreetMap contributors (ODbL 1.0)",
        "sourceUrl": "https://www.openstreetmap.org/copyright",
        "fetchedAt": datetime.date.today().isoformat(),
        "projection": "lib/korea-map-projection.ts 와 동일한 상수로 미리 투영한 지도 좌표",
        "simplifyTolerance": SIMPLIFY_TOLERANCE,
        "lines": lines_out,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="파일을 쓰지 않고 요약만 출력")
    args = parser.parse_args()

    snapshot = build()
    total = sum(len(line["points"]) for line in snapshot["lines"])
    print(f"노선 {len(snapshot['lines'])}개, 좌표 총 {total}개")
    if args.dry_run:
        return
    if OUTPUT_PATH.exists():
        shutil.copyfile(OUTPUT_PATH, OUTPUT_PATH.with_suffix(".json.bak"))
    OUTPUT_PATH.write_text(
        json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"기록: {OUTPUT_PATH.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
