"""공식 체류시간 원문 변경 감지기의 네트워크 없는 회귀 테스트."""
from __future__ import annotations

import unittest

from scripts import verify_stay_sources as verifier


def place(quote: str = "경기전 역사투어 소요시간 1시간") -> dict:
    return {
        "id": "place-gyeonggijeon",
        "stayMetadata": {
            "basis": "official_source",
            "source": "https://example.com/course",
            "sourceFormat": "html",
            "sourceQuote": quote,
            "sourceLocator": "코스 1",
        },
    }


class StaySourceVerifierTest(unittest.TestCase):
    def test_태그와_공백_경계가_달라도_인용을_확인한다(self) -> None:
        document = "<h4>경기전 역사투어</h4><dt>소요시간</dt><dd>1시간</dd>"
        verified, errors = verifier.verify_places([place()], lambda _: document)
        self.assertEqual(verified, ["place-gyeonggijeon"])
        self.assertEqual(errors, [])

    def test_공식_문구가_바뀌면_실패하되_데이터는_수정하지_않는다(self) -> None:
        original = place()
        verified, errors = verifier.verify_places(
            [original],
            lambda _: "<p>경기전 역사투어 소요시간 90분</p>",
        )
        self.assertEqual(verified, [])
        self.assertEqual(len(errors), 1)
        self.assertIn("인용을 찾을 수 없음", errors[0])
        self.assertEqual(original["stayMetadata"]["sourceQuote"], "경기전 역사투어 소요시간 1시간")

    def test_유형_기본값은_외부_검증_대상이_아니다(self) -> None:
        default_place = {
            "id": "place-default",
            "stayMetadata": {"basis": "category_default"},
        }
        verified, errors = verifier.verify_places(
            [default_place],
            lambda _: self.fail("유형 기본값은 fetch하면 안 됩니다"),
        )
        self.assertEqual(verified, [])
        self.assertEqual(errors, [])

    def test_페이지_접근_실패를_장소별로_보고한다(self) -> None:
        def fail(_: str) -> str:
            raise TimeoutError("timeout")

        verified, errors = verifier.verify_places([place()], fail)
        self.assertEqual(verified, [])
        self.assertEqual(len(errors), 1)
        self.assertIn("place-gyeonggijeon", errors[0])
        self.assertIn("timeout", errors[0])


if __name__ == "__main__":
    unittest.main()
