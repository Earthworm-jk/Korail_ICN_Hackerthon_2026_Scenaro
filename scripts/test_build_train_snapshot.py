"""PR #50 리뷰 차단 회귀: 빈/부분 응답이 스냅샷을 지우지 못한다.

실행: python3 -m unittest scripts.test_build_train_snapshot -v
(네트워크·키 불필요 — get_json을 모듈 수준에서 대체한다)
"""
from __future__ import annotations

import json
import unittest
from unittest import mock

from scripts import build_train_snapshot as pipeline


def payload_with(items: list[dict]) -> dict:
    return {"response": {"header": {"resultCode": "0", "resultMsg": "정상"},
                         "body": {"items": {"item": items}}}}


KORAIL_ITEM = {
    "trn_no": "00801",
    "run_ymd": "20260812",
    "dptre_stn_nm": "서울",
    "arvl_stn_nm": "강릉",
    "trn_plan_dptre_dt": "2026-08-12 05:06:00.0",
    "trn_plan_arvl_dt": "2026-08-12 07:03:00.0",
}

KORAIL_ITEM_REVERSE = {
    "trn_no": "00802",
    "run_ymd": "20260812",
    "dptre_stn_nm": "강릉",
    "arvl_stn_nm": "서울",
    "trn_plan_dptre_dt": "2026-08-12 08:00:00.0",
    "trn_plan_arvl_dt": "2026-08-12 09:58:00.0",
}

# v2 실측(#49): 역명 cond가 서버에서 걸러지지 않으므로 일별 전 노선 응답에는
# 데모 OD 밖 행도 섞여 온다 — 클라이언트 필터가 이런 행을 제외해야 한다.
KORAIL_ITEM_OTHER_OD = {
    "trn_no": "00001",
    "run_ymd": "20260812",
    "dptre_stn_nm": "서울",
    "arvl_stn_nm": "부산",
    "trn_plan_dptre_dt": "2026-08-12 05:13:00.0",
    "trn_plan_arvl_dt": "2026-08-12 07:50:00.0",
}


def plan_items(date: str) -> list[dict]:
    """운행계획(runPlan2) 일별 응답 — 날짜 cond에 맞춰 재작성한 fixture"""
    day = f"{date[0:4]}-{date[4:6]}-{date[6:8]}"
    out = []
    for item in (KORAIL_ITEM, KORAIL_ITEM_REVERSE, KORAIL_ITEM_OTHER_OD):
        row = dict(item)
        row["run_ymd"] = date
        row["trn_plan_dptre_dt"] = day + row["trn_plan_dptre_dt"][10:]
        row["trn_plan_arvl_dt"] = day + row["trn_plan_arvl_dt"][10:]
        out.append(row)
    return out


def runinfo_stop(trn_no: str, date: str, sn: int, stn: str, stop_se: str,
                 arvl: str | None, dptre: str | None, direction: str) -> dict:
    """정차역 실적(runInfo2) 실응답 형태 행 — #56 실측 필드 그대로"""
    day = f"{date[0:4]}-{date[4:6]}-{date[6:8]}"
    return {
        "mrnt_cd": "25", "mrnt_nm": "강릉선", "run_ymd": date,
        "stn_cd": "0000000", "stn_nm": stn,
        "stop_se_cd": {"시발": "01", "여객승하차": "11", "종착": "02"}[stop_se],
        "stop_se_nm": stop_se,
        "trn_arvl_dt": f"{day} {arvl}:00.0" if arvl else None,
        "trn_dptre_dt": f"{day} {dptre}:00.0" if dptre else None,
        "trn_no": trn_no, "trn_run_sn": str(sn), "uppln_dn_se_cd": direction,
    }


