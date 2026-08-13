"""#208 대표성 AI 제안 파이프라인 회귀 (네트워크·키 불필요)."""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from scripts import build_place_representativeness as pipeline


def proposal(item: dict, **overrides: object) -> dict:
    value = {
        "workId": item["workId"],
        "placeId": item["placeId"],
        "level": "standard",
        "confidence": "medium",
        "evidenceSourceUrls": [item["sourceUrls"][0]],
        "evidenceSummary": "검증된 장면 설명",
        "rationale": "일반 촬영지로 확인됨",
        "requiresHumanReview": True,
    }
    value.update(overrides)
    return value


class PlaceRepresentativenessPipelineTest(unittest.TestCase):
    def test_입력은_36개_장소의_42개_작품_관계를_포함한다(self) -> None:
        inputs = pipeline.load_inputs()
        self.assertEqual(len(inputs), 42)
        self.assertEqual(len({item["placeId"] for item in inputs}), 36)
        yeongjin = next(item for item in inputs if item["placeId"] == "place-yeongjin-beach")
        self.assertEqual(yeongjin["workId"], "work-goblin")
        self.assertIn("대표", yeongjin["reasonText"]["ko"])

    def test_요청은_엄격한_structured_output을_사용한다(self) -> None:
        request = pipeline.build_request("test-model", pipeline.load_inputs()[:1])
        output_format = request["text"]["format"]
        self.assertEqual(output_format["type"], "json_schema")
        self.assertTrue(output_format["strict"])
        self.assertFalse(output_format["schema"]["additionalProperties"])
        self.assertIn("outside memory", request["instructions"])

    def test_Responses_출력_순서를_복원해_파싱한다(self) -> None:
        inputs = pipeline.load_inputs()[:2]
        rows = [proposal(inputs[1]), proposal(inputs[0])]
        payload = {
            "output": [
                {"type": "reasoning", "content": []},
                {"type": "message", "content": [{"type": "output_text", "text": json.dumps({"proposals": rows})}]},
            ],
            "usage": {"input_tokens": 10, "output_tokens": 20, "total_tokens": 30},
        }
        response = mock.MagicMock()
        response.__enter__.return_value.read.return_value = json.dumps(payload).encode()
        with mock.patch("urllib.request.urlopen", return_value=response):
            actual, usage = pipeline.request_proposals("dummy", "test", inputs)
        self.assertEqual(actual, rows)
        self.assertEqual(usage["total_tokens"], 30)

    def test_누락_외부URL_자동승인은_규칙검증에서_차단한다(self) -> None:
        inputs = pipeline.load_inputs()[:2]
        with self.assertRaisesRegex(pipeline.PipelineError, "누락"):
            pipeline.validate_proposals([proposal(inputs[0])], inputs)
        with self.assertRaisesRegex(pipeline.PipelineError, "부분집합"):
            pipeline.validate_proposals([
                proposal(inputs[0], evidenceSourceUrls=["https://example.com/outside"]), proposal(inputs[1]),
            ], inputs)
        with self.assertRaisesRegex(pipeline.PipelineError, "사람 검토"):
            pipeline.validate_proposals([
                proposal(inputs[0], requiresHumanReview=False), proposal(inputs[1]),
            ], inputs)

    def test_AI승인은_스냅샷_제안과_정확히_일치해야_한다(self) -> None:
        inputs = pipeline.load_inputs()[:1]
        row = proposal(inputs[0], level="iconic")
        snapshot = {
            "meta": {"model": "test", "generatedAt": "2026-08-13T00:00:00Z", "inputDigest": "abc"},
            "proposals": [row],
        }
        approval = {
            "level": "iconic", "method": "openai_assisted",
            "evidenceSourceUrls": row["evidenceSourceUrls"], "proposalModel": "test",
            "proposalGeneratedAt": "2026-08-13T00:00:00Z", "proposalInputDigest": "abc",
            "approvedBy": "human:product-owner", "approvedAt": "2026-08-13",
        }
        relation = {"workId": row["workId"], "placeId": row["placeId"], "representativeness": approval}
        pipeline.validate_approvals([relation], snapshot)
        relation["representativeness"]["level"] = "major"
        with self.assertRaisesRegex(pipeline.PipelineError, "불일치"):
            pipeline.validate_approvals([relation], snapshot)

    def test_API_실패는_기존_스냅샷을_변경하지_않는다(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "proposals.json"
            output.write_text(json.dumps({"old": True}), encoding="utf-8")
            with (
                mock.patch.object(pipeline, "OUTPUT_PATH", output),
                mock.patch.object(pipeline, "request_proposals", side_effect=pipeline.PipelineError("실패")),
            ):
                code = pipeline.main_with_args([], api_key="dummy")
            self.assertEqual(code, 1)
            self.assertEqual(json.loads(output.read_text()), {"old": True})


if __name__ == "__main__":
    unittest.main()
