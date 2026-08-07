# -*- coding: utf-8 -*-
"""후보 배우별 강원 촬영지 집계 (이슈 #1 비교표 생성 스크립트).

2패스 구조:
  1) 증거 패스  — 장소설명의 "배역(배우)" 괄호 패턴으로 배우-작품 쌍과 증거 행 수를 추출
  2) 확장 패스  — 증거가 임계값 이상인 작품들의 **전체** 촬영지를 집계

출력 성격: 오탐(예: 문서 언급 인물)과 누락(설명에 이름이 없는 출연작)이 모두 가능한
**수동 검증 전 노이즈 포함 후보치**다. 후보 간 상대 비교와 수동 검증 대상 선정에만 사용하고,
최종 시드(작품 4편·촬영지 14곳)는 원문을 수동 검증한 값을 쓴다(이슈 #1 확정안 참조).

사용법: python3 scripts/actor_aggregation.py [배우명 ...]
  인자 없음  → 강원 후보 상위 15명 (증거 행 수와 작품 확장 집계를 분리해 표시)
  배우명 인자 → 해당 배우의 작품별 증거 행 수·전체/강원 촬영지 상세
"""
import csv
import re
import sys
from collections import defaultdict
from pathlib import Path

CSV_PATH = Path(__file__).resolve().parent.parent / "data" / "raw" / "filming_locations_20260807.csv"
PAREN = re.compile(r"\(([가-힣]{2,4})\)")

# 배우-작품 쌍을 인정하는 최소 증거 행 수.
# 1이면 단일 언급도 후보로 올린다(누락 최소화). 오탐 통제는 수동 검증 단계에서 한다.
MIN_EVIDENCE_ROWS = 1


def load_rows():
    with open(CSV_PATH, encoding="utf-8") as f:
        return list(csv.DictReader(f))


def build_evidence(rows):
    """패스 1: (배우, 작품) → 증거 행 수."""
    evidence = defaultdict(int)
    for r in rows:
        for actor in set(PAREN.findall(r.get("장소설명") or "")):
            evidence[(actor, r["제목"])] += 1
    return evidence


def gangwon_of(row):
    addr = (row.get("주소") or "").strip()
    if not addr.startswith("강원"):
        return None
    parts = addr.split()
    return parts[1] if len(parts) > 1 else "(시군 미상)"


def build_expanded(rows, evidence):
    """패스 2: 배우별로 증거 임계값을 넘은 작품들의 전체 촬영지를 집계."""
    by_work = defaultdict(list)
    for r in rows:
        by_work[r["제목"]].append(r)

    actors = defaultdict(lambda: {
        "works": set(),          # 증거 임계값을 넘은 작품
        "evidence_rows": 0,       # 배우명이 실제 등장한 행 수 (증거)
        "work_places": 0,         # 위 작품들의 전체 촬영지 수 (확장)
        "gw_places": 0,           # 위 작품들의 강원 촬영지 수 (확장)
        "gw_sigungu": set(),
        "gw_works": set(),
    })
    for (actor, work), n in evidence.items():
        if n < MIN_EVIDENCE_ROWS:
            continue
        s = actors[actor]
        s["works"].add(work)
        s["evidence_rows"] += n
    for actor, s in actors.items():
        for work in s["works"]:
            wrows = by_work[work]
            s["work_places"] += len(wrows)
            for r in wrows:
                sg = gangwon_of(r)
                if sg:
                    s["gw_places"] += 1
                    s["gw_sigungu"].add(sg)
                    s["gw_works"].add(work)
    return actors


def print_candidates(actors):
    cands = [
        (a, s) for a, s in actors.items()
        if len(s["gw_sigungu"]) >= 2 and len(s["gw_works"]) >= 2
    ]
    cands.sort(key=lambda x: (-len(x[1]["gw_sigungu"]), -x[1]["gw_places"]))
    print(f"(증거 임계값 MIN_EVIDENCE_ROWS = {MIN_EVIDENCE_ROWS}, 확장 집계는 작품 전체 기준)")
    print(f"{'추출명':<8}|증거행|작품|강원작품|강원지(확장)|시군| 시군 목록")
    for a, s in cands[:15]:
        print(
            f"{a:<8}|{s['evidence_rows']:>4} |{len(s['works']):>3} |{len(s['gw_works']):>5} "
            f"|{s['gw_places']:>7} |{len(s['gw_sigungu']):>3} | {', '.join(sorted(s['gw_sigungu']))}"
        )


def print_actor_detail(rows, evidence, actors, name):
    s = actors.get(name)
    if not s:
        print(f"{name}: 추출 결과 없음")
        return
    print(f"## {name} — 연결 작품 {len(s['works'])}편(증거 {s['evidence_rows']}행), "
          f"작품 전체 촬영지 {s['work_places']}곳, 강원 {s['gw_places']}곳, 시군 {sorted(s['gw_sigungu'])}")
    for work in sorted(s["works"]):
        wrows = [r for r in rows if r["제목"] == work]
        gw = [r for r in wrows if gangwon_of(r)]
        ev = evidence[(name, work)]
        print(f"### {work} — 증거 {ev}행 / 전체 {len(wrows)}곳 / 강원 {len(gw)}곳"
              + ("  [증거 1행 — 오탐 가능, 수동 확인 필요]" if ev == 1 else ""))
        for r in wrows:
            addr = (r.get("주소") or "").strip()
            region = " ".join(addr.split()[:2]) if addr else "주소없음"
            print(f"  - {r['장소명']} | {r['장소타입']} | {region}")


if __name__ == "__main__":
    rows = load_rows()
    evidence = build_evidence(rows)
    actors = build_expanded(rows, evidence)
    if len(sys.argv) > 1:
        for name in sys.argv[1:]:
            print_actor_detail(rows, evidence, actors, name)
    else:
        print_candidates(actors)
