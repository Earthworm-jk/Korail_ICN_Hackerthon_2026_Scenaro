#!/usr/bin/env python3
"""#58 인천공항 T1↔강릉 GatewayLeg 스냅샷 오프라인 검증기.

앱 런타임에서는 호출하지 않는다. 개발 중 아래 두 공식 API를 호출해 커밋된
`data/gateway-legs.json`의 공항→강릉 편을 교차검증한다.

- 인천국제공항공사 버스정보(B551177): T1 출발 시각·운영사·노선
- TAGO 시외버스정보(1613000): 당일 T2 출발 시각·도착 예정 시각·요금

TAGO는 당일 배차만 제공하고 강릉→T1 개별편을 반환하지 않으므로, 역방향 편은
티머니 공식 운행정보 화면에서 데모 날짜를 직접 조회해 확인한다. 검증 기록은
data/SOURCES.md에 남기며 이 스크립트가 시각을 합성하거나 스냅샷을 덮어쓰지 않는다.

실행:
  set -a; source .env.local; set +a
  python3 scripts/verify_gateway_snapshot.py
"""
from __future__ import annotations

import datetime as dt
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SNAPSHOT = ROOT / "data" / "gateway-legs.json"
AIRPORT_URL = "https://apis.data.go.kr/B551177/BusInformation/getBusInfo"
TAGO_BASE = "https://apis.data.go.kr/1613000/SuburbsBusInfo"
PORTAL_SOURCES = {
    "https://www.data.go.kr/data/15095045/openapi.do",
    "https://www.data.go.kr/data/15098541/openapi.do",
}
TMONEY_SOURCE = "https://txbuse.t-money.co.kr/runinf/runInf.do"


class VerifyError(RuntimeError):
    pass


def key_variants(key: str) -> list[str]:
    variants = [key]
    other = urllib.parse.unquote(key) if "%" in key else urllib.parse.quote(key, safe="")
    if other != key:
        variants.append(other)
    return variants


def get_json(url: str, key: str, params: dict[str, str]) -> dict:
    last_error: Exception | None = None
    for variant in key_variants(key):
        query = "&".join(
            [f"serviceKey={variant}"]
            + [f"{name}={urllib.parse.quote(str(value))}" for name, value in params.items()]
        )
        try:
            with urllib.request.urlopen(f"{url}?{query}", timeout=20) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
            last_error = error
            continue
        portal_error = payload.get("OpenAPI_ServiceResponse", {}).get("cmmMsgHeader")
        if portal_error:
            last_error = VerifyError(
                f"공공데이터포털 오류 {portal_error.get('returnReasonCode')}: "
                f"{portal_error.get('returnAuthMsg')}"
            )
            continue
        header = payload.get("response", {}).get("header", {})
        if str(header.get("resultCode")) not in {"0", "00"}:
            last_error = VerifyError(f"API 오류: {header.get('resultMsg', 'unknown')}")
            continue
        return payload
    raise VerifyError(f"공식 API 호출 실패: {last_error}")


def items(payload: dict) -> list[dict]:
    value = payload.get("response", {}).get("body", {}).get("items", [])
    if isinstance(value, dict):
        value = value.get("item", [])
    if isinstance(value, dict):
        return [value]
    return value if isinstance(value, list) else []


def hhmm(iso: str) -> str:
    return iso[11:13] + iso[14:16]


def minutes(iso_start: str, iso_end: str) -> int:
    start = dt.datetime.fromisoformat(iso_start)
    end = dt.datetime.fromisoformat(iso_end)
    return round((end - start).total_seconds() / 60)


def minus_minutes(value: str, amount: int) -> str:
    clock = dt.datetime.strptime(value, "%H%M") - dt.timedelta(minutes=amount)
    return clock.strftime("%H%M")


