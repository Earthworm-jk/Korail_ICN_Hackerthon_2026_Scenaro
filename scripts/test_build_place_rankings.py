"""#48 오프라인 랭킹 파이프라인 회귀 (네트워크·키 불필요)."""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from scripts import build_place_rankings as pipeline


class PlaceRankingPipelineTest(unittest.TestCase):
    def test_실스냅의_검토_하한은_0_25다(self) -> None:
        self.assertEqual(pipeline.DEFAULT_BADGE_THRESHOLD, 0.25)

    def test_입력은_현재_작품과_장소를_빠짐없이_포함한다(self) -> None:
        version, works, places = pipeline.load_inputs()
        self.assertEqual(version, "v1")
        self.assertGreaterEqual(len(works), 10)
        self.assertGreaterEqual(len(places), 36)

    def test_검증된_관계만_자동_활성화하고_장면_설명을_이유로_쓴다(self) -> None:
        reasons = {
            ("work-a", "place-a"): {"ko": "장면 A", "en": "Scene A"},
            ("work-b", "place-b"): {"ko": "장면 B", "en": "Scene B"},
        }
        snapshot = pipeline.build_snapshot(
            "test-model", "v1", ["work-a", "work-b"], ["place-a", "place-b"],
            [[1.0, 0.0], [0.0, 1.0], [1.0, 0.0], [1.0, 1.0]],
            0.7, "2026-08-09T12:00:00+09:00",
            reasons,
        )
        self.assertEqual(len(snapshot["rankings"]), 2)
        self.assertEqual(snapshot["rankings"][0], {
            "workId": "work-a",
            "placeId": "place-a",
            "score": 1.0,
            "reviewed": True,
            "reviewedAt": "2026-08-09",
            "reviewedBy": pipeline.AUTO_REVIEWER,
            "reviewMethod": pipeline.AUTO_REVIEW_METHOD,
            "reason": reasons[("work-a", "place-a")],
        })

    def test_기존_사람_검토_이력은_점수_재생성_후에도_보존한다(self) -> None:
        previous = {
            "rankings": [{
                "workId": "work-a",
                "placeId": "place-a",
                "score": 0.5,
                "reviewed": True,
                "reviewedAt": "2026-08-08",
                "reviewedBy": "reviewer",
                "reason": {"ko": "사람 검토", "en": "Human review"},
            }],
        }
        snapshot = pipeline.build_snapshot(
            "test-model", "v1", ["work-a"], ["place-a"], [[1.0, 0.0], [1.0, 0.0]],
            0.25, "2026-08-10T12:00:00+09:00",
            {("work-a", "place-a"): {"ko": "자동", "en": "Automatic"}}, previous,
        )
        self.assertEqual(snapshot["rankings"][0]["reviewedBy"], "reviewer")
        self.assertEqual(snapshot["rankings"][0]["reason"]["ko"], "사람 검토")
        self.assertEqual(snapshot["rankings"][0]["score"], 1.0)

    def test_관계_누락이나_미활성_랭킹은_check에서_차단한다(self) -> None:
        reasons = {("work-a", "place-a"): {"ko": "장면", "en": "Scene"}}
        with self.assertRaisesRegex(pipeline.PipelineError, "활성화되지"):
            pipeline.assert_snapshot_coverage({
                "meta": {"inputRuleVersion": "v1"},
                "rankings": [{
                    "workId": "work-a", "placeId": "place-a", "score": 0.5, "reviewed": False,
                }],
            }, "v1", reasons)

    def test_임베딩_응답을_index_순서로_복원하고_사용량을_읽는다(self) -> None:
        payload = {
            "data": [
                {"index": 1, "embedding": [0.0, 1.0]},
                {"index": 0, "embedding": [1.0, 0.0]},
            ],
            "usage": {"prompt_tokens": 7},
        }
        response = mock.MagicMock()
        response.__enter__.return_value.read.return_value = json.dumps(payload).encode("utf-8")
        with mock.patch("urllib.request.urlopen", return_value=response):
            vectors, tokens = pipeline.request_embeddings("dummy-key", "test-model", ["a", "b"])
        self.assertEqual(vectors, [[1.0, 0.0], [0.0, 1.0]])
        self.assertEqual(tokens, 7)

    def test_API_실패는_기존_스냅샷을_변경하지_않는다(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "place-rankings.json"
            output.write_text(json.dumps({"old": True}), encoding="utf-8")
            with (
                mock.patch.object(pipeline, "OUTPUT_PATH", output),
                mock.patch.object(pipeline, "request_embeddings", side_effect=pipeline.PipelineError("실패")),
            ):
                exit_code = pipeline.main_with_args([], api_key="dummy-key")
            self.assertEqual(exit_code, 1)
            self.assertEqual(json.loads(output.read_text(encoding="utf-8")), {"old": True})


if __name__ == "__main__":
    unittest.main()
