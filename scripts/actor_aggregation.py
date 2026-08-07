# -*- coding: utf-8 -*-
"""후보 배우별 강원 촬영지 집계 (이슈 #1 비교표 생성 스크립트).

입력: data/raw/filming_locations_20260807.csv (UTF-8)
배우 추출: 장소설명의 "배역(배우)" 괄호 패턴. 정규화 전 하한치이므로
후보 간 상대 비교용으로만 사용한다(이슈 #1 주의사항 참조).

사용법: python3 scripts/actor_aggregation.py [배우명 ...]
  인자 없이 실행하면 강원 시군 2곳 이상 후보 상위 15명을 출력,
  배우명을 주면 해당 배우의 작품·강원 상세를 출력.
"""
import csv
import re
import sys
from pathlib import Path

CSV_PATH = Path(__file__).resolve().parent.parent / "data" / "raw" / "filming_locations_20260807.csv"
PAREN = re.compile(r"\(([가-힣]{2,4})\)")


def load_rows():
    with open(CSV_PATH, encoding="utf-8") as f:
        return list(csv.DictReader(f))


def build_stats(rows):
    stats = {}
    for r in rows:
        desc = r.get("장소설명") or ""
        addr = (r.get("주소") or "").strip()
        parts = addr.split()
        is_gw = addr.startswith("강원")
        sigungu = parts[1] if is_gw and len(parts) > 1 else None
        for actor in set(PAREN.findall(desc)):
            s = stats.setdefault(
                actor,
                {"works": set(), "places": 0, "gw_places": 0, "gw_sigungu": set(), "gw_works": set()},
            )
            s["works"].add(r["제목"])
            s["places"] += 1
            if is_gw:
                s["gw_places"] += 1
                s["gw_sigungu"].add(sigungu)
                s["gw_works"].add(r["제목"])
    return stats


def print_candidates(stats):
    cands = [
        (a, s)
        for a, s in stats.items()
        if len(s["gw_sigungu"]) >= 2 and s["gw_places"] >= 5 and len(s["gw_works"]) >= 2
    ]
    cands.sort(key=lambda x: (-len(x[1]["gw_sigungu"]), -x[1]["gw_places"]))
    print(f"{'추출명':<8}|작품|강원작품|강원지|시군| 시군 목록")
    for a, s in cands[:15]:
        print(
            f"{a:<8}|{len(s['works']):>3} |{len(s['gw_works']):>5} |{s['gw_places']:>4} "
            f"|{len(s['gw_sigungu']):>3} | {', '.join(sorted(s['gw_sigungu']))}"
        )


def print_actor_detail(stats, rows, name):
    s = stats.get(name)
    if not s:
        print(f"{name}: 추출 결과 없음")
        return
    print(f"## {name} — 작품 {len(s['works'])}편, 강원 촬영지 {s['gw_places']}곳, 시군 {sorted(s['gw_sigungu'])}")
    for work in sorted(s["works"]):
        wrows = [r for r in rows if r["제목"] == work]
        gw = [r for r in wrows if (r.get("주소") or "").startswith("강원")]
        print(f"### {work} — 전체 {len(wrows)}곳 / 강원 {len(gw)}곳")
        for r in wrows:
            addr = (r.get("주소") or "").strip()
            region = " ".join(addr.split()[:2]) if addr else "주소없음"
            print(f"  - {r['장소명']} | {r['장소타입']} | {region}")


if __name__ == "__main__":
    rows = load_rows()
    stats = build_stats(rows)
    if len(sys.argv) > 1:
        for name in sys.argv[1:]:
            print_actor_detail(stats, rows, name)
    else:
        print_candidates(stats)
