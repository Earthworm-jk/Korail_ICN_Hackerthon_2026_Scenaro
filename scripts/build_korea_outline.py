#!/usr/bin/env python3
"""lib/korea-outline.ts 생성 파이프라인 (오프라인 — 런타임 실호출 아님)

역할: 대한민국 해안선을 v0.6 지도 좌표계로 투영해 SVG path 상수로 굽는다.

배경: 시안의 정적 SVG에 들어 있던 경계는 꼭짓점 19개짜리 단순화 폴리곤이라 확대하면
각져 보인다. 좌표계와 투영은 그대로 두고 해안선 해상도만 올린다 — 기존에 찍히던
역·촬영지 점의 위치는 1px도 바뀌지 않는다.

출처: Natural Earth 1:50m Admin 0 Countries (public domain)
  https://github.com/nvkelso/natural-earth-vector
  시안의 출처 문구("대한민국 경계: Natural Earth")와 같은 원천을 유지한다.

투영: lib/korea-map-projection.ts 의 상수와 반드시 같은 값을 쓴다. 어긋나면 경계와
점이 서로 어긋나므로 아래 상수를 고칠 일이 생기면 양쪽을 함께 고쳐야 한다.

실행:
    python3 scripts/build_korea_outline.py            # 필요하면 원천을 내려받는다
    python3 scripts/build_korea_outline.py --dry-run  # 요약만
"""
from __future__ import annotations

import argparse
import json
import math
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_PATH = REPO_ROOT / "lib" / "korea-outline.ts"
CACHE_PATH = REPO_ROOT / "data" / "raw" / "ne_50m_admin_0_countries.geojson"
SOURCE_URL = (
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/"
    "geojson/ne_50m_admin_0_countries.geojson"
)

# lib/korea-map-projection.ts 와 동일 (시안 기준점 3개 최소제곱 해)
SCALE = 1983.2751905175248
TRANSLATE_X = -4234.162150478736
TRANSLATE_Y = 1675.0702691478289

# 표시 영역(VIEW_BOX "80 215 220 205")에서 눈에 잡히지 않는 섬은 점 노이즈가 된다
MIN_RING_AREA = 1.5  # viewBox 제곱 단위


def project(latitude: float, longitude: float) -> tuple[float, float]:
    x = SCALE * math.radians(longitude) + TRANSLATE_X
    y = TRANSLATE_Y - SCALE * math.log(math.tan(math.pi / 4 + math.radians(latitude) / 2))
    return x, y


def ring_area(points: list[tuple[float, float]]) -> float:
    total = 0.0
    for i in range(len(points)):
        x1, y1 = points[i]
        x2, y2 = points[(i + 1) % len(points)]
        total += x1 * y2 - x2 * y1
    return abs(total) / 2


def load_source() -> dict:
    if not CACHE_PATH.exists():
        CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        print(f"원천을 내려받는다: {SOURCE_URL}")
        urllib.request.urlretrieve(SOURCE_URL, CACHE_PATH)
    return json.loads(CACHE_PATH.read_text(encoding="utf-8"))


def rings_for(geojson: dict, iso: str) -> list[list[tuple[float, float]]]:
    for feature in geojson["features"]:
        properties = feature["properties"]
        if properties.get("ISO_A3") != iso and properties.get("ADM0_A3") != iso:
            continue
        geometry = feature["geometry"]
        polygons = (
            [geometry["coordinates"]]
            if geometry["type"] == "Polygon"
            else geometry["coordinates"]
        )
        rings = []
        for polygon in polygons:
            for ring in polygon:
                rings.append([project(lat, lon) for lon, lat in ring])
        return rings
    raise SystemExit(f"원천에서 {iso}를 찾지 못했다")


def to_path(rings: list[list[tuple[float, float]]]) -> str:
    parts = []
    for ring in rings:
        points = [f"{x:.2f},{y:.2f}" for x, y in ring]
        parts.append("M" + "L".join(points) + "Z")
    return "".join(parts)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="파일을 쓰지 않고 요약만 출력")
    args = parser.parse_args()

    rings = rings_for(load_source(), "KOR")
    kept = [ring for ring in rings if ring_area(ring) >= MIN_RING_AREA]
    dropped = len(rings) - len(kept)
    kept.sort(key=ring_area, reverse=True)

    path = to_path(kept)
    points = sum(len(ring) for ring in kept)
    print(f"고리 {len(rings)}개 중 {len(kept)}개 수록 (작은 섬 {dropped}개 제외), 꼭짓점 {points}개")
    print(f"path 길이 {len(path)}자")
    if args.dry_run:
        return

    OUTPUT_PATH.write_text(
        "/**\n"
        " * 대한민국 해안선 — scripts/build_korea_outline.py 생성물. 직접 수정하지 않는다.\n"
        " *\n"
        " * 출처: Natural Earth 1:50m Admin 0 Countries (public domain)\n"
        " * 투영: lib/korea-map-projection.ts 와 같은 상수로 미리 굽는다 —\n"
        " *       런타임 투영 비용도, 좌표계 불일치도 없다.\n"
        " *\n"
        f" * 꼭짓점 {points}개 / 고리 {len(kept)}개 (표시 영역에서 보이지 않는 작은 섬 {dropped}개 제외)\n"
        " */\n"
        f'export const KOREA_OUTLINE_PATH =\n  "{path}";\n',
        encoding="utf-8",
    )
    print(f"기록: {OUTPUT_PATH.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
