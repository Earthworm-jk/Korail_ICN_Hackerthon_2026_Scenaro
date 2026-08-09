#!/usr/bin/env python3
"""station-coordinates.json 생성·갱신 파이프라인 (오프라인 — 런타임 실호출 아님, API_SPEC 2.2)

역할: 개발 중 한시적으로 국가철도공단 철도역 정보를 호출해 시드 역의 위도·경도를
`data/station-coordinates.json`으로 재생성한다. 앱은 이 스냅샷만 읽는다.
v0.6 시안의 4단계 "전체 이동 동선" 지도가 역·공항 점을 실좌표에 찍기 위해 쓴다 (#14).

키 계약:
  - 환경변수 `TRAIN_API_KEY` — 열차 스냅샷·편의시설과 동일한 data.go.kr 계정 키.
    '국가철도공단_철도역 정보'(데이터셋 15067652) 활용신청이 승인된 키면 동작한다
    (2026-08-09 실측 확인). 파일데이터 자동변환 오픈API라 odcloud 경로를 쓴다.
  - 키는 이 스크립트 실행 환경에만 둔다. 코드·저장소에 커밋하지 않는다. 실행 예:
      TRAIN_API_KEY='...' python3 scripts/build_station_coordinates.py --dry-run

산출 규칙:
  - 전 페이지(원천 215역)를 수신한 뒤 STATION_NAME_MAP과 역이름이 정확히 일치하는
    행만 수록한다. 부분 일치 매칭 금지 — '전주' 조회에 '북전주'가 섞이는 사고 방지.
  - **0,0 좌표는 결측이다.** 원천 215행 중 12행이 0,0으로 내려온다(2026-08-09 확인:
    진부(오대산)역·평창역·횡성역·둔내역·서원주역 등 강릉선 신설역 다수). 이 값을 그대로
    수록하면 지도에서 아프리카 서안으로 튄다. 0,0과 대한민국 범위 밖 좌표는 거부한다.
  - 원천에 없거나 좌표가 결측인 역은 FALLBACK_COORDINATES에 명시된 보조 출처로만 채운다.
    보조 출처를 쓴 역은 `source: "fallback"`과 출처 URL을 행에 남긴다 — 어디서 온 값인지
    화면·리뷰에서 추적할 수 있어야 한다. 추정·임의 좌표 금지 (A3).
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
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SNAPSHOT_PATH = REPO_ROOT / "data" / "station-coordinates.json"
STATIONS_PATH = REPO_ROOT / "data" / "stations.json"

DATASET_ID = "15067652"
UDDI = "uddi:29222bc3-1bc1-44bd-9ad6-9210ddb9a6ca"
API_BASE = f"https://api.odcloud.kr/api/{DATASET_ID}/v1/{UDDI}"
PAGE_SIZE = 400  # 원천 215행 — 한 번에 받는다

SOURCE_LABEL = (
    "국가철도공단_철도역 정보 (공공데이터포털 15067652, odcloud REST API)"
)

# (우리 역 id → 원천 '역이름' 정확 일치값). 원천은 '역' 접미사를 포함한다.
STATION_NAME_MAP: dict[str, str] = {
    "station-seoul": "서울역",
    "station-busan": "부산역",
    "station-gangneung": "강릉역",
    "station-jinbu": "진부(오대산)역",
    "station-manjong": "만종역",
    "station-jeonju": "전주역",
    "station-namwon": "남원역",
    "station-yongsan": "용산역",
    # station-incheon-airport-t1: 공항철도(주) 운영 — 원천 밖 (build_station_facilities.py와 동일)
}

# 원천이 채우지 못하는 역의 보조 출처. 시안이 지도 출처로 명시한 OpenStreetMap을 쓴다
# ("대한민국 경계: Natural Earth · 위치: OpenStreetMap 및 검증 시드").
# 확인일 2026-08-09, Nominatim 조회 후 행정구역·역 종별(railway/station)을 대조했다.
FALLBACK_COORDINATES: dict[str, dict] = {
    "station-incheon-airport-t1": {
        "latitude": 37.4471590,
        "longitude": 126.4527808,
        "sourceNote": "원천(국가철도공단)에 없는 공항철도(주) 운영역 — OpenStreetMap 역 노드",
        "sourceRef": "https://www.openstreetmap.org/node/5919544816",
        "verifiedAt": "2026-08-09",
    },
    "station-jinbu": {
        "latitude": 37.6425685,
        "longitude": 128.5748224,
        "sourceNote": (
            "원천 좌표가 0,0 결측이라 대체 — OpenStreetMap 역 노드. "
            "원천 주소('강원도 평창군 진부면 송정길 120')와 행정구역 일치 확인"
        ),
        "sourceRef": "https://www.openstreetmap.org/node/10591459522",
        "verifiedAt": "2026-08-09",
    },
    "station-namwon": {
        "latitude": 35.411053,
        "longitude": 127.362289,
        "sourceNote": "국가철도공단 좌표 재생성 전 보조 출처 — Wikimedia Commons 사진 위치와 역 주소 대조",
        "sourceRef": "https://commons.wikimedia.org/wiki/File:Namwon_Station_2013-02-13.jpg",
        "verifiedAt": "2026-08-10",
    },
}

# 대한민국 육지 범위 — 원천 결측(0,0)과 자릿수 사고를 걸러낸다
KOREA_BOUNDS = {"lat": (33.0, 39.0), "lon": (124.0, 132.0)}


def key_variants(key: str) -> list[str]:
    """단일 발급 키의 Encoding/Decoding 양형 시도 — build_train_snapshot.py와 동일 규칙"""
    variants = [key]
    alt = urllib.parse.unquote(key) if "%" in key else urllib.parse.quote(key, safe="")
    if alt != key:
        variants.append(alt)
    return variants


def fetch_all(service_key: str) -> list[dict]:
    """odcloud 파일데이터 API — page/perPage 페이징"""
    last_error: Exception | None = None
    for variant in key_variants(service_key):
        rows: list[dict] = []
        page = 1
        try:
            while True:
                query = urllib.parse.urlencode({"page": page, "perPage": PAGE_SIZE})
                url = f"{API_BASE}?{query}&serviceKey={variant}"
                with urllib.request.urlopen(url, timeout=30) as res:
                    payload = json.loads(res.read().decode("utf-8"))
                rows.extend(payload["data"])
                if len(rows) >= int(payload["totalCount"]):
                    return rows
                page += 1
        except urllib.error.HTTPError as error:
            body = error.read().decode("utf-8", "replace")[:200]
            last_error = SystemExit(f"[진단] HTTP {error.code} — 키 인증/활용신청 확인 필요: {body}")
            continue
    raise last_error if last_error else SystemExit("키 인증 실패")


def valid_coordinate(latitude: float, longitude: float) -> bool:
    """0,0(원천 결측 표시)과 대한민국 범위 밖을 거부한다"""
    if latitude == 0 or longitude == 0:
        return False
    lat_min, lat_max = KOREA_BOUNDS["lat"]
    lon_min, lon_max = KOREA_BOUNDS["lon"]
    return lat_min <= latitude <= lat_max and lon_min <= longitude <= lon_max


def build(rows: list[dict]) -> dict:
    by_name: dict[str, dict] = {}
    for row in rows:
        name = str(row.get("역이름", "")).strip()
        # 동명 역이 나타나면 이름 기준 매핑을 버려야 한다 — 조용히 덮지 않고 실패
        if name in by_name and name in STATION_NAME_MAP.values():
            raise SystemExit(f"원천에 동명 역이 2건 이상: {name} — 주소 기준 매핑으로 전환 필요")
        by_name[name] = row

    seed = json.loads(STATIONS_PATH.read_text(encoding="utf-8"))
    stations: list[dict] = []
    for station in seed:
        station_id = station["id"]
        source_name = STATION_NAME_MAP.get(station_id)
        row = by_name.get(source_name) if source_name else None

        if row is not None:
            latitude = float(row["위도좌표"])
            longitude = float(row["경도좌표"])
            if valid_coordinate(latitude, longitude):
                stations.append(
                    {
                        "stationId": station_id,
                        "sourceName": source_name,
                        "latitude": latitude,
                        "longitude": longitude,
                        "source": "primary",
                        "address": str(row.get("주소", "")).strip(),
                    }
                )
                continue
            print(f"  [결측] {station_id} ({source_name}) 원천 좌표 {latitude},{longitude} — 보조 출처로 대체")

        fallback = FALLBACK_COORDINATES.get(station_id)
        if fallback is None:
            raise SystemExit(
                f"좌표를 채우지 못한 역: {station_id} — 원천에 없고 FALLBACK_COORDINATES에도 없다. "
                "추정값으로 채우지 말고 출처를 먼저 확보할 것 (A3)"
            )
        if not valid_coordinate(fallback["latitude"], fallback["longitude"]):
            raise SystemExit(f"보조 출처 좌표가 범위 밖: {station_id}")
        stations.append(
            {
                "stationId": station_id,
                "sourceName": source_name or station["name"]["ko"],
                "latitude": fallback["latitude"],
                "longitude": fallback["longitude"],
                "source": "fallback",
                "sourceNote": fallback["sourceNote"],
                "sourceRef": fallback["sourceRef"],
                "verifiedAt": fallback["verifiedAt"],
            }
        )

    return {
        "source": SOURCE_LABEL,
        "fetchedAt": datetime.date.today().isoformat(),
        "totalStationsInSource": len(rows),
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
        mark = "원천" if station["source"] == "primary" else "보조"
        print(
            f"  [{mark}] {station['stationId']} ({station['sourceName']}) — "
            f"{station['latitude']}, {station['longitude']}"
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
