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
        self.assertEqual(len(works), 4)
        self.assertEqual(len(places), 12)

    def test_작품과_장소의_모든_조합을_미검토_점수로_생성한다(self) -> None:
        snapshot = pipeline.build_snapshot(
            "test-model", "v1", ["work-a", "work-b"], ["place-a", "place-b"],
            [[1.0, 0.0], [0.0, 1.0], [1.0, 0.0], [1.0, 1.0]],
            0.7, "2026-08-09T12:00:00+09:00",
        )
        self.assertEqual(len(snapshot["rankings"]), 4)
        self.assertEqual(snapshot["rankings"][0], {
            "workId": "work-a", "placeId": "place-a", "score": 1.0, "reviewed": False,
        })
        self.assertTrue(all(item["reviewed"] is False for item in snapshot["rankings"]))

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
