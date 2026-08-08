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
    "trn_plan_dptre_dt": "2026-08-12 05:06:00.0",
    "trn_plan_arvl_dt": "2026-08-12 07:03:00.0",
}


class EmptyResponseGuardTest(unittest.TestCase):
    def test_정상_빈_응답이면_ApiError로_중단한다(self) -> None:
        with mock.patch.object(pipeline, "get_json", return_value=payload_with([])):
            with self.assertRaises(pipeline.ApiError) as caught:
                pipeline.fetch_korail_legs("dummy-key")
        self.assertIn("결과 0건", str(caught.exception))
        self.assertIn("서울→강릉", str(caught.exception))  # OD·날짜 맥락 포함

    def test_일부_호출만_빈_응답이어도_중단한다(self) -> None:
        calls = {"n": 0}

        def sometimes_empty(base, op, key, params, timeout=10.0):
            calls["n"] += 1
            return payload_with([KORAIL_ITEM] if calls["n"] == 1 else [])

        with mock.patch.object(pipeline, "get_json", side_effect=sometimes_empty):
            with self.assertRaises(pipeline.ApiError):
                pipeline.fetch_korail_legs("dummy-key")

    def test_중단_시_스냅샷_파일이_불변이다(self) -> None:
        before = pipeline.SNAPSHOT_PATH.read_text(encoding="utf-8")
        with mock.patch.object(pipeline, "get_json", return_value=payload_with([])):
            exit_code = pipeline.main_with_args(["--source", "korail"], service_key="dummy-key")
        self.assertEqual(exit_code, 1)
        self.assertEqual(pipeline.SNAPSHOT_PATH.read_text(encoding="utf-8"), before)
        self.assertFalse(pipeline.SNAPSHOT_PATH.with_suffix(".json.bak").exists())

    def test_전건_수신이면_정규화가_동작한다(self) -> None:
        with mock.patch.object(pipeline, "get_json", return_value=payload_with([KORAIL_ITEM])):
            legs = pipeline.fetch_korail_legs("dummy-key")
        self.assertTrue(all(leg.departAt.endswith("+09:00") for leg in legs))
        self.assertEqual(legs[0].trainNo, "00801")


if __name__ == "__main__":
    unittest.main()