def runinfo_items(date: str) -> list[dict]:
    """실적 일별 fixture — 하행 00801(서울-만종-진부-강릉)·상행 00802(강릉-진부-만종-서울)와
    계획에 없는 열차 99999(allowlist 제외 검증용). 만종은 #56 2단계 실운행 패턴 반영."""
    return [
        runinfo_stop("00801", date, 1, "서울", "시발", None, "05:06", "D"),
        runinfo_stop("00801", date, 2, "만종", "여객승하차", "06:00", "06:02", "D"),
        runinfo_stop("00801", date, 3, "진부", "여객승하차", "06:30", "06:32", "D"),
        runinfo_stop("00801", date, 4, "강릉", "종착", "07:01", None, "D"),
        runinfo_stop("00802", date, 1, "강릉", "시발", None, "08:00", "U"),
        runinfo_stop("00802", date, 2, "진부", "여객승하차", "08:28", "08:30", "U"),
        runinfo_stop("00802", date, 3, "만종", "여객승하차", "09:00", "09:02", "U"),
        runinfo_stop("00802", date, 4, "서울", "종착", "09:58", None, "U"),
        runinfo_stop("99999", date, 1, "서울", "시발", None, "10:00", "D"),
        runinfo_stop("99999", date, 2, "진부", "여객승하차", "11:30", "11:32", "D"),
        runinfo_stop("99999", date, 3, "강릉", "종착", "12:00", None, "D"),
    ]


def runinfo_row_of(items: list[dict], trn_no: str, stn_nm: str) -> dict:
    """위치 인덱스 대신 (열차, 역)으로 fixture 행을 찾는다 — 역 추가에도 변조 대상이 안 흔들린다"""
    return next(row for row in items if row["trn_no"] == trn_no and row["stn_nm"] == stn_nm)


def korail_side_effect(runinfo_mutate=None):
    """오퍼레이션별 fixture 분기 — 계획은 요청 일자, 실적은 요청 일자(=데모일-7)로 생성"""
    def responder(base, op, key, params, timeout=10.0):
        date = params["cond[run_ymd::EQ]"]
        if op == pipeline.KORAIL_RUNINFO_OP:
            items = runinfo_items(date)
            if runinfo_mutate is not None:
                items = runinfo_mutate(items, date)
            return payload_with(items)
        return payload_with(plan_items(date))
    return responder


