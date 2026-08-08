#!/usr/bin/env python3
"""station-facilities.json 생성·갱신 파이프라인 (오프라인 — 런타임 실호출 아님, API_SPEC 2.2)

역할: 개발 중 한시적으로 한국철도공사 편의시설정보 API를 호출해 시드 역의 시설 정보를
`data/station-facilities.json`으로 재생성한다. 앱은 이 스냅샷만 읽는다. (#24 A5 실행 지원)

키 계약:
  - 환경변수 `TRAIN_API_KEY` — 열차 스냅샷과 동일한 data.go.kr B551457 계정 키.
    '한국철도공사_편의시설정보' 활용신청이 승인된 키면 동작한다 (2026-08-09 실측 확인).
  - 키는 이 스크립트 실행 환경에만 둔다. 코드·저장소에 커밋하지 않는다. 실행 예:
      TRAIN_API_KEY='...' python3 scripts/build_station_facilities.py --dry-run

산출 규칙:
  - 전 페이지(원천 406역)를 수신한 뒤 STATION_NAME_MAP과 역명이 정확히 일치하는
    행만 수록한다. 부분 일치 매칭 금지 — '전주' 조회에 '북전주'가 섞이는 사고 방지.
  - 매핑에 없는 역·응답에 없는 역은 수록하지 않는다. 거짓·추정 시설 정보 금지 (A3).
  - 쓰기 전 기존 파일을 .bak로 백업. --dry-run이면 요약만 출력.
  - 이후 반드시: pnpm test + data/SOURCES.md에 기준일·출처 갱신.
"""
from __future__ import annotations

import argparse
import datetime
import json
import os
import shutil
import sys
import urllib.parse
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SNAPSHOT_PATH = REPO_ROOT / "data" / "station-facilities.json"

API_BASE = "https://apis.data.go.kr/B551457/convenience/stationFacilities"
PAGE_SIZE = 500

# (우리 역 id → 원천 stn_nm 정확 일치값). 원천에 없는 시드 역은 여기 넣지 않는다:
#   - station-chuncheon: 경춘선 광역전철 역 — 코레일 편의시설정보 406역 목록에 없음
#   - station-incheon-airport-t1: 공항철도(주) 운영 — 동일하게 원천 밖
STATION_NAME_MAP: dict[str, str] = {
    "station-seoul": "서울",
    "station-gangneung": "강릉",
    "station-jinbu": "진부(오대산)",
    "station-manjong": "만종",
    "station-jeonju": "전주",
}


def yn(value: object) -> bool:
    return str(value).strip().upper() == "Y"


def key_variants(key: str) -> list[str]:
    """단일 발급 키의 Encoding/Decoding 양형 시도 — build_train_snapshot.py와 동일 규칙 (PR #59 리뷰)"""
    variants = [key]
    alt = urllib.parse.unquote(key) if "%" in key else urllib.parse.quote(key, safe="")
    if alt != key:
        variants.append(alt)
    return variants


def fetch_page(service_key: str, page: int) -> dict:
    """한 페이지 조회. 키 인증 오류로 보이면 반대 인코딩형으로 1회 재시도한다."""
    last_error: Exception | None = None
    for variant in key_variants(service_key):
        query = urllib.parse.urlencode({"pageNo": page, "numOfRows": PAGE_SIZE, "_type": "json"})
        url = f"{API_BASE}?serviceKey={variant}&{query}"
        with urllib.request.urlopen(url, timeout=30) as res:
            raw = res.read().decode("utf-8")
        if raw.lstrip().startswith("<"):  # 인증 실패는 XML(OpenAPI_ServiceResponse)로 내려온다
            last_error = SystemExit(f"[진단] 키 인증 문제로 보임 — 반대 인코딩형으로 재시도: {raw[:120]}")
            continue
        body = json.loads(raw)["response"]
        header = body.get("header", {})
        if str(header.get("resultCode")) not in {"0", "00"}:
            raise SystemExit(f"API 오류: {header.get('resultCode')} {header.get('resultMsg')}")
        return body["body"]
    raise last_error if last_error else SystemExit("키 인증 실패")


def fetch_all(service_key: str) -> list[dict]:
    items: list[dict] = []
    page = 1
    while True:
        payload = fetch_page(service_key, page)
        batch = payload["items"]["item"]
        if isinstance(batch, dict):  # data.go.kr는 1건이면 객체로 내려준다
            batch = [batch]
        items.extend(batch)
        if len(items) >= int(payload["totalCount"]):
            return items
        page += 1


def build(items: list[dict]) -> dict:
    by_name = {}
    for item in items:
        name = str(item["stn_nm"]).strip()
        # 동명 역이 나타나면 매핑을 코드 기준으로 바꿔야 한다 — 조용히 덮지 않고 실패
        if name in by_name and name in STATION_NAME_MAP.values():
            raise SystemExit(f"원천에 동명 역이 2건 이상: {name} — stn_cd 기준 매핑으로 전환 필요")
        by_name[name] = item

    stations = []
    for station_id, source_name in STATION_NAME_MAP.items():
        item = by_name.get(source_name)
        if item is None:
            raise SystemExit(f"원천에서 역을 찾지 못함: {source_name} ({station_id})")
        stations.append(
            {
                "stationId": station_id,
                "stationCode": str(item["stn_cd"]),
                "sourceName": source_name,
                "elevatorCount": int(item["elevt_cnt"]),
                "escalatorCount": int(item["esclt_cnt"]),
                "hasToilet": yn(item["gen_tolt_estnc"]),
                "hasNursingRoom": yn(item["nrsrm_estnc"]),
                "hasInfoCenter": yn(item["altm_lead_cntr_estnc"]),
            }
        )
    return {
        "source": "한국철도공사 편의시설정보 (data.go.kr B551457 convenience/stationFacilities)",
        "fetchedAt": datetime.date.today().isoformat(),
        "totalStationsInSource": len(items),
        "stations": stations,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="파일을 쓰지 않고 요약만 출력")
    args = parser.parse_args()

    service_key = os.environ.get("TRAIN_API_KEY")
    if not service_key:
        sys.exit("TRAIN_API_KEY 환경변수가 필요합니다 (커밋 금지 — 스크립트 헤더 참고)")

    snapshot = build(fetch_all(service_key))
    print(f"원천 {snapshot['totalStationsInSource']}역 중 {len(snapshot['stations'])}역 수록:")
    for station in snapshot["stations"]:
        print(
            f"  {station['stationId']} ({station['sourceName']}) — "
            f"엘리베이터 {station['elevatorCount']} · 에스컬레이터 {station['escalatorCount']} · "
            f"화장실 {'Y' if station['hasToilet'] else 'N'} · "
            f"수유실 {'Y' if station['hasNursingRoom'] else 'N'} · "
            f"안내센터 {'Y' if station['hasInfoCenter'] else 'N'}"
        )
    if args.dry_run:
        return
    if SNAPSHOT_PATH.exists():
        shutil.copyfile(SNAPSHOT_PATH, SNAPSHOT_PATH.with_suffix(".json.bak"))
    SNAPSHOT_PATH.write_text(
        json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"기록: {SNAPSHOT_PATH.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
