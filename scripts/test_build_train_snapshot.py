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

    def test_전건_수신이면_정규화가_동작하고_OD_밖_행은_제외한다(self) -> None:
        rows = [KORAIL_ITEM, KORAIL_ITEM_REVERSE, KORAIL_ITEM_OTHER_OD]
        with mock.patch.object(pipeline, "get_json", return_value=payload_with(rows)):
            legs = pipeline.fetch_korail_legs("dummy-key")
        self.assertTrue(all(leg.departAt.endswith("+09:00") for leg in legs))
        self.assertEqual(legs[0].trainNo, "00801")
        # 데모 OD 밖 행(서울→부산 00001)은 legs에 포함되지 않는다
        self.assertNotIn("00001", {leg.trainNo for leg in legs})
        # 날짜 3일 × 양방향 각 1건
        self.assertEqual(len(legs), len(pipeline.DATES) * 2)


if __name__ == "__main__":
    unittest.main()