class EmptyResponseGuardTest(unittest.TestCase):
    def test_정상_빈_응답이면_ApiError로_중단한다(self) -> None:
        with mock.patch.object(pipeline, "get_json", return_value=payload_with([])):
            with self.assertRaises(pipeline.ApiError) as caught:
                pipeline.fetch_korail_legs("dummy-key")
        self.assertIn("결과 0건", str(caught.exception))
        self.assertIn("20260812", str(caught.exception))  # 날짜 맥락 포함

    def test_데모_OD가_일별_응답에_없으면_중단한다(self) -> None:
        # 전 노선 응답 자체는 정상이지만 서울↔강릉 행이 없는 경우 — OD 맥락으로 중단
        with mock.patch.object(pipeline, "get_json", return_value=payload_with([KORAIL_ITEM_OTHER_OD])):
            with self.assertRaises(pipeline.ApiError) as caught:
                pipeline.fetch_korail_legs("dummy-key")
        self.assertIn("결과 0건", str(caught.exception))
        self.assertIn("서울→강릉", str(caught.exception))

    def test_일부_호출만_빈_응답이어도_중단한다(self) -> None:
        calls = {"n": 0}

        def sometimes_empty(base, op, key, params, timeout=10.0):
            calls["n"] += 1
            return payload_with([KORAIL_ITEM] if calls["n"] == 1 else [])

        with mock.patch.object(pipeline, "get_json", side_effect=sometimes_empty):
            with self.assertRaises(pipeline.ApiError):
                pipeline.fetch_korail_legs("dummy-key")

    def test_중단_시_스냅샷_파일이_불변이다(self) -> None:
        # PR #50 리뷰 비차단 반영: 이전 실행이 남긴 .bak가 있어도 오탐하지 않도록
        # 실행 전 백업의 존재·내용을 기록해 실행 후와 동일한지 비교한다.
        backup_path = pipeline.SNAPSHOT_PATH.with_suffix(".json.bak")
        before = pipeline.SNAPSHOT_PATH.read_text(encoding="utf-8")
        backup_before = backup_path.read_text(encoding="utf-8") if backup_path.exists() else None
        with mock.patch.object(pipeline, "get_json", return_value=payload_with([])):
            exit_code = pipeline.main_with_args(["--source", "korail"], service_key="dummy-key")
        self.assertEqual(exit_code, 1)
        self.assertEqual(pipeline.SNAPSHOT_PATH.read_text(encoding="utf-8"), before)
        backup_after = backup_path.read_text(encoding="utf-8") if backup_path.exists() else None
        self.assertEqual(backup_after, backup_before)

    def test_tago_소스는_비_dry_run_쓰기를_거부하고_스냅샷과_백업이_불변이다(self) -> None:
        # PR #54 리뷰 차단 반영: 교차검증 전용 TAGO가 본 스냅샷을 덮어쓰지 못한다
        backup_path = pipeline.SNAPSHOT_PATH.with_suffix(".json.bak")
        before = pipeline.SNAPSHOT_PATH.read_text(encoding="utf-8")
        backup_before = backup_path.read_text(encoding="utf-8") if backup_path.exists() else None
        with mock.patch.object(pipeline, "get_json", side_effect=AssertionError("호출 금지")) as fake:
            exit_code = pipeline.main_with_args(["--source", "tago"], service_key="dummy-key")
        self.assertEqual(exit_code, 1)
        fake.assert_not_called()  # 가드가 API 호출 전에 종료한다
        self.assertEqual(pipeline.SNAPSHOT_PATH.read_text(encoding="utf-8"), before)
        backup_after = backup_path.read_text(encoding="utf-8") if backup_path.exists() else None
        self.assertEqual(backup_after, backup_before)

    def test_tago_dry_run은_유효_fixture로_성공하고_쓰지_않는다(self) -> None:
        # #56 비차단 합류분: 반환값 (0, 1) 허용을 exit 0 고정으로 강화 — dry-run 진입을 강하게 증명
        def tago_responder(base, op, key, params, timeout=10.0):
            if op == pipeline.TAGO_STATION_OP:
                return payload_with([{"nodename": "서울", "nodeid": "NAT010000"},
                                     {"nodename": "강릉", "nodeid": "NAT601936"}])
            date = params["depPlandTime"]
            return payload_with([{"trainno": "801",
                                  "depplandtime": f"{date}050600", "arrplandtime": f"{date}070300"}])

        before = pipeline.SNAPSHOT_PATH.read_text(encoding="utf-8")
        with mock.patch.object(pipeline, "get_json", side_effect=tago_responder) as fake:
            exit_code = pipeline.main_with_args(["--source", "tago", "--dry-run"], service_key="dummy-key")
        self.assertEqual(exit_code, 0)
        self.assertGreater(fake.call_count, 0)
        self.assertEqual(pipeline.SNAPSHOT_PATH.read_text(encoding="utf-8"), before)  # dry-run은 쓰지 않는다

    def test_페이지_상한_도달_시_부분_수신으로_중단한다(self) -> None:
        # PR #54 리뷰 비차단 2: len(rows) < total이면 조용히 반환하지 않는다
        def one_row_huge_total(base, op, key, params, timeout=10.0):
            payload = payload_with([dict(KORAIL_ITEM)])
            payload["response"]["body"]["totalCount"] = 10000
            return payload

        with mock.patch.object(pipeline, "get_json", side_effect=one_row_huge_total):
            with self.assertRaises(pipeline.ApiError) as caught:
                pipeline.fetch_korail_day("dummy-key", "20260812")
        self.assertIn("부분 수신", str(caught.exception))

    def test_전건_수신이면_정규화가_동작하고_OD_밖_행은_제외한다(self) -> None:
        with mock.patch.object(pipeline, "get_json", side_effect=korail_side_effect()):
            legs = pipeline.fetch_korail_legs("dummy-key")
        self.assertTrue(all(leg.departAt.endswith("+09:00") for leg in legs))
        self.assertEqual(legs[0].trainNo, "00801")
        # 데모 OD 밖 행(서울→부산 00001)은 legs에 포함되지 않는다
        self.assertNotIn("00001", {leg.trainNo for leg in legs})
        # 시종착(계획) 3일 × 양방향 각 1건 + 중간 정차(실적) 3일 × 8건(진부·만종 경유 왕복)
        self.assertEqual(len(legs), len(pipeline.DATES) * 2 + len(pipeline.DATES) * 8)


