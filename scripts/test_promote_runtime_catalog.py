from __future__ import annotations

import unittest

from scripts import promote_runtime_catalog as pipeline


class RuntimePromotionPipelineTest(unittest.TestCase):
    def test_MVP_5명_10편이_모두_실일정_후보를_가진다(self) -> None:
        places, relations, ranking_inputs, evidence_records = pipeline.build()
        actors = pipeline.load(pipeline.ACTORS_PATH)
        works = pipeline.load(pipeline.WORKS_PATH)

        self.assertEqual(len(places), 36)
        self.assertEqual(len(relations), 42)
        self.assertEqual(len(ranking_inputs["places"]), 36)
        self.assertGreater(len(evidence_records), 1)

        for actor in actors:
            actor_places = {
                relation["placeId"]
                for relation in relations
                if actor["id"] in relation.get("featuredActorIds", [])
            }
            self.assertGreaterEqual(len(actor_places), 5, actor["id"])

        for work in works:
            work_places = {
                relation["placeId"]
                for relation in relations
                if relation["workId"] == work["id"]
            }
            self.assertGreaterEqual(len(work_places), 2, work["id"])

    def test_OSRM_선별값은_5분_단위로_보수적_올림한다(self) -> None:
        self.assertEqual(pipeline.rounded_access(2.1), 5)
        self.assertEqual(pipeline.rounded_access(5.0), 5)
        self.assertEqual(pipeline.rounded_access(5.1), 10)

    def test_왕복_시간표가_빈_역은_자동_승격하지_않는다(self) -> None:
        one_way = [
            {
                "fromStationId": "station-seoul",
                "toStationId": "station-example",
                "departAt": "2026-08-12T09:00:00+09:00",
            }
        ]
        with self.assertRaisesRegex(pipeline.PromotionError, "왕복 시간표"):
            pipeline.assert_round_trip("station-example", one_way)

    def test_배우_원천_문구_일치가_없으면_등장_확정을_만들지_않는다(self) -> None:
        relation = {
            "workId": "work-example",
            "placeId": "catalog-place-example",
            "actorPresenceMatches": [
                {"actorId": "actor-example", "method": "source_text_match", "matchedTokens": []}
            ],
        }
        with self.assertRaisesRegex(pipeline.PromotionError, "배우 근거"):
            pipeline.presence_records(
                relation,
                "place-example",
                {"actor-example": {"name": {"ko": "예시배우", "en": "Example Actor"}}},
                "2026-08-10",
            )


if __name__ == "__main__":
    unittest.main()
