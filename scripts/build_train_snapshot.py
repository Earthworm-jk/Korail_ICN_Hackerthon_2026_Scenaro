#!/usr/bin/env python3
"""train-snapshot.json 생성·갱신 파이프라인 (오프라인 — 런타임 실호출 아님, API_SPEC 2.2)

역할: 개발 중 한시적으로 열차 API를 호출해 데모 기간 시간표를 받아
`data/train-snapshot.json`을 재생성한다. 앱은 이 스냅샷만 읽는다.

키 계약:
  - 환경변수 `TRAIN_API_KEY` (없으면 `AIRPORT_API_KEY`로 폴백 — 같은 포털 계정 키면 동작)
  - 키는 이 스크립트 실행 환경에만 둔다. 코드·저장소·앱 .env.local(NEXT_PUBLIC 아님이어도)에
    커밋하지 않는다. 실행 예:
      TRAIN_API_KEY='...' python3 scripts/build_train_snapshot.py --dry-run

소스:
  - korail: 한국철도공사 열차운행계획(openapis.korail.com) — 주 데이터, 기본 소스.
            계약(경로·쿼리 DSL·응답 필드)은 샘플 페이지 실측으로 확정 완료 —
            openapis.korail.com에 등록된 키만 있으면 동작한다.
  - tago  : 국토교통부(TAGO) 열차정보서비스 — 교차검증용. 표준 URI가 코드 12(서비스 없음)라
            팀 테스트에서 동작한 실제 URI 확인 필요.

산출 규칙:
  - OD_PAIRS × DATES 왕복을 조회해 legs 생성
  - 공항철도(AREX) 구간은 API에 없으므로 기존 스냅샷에서 보존한다 (PRESERVE_STATION 관련 구간)
  - 복합 키(trainNo|from|to|departAt) 중복 제거, 시각 오름차순 정렬
  - 쓰기 전 기존 파일을 .bak로 백업. --dry-run이면 요약만 출력
  - 이후 반드시: pnpm test(PR #29 시드 검증기) + data/SOURCES.md에 기준일·출처 갱신
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SNAPSHOT_PATH = REPO_ROOT / "data" / "train-snapshot.json"

# ---- 조회 대상 (필요 시 여기만 수정) -------------------------------------------------
# 데모 기준일 (SOURCES.md와 동일하게 유지)
DATES = ["20260812", "20260813", "20260814"]

# (우리 역 id, API 역 이름) — OD 양방향 모두 조회한다
OD_PAIRS: list[tuple[tuple[str, str], tuple[str, str]]] = [
    (("station-seoul", "서울"), ("station-gangneung", "강릉")),
    # 시드 확장 시: (("station-seoul", "서울"), ("station-jinbu", "진부")),
    # (("station-seoul", "서울"), ("station-manjong", "만종")),
    # (("station-seoul", "서울"), ("station-jeonju", "전주")),  # 실운행은 용산발 — OD 이름 확인 필요
]

# 이 역이 낀 구간은 API로 갱신하지 않고 기존 스냅샷에서 보존 (공항철도)
PRESERVE_STATION = "station-incheon-airport-t1"

# ---- TAGO (국토교통부 열차정보서비스) — 교차검증용 -----------------------------------
# 주의: 2026-08-08 기준 아래 기본 URI는 이 계정 키에서 "서비스 없음(코드 12)"이 나왔다.
# 팀 테스트에서 정상 동작한 실제 URI로 교체할 것 (활용신청한 서비스 상세 페이지의 End Point).
TAGO_BASE = os.environ.get(
    "TAGO_BASE",
    "https://apis.data.go.kr/1613000/TrainInfoService",
)
TAGO_STATION_OP = "getCtyAcctoTrainSttnList"
TAGO_TIMETABLE_OP = "getStrtpntAlocFndTrainInfo"
# 역 이름 → nodeid 조회에 쓰는 도시코드 (서울 11, 강원 51, 전북 45 — 팀 확인값으로 조정)
TAGO_CITY_CODES = [11, 51, 45]

# ---- KORAIL (한국철도공사 열차운행계획, openapis.korail.com) — 주 데이터 --------------
# 2026-08-08 샘플 페이지 실측으로 확정한 계약:
#   GET {BASE}/{OP}?serviceKey=...&pageNo=1&numOfRows=200
#       &cond[run_ymd::GTE]=YYYYMMDD&cond[run_ymd::LTE]=YYYYMMDD
#       &cond[dptre_stn_nm::EQ]=서울&cond[arvl_stn_nm::EQ]=강릉
#   응답: response.header.resultCode "0" / body.items.item[] —
#         trn_no("00801"), trn_plan_dptre_dt("2026-08-12 05:06:00.0"), trn_plan_arvl_dt
# 키는 openapis.korail.com에 등록된 키여야 한다("-3 등록되지 않은 서비스"면 미등록).
KORAIL_BASE = os.environ.get("KORAIL_BASE", "https://openapis.korail.com/api/v1")
KORAIL_TIMETABLE_OP = os.environ.get("KORAIL_TIMETABLE_OP", "run/travelerTrainRunPlan")


@dataclass(frozen=True)
class Leg:
    trainNo: str
    fromStationId: str
    toStationId: str
    departAt: str  # ISO +09:00
    arriveAt: str


class ApiError(RuntimeError):
    pass


def key_variants(key: str) -> list[str]:
    """단일 발급 키의 Encoding/Decoding 양형 시도 — lib/adapters/flights-live.ts와 동일 규칙"""
    variants = [key]
    try:
        alt = urllib.parse.unquote(key) if "%" in key else urllib.parse.quote(key, safe="")
        if alt != key:
            variants.append(alt)
    except Exception:
        pass
    return variants


def get_json(base: str, op: str, key: str, params: dict[str, str], timeout: float = 10.0) -> dict:
    """포털 공통 호출 — 코드 12(서비스 없음)·키 오류를 구분해 진단 메시지를 남긴다"""
    last_error: Exception | None = None
    for variant in key_variants(key):
        query = "&".join([f"serviceKey={variant}"] + [f"{k}={urllib.parse.quote(str(v))}" for k, v in params.items()])
        url = f"{base}/{op}?{query}"
        try:
            with urllib.request.urlopen(url, timeout=timeout) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            # 포털은 오류 진단을 4xx 본문(JSON)으로 주기도 한다 — 버리지 않고 해석
            try:
                payload = json.loads(error.read().decode("utf-8"))
            except Exception:
                raise ApiError(f"HTTP {error.code}: {op}") from error
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
            raise ApiError(f"네트워크/파싱 실패: {op}: {error}") from error

        header = payload.get("OpenAPI_ServiceResponse", {}).get("cmmMsgHeader")
        if header:  # 포털 게이트웨이 오류 (서비스 없음·키 오류 등)
            code, msg = header.get("returnReasonCode"), header.get("returnAuthMsg")
            if code == "12":
                raise ApiError(
                    f"[진단] '{base}/{op}' — 서비스 없음/폐기(코드 12).\n"
                    "  활용신청한 서비스 상세 페이지의 실제 End Point로 교체가 필요합니다"
                    " (스크립트 상단 상수 또는 TAGO_BASE/KORAIL_BASE 환경변수).",
                )
            if code in {"30", "31", "20", "21", "22"} or "KEY" in str(msg).upper():
                last_error = ApiError(f"[진단] 키 인증 문제(코드 {code}: {msg}) — 반대 인코딩형으로 재시도")
                continue
            raise ApiError(f"포털 오류 코드 {code}: {msg}")

        header = payload.get("response", {}).get("header", {})
        if header.get("resultCode") not in {"00", 0, "0"}:
            msg = header.get("resultMsg", "unknown")
            if str(header.get("resultCode")) == "-3":
                raise ApiError(
                    "[진단] 코레일 포털: 등록되지 않은 서비스(-3) — 이 키가 openapis.korail.com에서 "
                    "발급·서비스 신청된 키인지 확인 필요 (data.go.kr 키와 별개일 수 있음)",
                )
            if "KEY" in str(msg).upper():
                last_error = ApiError(f"[진단] 키 인증 문제({msg}) — 반대 인코딩형으로 재시도")
                continue
            raise ApiError(f"API 오류: {msg}")
        return payload

    raise last_error or ApiError("모든 키 형태 실패")


def items_of(payload: dict) -> list[dict]:
    items = payload.get("response", {}).get("body", {}).get("items", [])
    if isinstance(items, dict):  # 포털 XML→JSON 변환형: {"item": [...]}
        items = items.get("item", [])
    if isinstance(items, dict):
        items = [items]
    return items if isinstance(items, list) else []


def plandtime_to_iso(value: str | int) -> str:
    """TAGO plandtime(YYYYMMDDHHMMSS) → ISO +09:00"""
    s = str(value)
    if len(s) < 12:
        raise ApiError(f"시각 형식 이상: {value}")
    return f"{s[0:4]}-{s[4:6]}-{s[6:8]}T{s[8:10]}:{s[10:12]}:00+09:00"


def fetch_tago_station_ids(key: str, names: set[str]) -> dict[str, str]:
    """역 이름 → TAGO nodeid. 도시코드 목록을 순회하며 이름 일치로 해석한다."""
    found: dict[str, str] = {}
    for city in TAGO_CITY_CODES:
        payload = get_json(TAGO_BASE, TAGO_STATION_OP, key, {
            "numOfRows": "500", "pageNo": "1", "_type": "json", "cityCode": str(city),
        })
        for item in items_of(payload):
            name = str(item.get("nodename", "")).strip()
            if name in names and name not in found:
                found[name] = str(item.get("nodeid"))
    missing = names - set(found)
    if missing:
        raise ApiError(f"역 nodeid 미해석: {sorted(missing)} — TAGO_CITY_CODES 확인 필요")
    return found


def fetch_tago_legs(key: str) -> list[Leg]:
    names = {name for pair in OD_PAIRS for (_id, name) in pair}
    node_ids = fetch_tago_station_ids(key, names)
    legs: list[Leg] = []
    for (from_id, from_name), (to_id, to_name) in OD_PAIRS:
        for date in DATES:
            for (a_id, a_name), (b_id, b_name) in [((from_id, from_name), (to_id, to_name)),
                                                   ((to_id, to_name), (from_id, from_name))]:
                payload = get_json(TAGO_BASE, TAGO_TIMETABLE_OP, key, {
                    "numOfRows": "200", "pageNo": "1", "_type": "json",
                    "depPlaceId": node_ids[a_name], "arrPlaceId": node_ids[b_name],
                    "depPlandTime": date,
                })
                for item in items_of(payload):
                    legs.append(Leg(
                        trainNo=str(item.get("trainno")).zfill(5),
                        fromStationId=a_id,
                        toStationId=b_id,
                        departAt=plandtime_to_iso(item["depplandtime"]),
                        arriveAt=plandtime_to_iso(item["arrplandtime"]),
                    ))
    return legs


def korail_dt_to_iso(value: str) -> str:
    """"2026-08-12 05:06:00.0" → "2026-08-12T05:06:00+09:00" (KST 고정)"""
    s = str(value).strip()
    if len(s) < 19:
        raise ApiError(f"코레일 시각 형식 이상: {value}")
    return f"{s[0:10]}T{s[11:19]}+09:00"


def fetch_korail_legs(key: str) -> list[Leg]:
    legs: list[Leg] = []
    for (from_id, from_name), (to_id, to_name) in OD_PAIRS:
        for date in DATES:
            for (a_id, a_name), (b_id, b_name) in [((from_id, from_name), (to_id, to_name)),
                                                   ((to_id, to_name), (from_id, from_name))]:
                payload = get_json(KORAIL_BASE, KORAIL_TIMETABLE_OP, key, {
                    "pageNo": "1", "numOfRows": "200",
                    "cond[run_ymd::GTE]": date, "cond[run_ymd::LTE]": date,
                    "cond[dptre_stn_nm::EQ]": a_name, "cond[arvl_stn_nm::EQ]": b_name,
                })
                for item in items_of(payload):
                    legs.append(Leg(
                        trainNo=str(item["trn_no"]).zfill(5),
                        fromStationId=a_id,
                        toStationId=b_id,
                        departAt=korail_dt_to_iso(item["trn_plan_dptre_dt"]),
                        arriveAt=korail_dt_to_iso(item["trn_plan_arvl_dt"]),
                    ))
    return legs


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source", choices=["korail", "tago"], default="korail")  # 팀 방향: 코레일 주 데이터
    parser.add_argument("--dry-run", action="store_true", help="파일을 쓰지 않고 요약만 출력")
    args = parser.parse_args()

    key = os.environ.get("TRAIN_API_KEY") or os.environ.get("AIRPORT_API_KEY") or ""
    if not key:
        print("오류: TRAIN_API_KEY(또는 AIRPORT_API_KEY) 환경변수가 필요합니다.", file=sys.stderr)
        return 2

    existing = json.loads(SNAPSHOT_PATH.read_text(encoding="utf-8"))
    preserved = [leg for leg in existing
                 if PRESERVE_STATION in (leg["fromStationId"], leg["toStationId"])]

    try:
        fetched = fetch_tago_legs(key) if args.source == "tago" else fetch_korail_legs(key)
    except ApiError as error:
        print(f"실패: {error}", file=sys.stderr)
        print("\n기존 스냅샷은 변경하지 않았습니다.", file=sys.stderr)
        return 1

    merged: dict[str, dict] = {}
    for leg in [*preserved, *(vars(l) for l in fetched)]:
        record = dict(leg)
        composite = f"{record['trainNo']}|{record['fromStationId']}|{record['toStationId']}|{record['departAt']}"
        merged.setdefault(composite, record)
    result = sorted(merged.values(), key=lambda r: (r["departAt"], r["trainNo"]))

    print(f"소스: {args.source} · 조회 구간 {len(OD_PAIRS)}쌍 × {len(DATES)}일")
    print(f"API 수신 {len(fetched)}건 + 보존(공항철도) {len(preserved)}건 → 중복 제거 후 {len(result)}건")
    by_pair: dict[str, int] = {}
    for r in result:
        by_pair[f"{r['fromStationId']} → {r['toStationId']}"] = by_pair.get(f"{r['fromStationId']} → {r['toStationId']}", 0) + 1
    for pair, count in sorted(by_pair.items()):
        print(f"  {pair}: {count}건")

    if args.dry_run:
        print("\n--dry-run: 파일을 쓰지 않았습니다.")
        return 0

    backup = SNAPSHOT_PATH.with_suffix(".json.bak")
    backup.write_text(SNAPSHOT_PATH.read_text(encoding="utf-8"), encoding="utf-8")
    SNAPSHOT_PATH.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"\n기록 완료: {SNAPSHOT_PATH} (백업: {backup.name})")
    print("다음 단계: pnpm test 로 PR #29 검증기 통과 확인 + data/SOURCES.md 기준일·출처 갱신")
    return 0


if __name__ == "__main__":
    sys.exit(main())