class StopoverContractTest(unittest.TestCase):
    """#56 A안 합의 계약: 실응답 형태 fixture로 중간 OD 추출을 증명한다.
    - 정확한 정차 행만 추출하고 종단 시각으로 중간 시각을 합성하지 않는다
    - 데모일 계획(allowlist)에 없는 열차는 수록하지 않는다
    - 행 부재·순서 중복·상하행 혼재·시간 역전·타 일자 행이면 스냅샷 불변으로 실패한다"""

    def stopover_only(self, legs: list) -> list:
        return [leg for leg in legs if "station-jinbu" in (leg.fromStationId, leg.toStationId)]

    def test_중간_OD를_원값_그대로_날짜만_매핑해_추출한다(self) -> None:
        with mock.patch.object(pipeline, "get_json", side_effect=korail_side_effect()):
            legs = self.stopover_only(pipeline.fetch_korail_legs("dummy-key"))
        first_demo_day = pipeline.DATES[0]
        day = f"{first_demo_day[0:4]}-{first_demo_day[4:6]}-{first_demo_day[6:8]}"
        by_od = {(leg.fromStationId, leg.toStationId, leg.departAt): leg for leg in legs}
        # 서울→진부: 서울 출발(05:06)·진부 도착(06:30) 원값 그대로, 날짜만 데모일
        leg = by_od[("station-seoul", "station-jinbu", f"{day}T05:06:00+09:00")]
        self.assertEqual(leg.arriveAt, f"{day}T06:30:00+09:00")
        self.assertEqual(leg.trainNo, "00801")
        # 진부→강릉: 진부 출발(06:32)·강릉 도착(07:01) — 종단 시각(계획 07:03)으로 합성하지 않는다
        leg = by_od[("station-jinbu", "station-gangneung", f"{day}T06:32:00+09:00")]
        self.assertEqual(leg.arriveAt, f"{day}T07:01:00+09:00")
        # 역방향(상행 00802): 진부→서울·강릉→진부
        leg = by_od[("station-jinbu", "station-seoul", f"{day}T08:30:00+09:00")]
        self.assertEqual(leg.arriveAt, f"{day}T09:58:00+09:00")
        leg = by_od[("station-gangneung", "station-jinbu", f"{day}T08:00:00+09:00")]
        self.assertEqual(leg.arriveAt, f"{day}T08:28:00+09:00")
        # 3일 × 왕복 4건, 데모일 계획에 없는 99999는 allowlist에서 제외된다
        self.assertEqual(len(legs), len(pipeline.DATES) * 4)
        self.assertNotIn("99999", {leg.trainNo for leg in legs})

    def test_자정_넘김은_일수_차이로_보존한다(self) -> None:
        def add_overnight(items, date):
            next_day = pipeline.shift_ymd(date, 1)
            nd = f"{next_day[0:4]}-{next_day[4:6]}-{next_day[6:8]}"
            return items + [  # 자정을 넘겨 강릉에 도착하는 심야편
                runinfo_stop("00803", date, 1, "서울", "시발", None, "23:30", "D"),
                dict(runinfo_stop("00803", date, 2, "진부", "여객승하차", "23:59", None, "D"),
                     trn_dptre_dt=f"{nd} 00:01:00.0"),
                dict(runinfo_stop("00803", date, 3, "강릉", "종착", None, None, "D"),
                     trn_arvl_dt=f"{nd} 00:20:00.0"),
            ]

        def plan_with_00803(base, op, key, params, timeout=10.0):
            date = params["cond[run_ymd::EQ]"]
            if op == pipeline.KORAIL_RUNINFO_OP:
                return payload_with(add_overnight(runinfo_items(date), date))
            day = f"{date[0:4]}-{date[4:6]}-{date[6:8]}"
            extra = dict(KORAIL_ITEM, trn_no="00803", run_ymd=date,
                         trn_plan_dptre_dt=f"{day} 23:30:00.0",
                         trn_plan_arvl_dt=f"{pipeline.shift_ymd(date, 1)[0:4]}-{pipeline.shift_ymd(date, 1)[4:6]}-{pipeline.shift_ymd(date, 1)[6:8]} 00:20:00.0")
            return payload_with(plan_items(date) + [extra])

        with mock.patch.object(pipeline, "get_json", side_effect=plan_with_00803):
            legs = self.stopover_only(pipeline.fetch_korail_legs("dummy-key"))
        first_demo_day = pipeline.DATES[0]
        day = f"{first_demo_day[0:4]}-{first_demo_day[4:6]}-{first_demo_day[6:8]}"
        next_day_str = pipeline.shift_ymd(first_demo_day, 1)
        nd = f"{next_day_str[0:4]}-{next_day_str[4:6]}-{next_day_str[6:8]}"
        overnight = sorted((leg for leg in legs if leg.trainNo == "00803"
                            and leg.departAt[0:10] in (day, nd)), key=lambda leg: leg.departAt)
        self.assertEqual(overnight[0].departAt, f"{day}T23:30:00+09:00")   # 서울→진부 당일
        self.assertEqual(overnight[0].arriveAt, f"{day}T23:59:00+09:00")
        self.assertEqual(overnight[1].departAt, f"{nd}T00:01:00+09:00")    # 진부→강릉 익일 이월
        self.assertEqual(overnight[1].arriveAt, f"{nd}T00:20:00+09:00")

    def test_진부_행이_없으면_중단하고_스냅샷이_불변이다(self) -> None:
        def drop_jinbu(items, date):
            return [row for row in items if row["stn_nm"] != "진부"]

        before = pipeline.SNAPSHOT_PATH.read_text(encoding="utf-8")
        with mock.patch.object(pipeline, "get_json", side_effect=korail_side_effect(drop_jinbu)):
            with self.assertRaises(pipeline.ApiError) as caught:
                pipeline.fetch_korail_legs("dummy-key")
            self.assertIn("정차 실적 0건", str(caught.exception))
            exit_code = pipeline.main_with_args(["--source", "korail"], service_key="dummy-key")
        self.assertEqual(exit_code, 1)
        self.assertEqual(pipeline.SNAPSHOT_PATH.read_text(encoding="utf-8"), before)

    def test_정차_순서가_중복되면_중단한다(self) -> None:
        def duplicate_sn(items, date):
            broken = [dict(row) for row in items]
            jinbu_sn = runinfo_row_of(broken, "00801", "진부")["trn_run_sn"]
            runinfo_row_of(broken, "00801", "강릉")["trn_run_sn"] = jinbu_sn  # 순서 중복
            return broken

        with mock.patch.object(pipeline, "get_json", side_effect=korail_side_effect(duplicate_sn)):
            with self.assertRaises(pipeline.ApiError) as caught:
                pipeline.fetch_korail_legs("dummy-key")
        self.assertIn("정차 순서 중복", str(caught.exception))

    def test_시간이_역전되면_중단한다(self) -> None:
        def invert_time(items, date):
            day = f"{date[0:4]}-{date[4:6]}-{date[6:8]}"
            broken = [dict(row) for row in items]
            # 00801 진부 도착이 강릉 도착보다 늦어진다
            runinfo_row_of(broken, "00801", "진부")["trn_arvl_dt"] = f"{day} 23:59:00.0"
            return broken

        with mock.patch.object(pipeline, "get_json", side_effect=korail_side_effect(invert_time)):
            with self.assertRaises(pipeline.ApiError) as caught:
                pipeline.fetch_korail_legs("dummy-key")
        self.assertIn("시간 역전", str(caught.exception))

    def test_요청_일자_밖_행이면_중단한다(self) -> None:
        def wrong_ymd(items, date):
            broken = [dict(row) for row in items]
            broken[0]["run_ymd"] = pipeline.shift_ymd(date, -1)
            return broken

        with mock.patch.object(pipeline, "get_json", side_effect=korail_side_effect(wrong_ymd)):
            with self.assertRaises(pipeline.ApiError) as caught:
                pipeline.fetch_korail_legs("dummy-key")
        self.assertIn("요청 일자 밖", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