def main() -> None:
    airport_key = os.environ.get("AIRPORT_BUS_API_KEY", "").strip()
    tago_key = os.environ.get("TAGO_BUS_API_KEY", "").strip()
    if not airport_key or not tago_key:
        raise VerifyError("AIRPORT_BUS_API_KEY와 TAGO_BUS_API_KEY가 모두 필요합니다")

    snapshot = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    outbound = next((leg for leg in snapshot if leg.get("direction") == "outbound"), None)
    inbound = next((leg for leg in snapshot if leg.get("direction") == "inbound"), None)
    if not outbound or not inbound or outbound["routeId"] != inbound["routeId"]:
        raise VerifyError("같은 routeId의 outbound/inbound 한 쌍이 필요합니다")
    if not PORTAL_SOURCES.issubset(set(outbound["sourceUrls"])):
        raise VerifyError("outbound에 공항공사·TAGO 공식 출처가 모두 필요합니다")
    if TMONEY_SOURCE not in outbound["sourceUrls"] or TMONEY_SOURCE not in inbound["sourceUrls"]:
        raise VerifyError("왕복편의 티머니 공식 조회 출처가 필요합니다")

    airport = get_json(AIRPORT_URL, airport_key, {
        "numOfRows": "500", "pageNo": "1", "area": "4", "type": "json",
    })
    route = next((row for row in items(airport) if row.get("busnumber") == "강릉"), None)
    if not route:
        raise VerifyError("공항공사 강원권 응답에 강릉 노선이 없습니다")
    t1_times = {
        value.strip().replace(":", "")
        for field in ("t1wdayt", "t1wt")
        for value in str(route.get(field, "")).split(",")
        if value.strip()
    }
    outbound_t1 = hhmm(outbound["departAt"])
    if outbound_t1 not in t1_times:
        raise VerifyError(f"스냅샷 T1 출발 {outbound_t1}이 공항공사 시간표에 없습니다")

    terminal_payload = get_json(f"{TAGO_BASE}/GetSuberbsBusTrminlList", tago_key, {
        "pageNo": "1", "numOfRows": "100", "_type": "json", "terminalNm": "강릉",
    })
    gangneung = next((row for row in items(terminal_payload) if row.get("terminalNm") == "강릉"), None)
    if not gangneung:
        raise VerifyError("TAGO 강릉 터미널 ID를 찾지 못했습니다")

    airport_terminal_payload = get_json(f"{TAGO_BASE}/GetSuberbsBusTrminlList", tago_key, {
        "pageNo": "1", "numOfRows": "100", "_type": "json", "terminalNm": "인천공항",
    })
    airport_t2 = next(
        (row for row in items(airport_terminal_payload) if row.get("terminalNm") == "인천공항2터미널"),
        None,
    )
    if not airport_t2:
        raise VerifyError("TAGO 인천공항2터미널 ID를 찾지 못했습니다")

    today = dt.datetime.now(dt.timezone(dt.timedelta(hours=9))).strftime("%Y%m%d")
    timetable = get_json(f"{TAGO_BASE}/GetStrtpntAlocFndSuberbsBusInfo", tago_key, {
        "pageNo": "1",
        "numOfRows": "100",
        "_type": "json",
        "depTerminalId": str(airport_t2["terminalId"]),
        "arrTerminalId": str(gangneung["terminalId"]),
        "depPlandTime": today,
    })
    expected_t2 = minus_minutes(outbound_t1, 20)
    tago_leg = next(
        (row for row in items(timetable) if str(row.get("depPlandTime", ""))[8:12] == expected_t2),
        None,
    )
    if not tago_leg:
        raise VerifyError(f"TAGO 당일 응답에 대응 T2 출발 {expected_t2} 편이 없습니다")
    tago_duration = round(
        (
            dt.datetime.strptime(str(tago_leg["arrPlandTime"]), "%Y%m%d%H%M%S")
            - dt.datetime.strptime(str(tago_leg["depPlandTime"]), "%Y%m%d%H%M%S")
        ).total_seconds() / 60
    )
    if minutes(outbound["departAt"], outbound["arriveAt"]) != tago_duration - 20:
        raise VerifyError("T1 스냅샷 소요시간이 TAGO T2 편과 20분 터미널 차이를 만족하지 않습니다")

    print("OK: 키 2종 인증 및 공식 응답 정상")
    print(f"OK: 공항공사 T1 강릉행 {outbound_t1}, 운영사 {route.get('cpname')}")
    print(f"OK: TAGO T2 {expected_t2}→강릉, {tago_duration}분, 노선 {tago_leg.get('routeId')}")
    print(
        "OK: 커밋 스냅샷 왕복 "
        f"{outbound['departAt']}→{outbound['arriveAt']} / "
        f"{inbound['departAt']}→{inbound['arriveAt']}"
    )
    print("NOTE: 역방향 개별편은 티머니 공식 운행정보에서 데모 날짜로 수동 검증")


if __name__ == "__main__":
    main()
