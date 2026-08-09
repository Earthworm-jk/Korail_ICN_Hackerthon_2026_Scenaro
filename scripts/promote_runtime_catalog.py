#!/usr/bin/env python3
"""검증된 광역 카탈로그 배치를 일정 런타임 시드로 결정적으로 승격한다.

일반 경로는 source_text_match와 자동 게이트로 통과시키고, 번역·체류 유형처럼 원천에 없는
최소 보강값만 manifest가 제공한다. 접근 한계·지원 역·왕복 시간표·배우 근거가 깨진 항목은
조용히 수록하지 않고 전체 배치를 중단한다. 사람은 이 보류 예외만 검토하면 된다.
"""

from __future__ import annotations

import argparse
import copy
import datetime
import json
import math
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
CATALOG_PATH = ROOT / "data" / "filming-catalog.json"
MANIFEST_PATH = ROOT / "data" / "runtime-promotion-batch.json"
PLACES_PATH = ROOT / "data" / "places.json"
RELATIONS_PATH = ROOT / "data" / "work-place-relations.json"
RANKING_INPUTS_PATH = ROOT / "data" / "place-ranking-inputs.json"
EVIDENCE_PATH = ROOT / "data" / "actor-presence-evidence.json"
ACTORS_PATH = ROOT / "data" / "actors.json"
WORKS_PATH = ROOT / "data" / "works.json"
STATIONS_PATH = ROOT / "data" / "stations.json"
TRAINS_PATH = ROOT / "data" / "train-snapshot.json"

STATION_NAME_TO_ID = {
    "서울": "station-seoul",
    "용산": "station-yongsan",
    "인천공항1터미널": "station-incheon-airport-t1",
    "강릉": "station-gangneung",
    "진부(오대산)": "station-jinbu",
    "만종": "station-manjong",
    "부산": "station-busan",
    "전주": "station-jeonju",
    "남원": "station-namwon",
}

STAY_MINUTES = {
    "brief_exterior": 45,
    "nature_walk": 60,
    "food_cafe": 60,
    "culture_venue": 60,
    "resort_visit": 90,
    "large_experience": 120,
}


class PromotionError(RuntimeError):
    pass


def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def dump(path: Path, value) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def rounded_access(minutes: float) -> int:
    """OSRM 대량 선별값을 낙관적으로 줄이지 않도록 5분 단위 올림한다."""
    return int(math.ceil(minutes / 5) * 5)


def assert_round_trip(station_id: str, train_legs: list[dict]) -> None:
    if station_id == "station-seoul":
        return
    dates = sorted({leg["departAt"][:10] for leg in train_legs})
    for date in dates:
        day = [leg for leg in train_legs if leg["departAt"].startswith(date)]
        outbound = any(
            leg["fromStationId"] == "station-seoul" and leg["toStationId"] == station_id
            for leg in day
        )
        inbound = any(
            leg["fromStationId"] == station_id and leg["toStationId"] == "station-seoul"
            for leg in day
        )
        if not outbound or not inbound:
            raise PromotionError(f"{station_id}: {date} 서울 왕복 시간표가 없다")


def presence_records(
    relation: dict,
    runtime_place_id: str,
    actor_by_id: dict[str, dict],
    verified_at: str,
    overrides: dict | None = None,
) -> list[dict]:
    """A등급 근거 레코드를 만든다. 단순 배역명 후보만으로는 확정하지 않는다."""
    matches = relation.get("actorPresenceMatches", [])
    records = []
    overrides = overrides or {}
    for match in matches:
        actor_id = match["actorId"]
        actor = actor_by_id.get(actor_id)
        if not actor:
            raise PromotionError(f"알 수 없는 배우 등장 근거: {actor_id}")
        if match.get("method") != "source_text_match" or not match.get("matchedTokens"):
            raise PromotionError(f"{relation['workId']}|{relation['placeId']}: 자동 배우 근거가 불완전하다")
        override = overrides.get(actor_id)
        actor_name = actor["name"]["ko"]
        direct = actor_name in match["matchedTokens"] or actor_name in match["excerpt"]
        if not direct and not override:
            continue
        evidence = {
            "sourceUrl": override["sourceUrl"] if override else relation["sourceUrls"][0],
            "sourceTier": "official",
            "excerpt": override["excerpt"] if override else match["excerpt"],
            "placeMatched": True,
            "workMatched": True,
            "claim": "present",
            "actorExplicit": override.get("actorExplicit", True) if override else True,
            "characterActorLinked": override.get("characterActorLinked", False) if override else False,
        }
        records.append(
            {
                "id": f"{relation['workId']}--{runtime_place_id}--{actor_id}",
                "workId": relation["workId"],
                "placeId": runtime_place_id,
                "actorId": actor_id,
                "extractedAt": verified_at,
                "extractionMethod": "model_assisted" if override else "rule_based",
                "evidence": [evidence],
                "expectedDecision": {
                    "status": "confirmed",
                    "grade": "A",
                    "sourceUrls": [evidence["sourceUrl"]],
                },
            }
        )
    return records


def promoted_relation(
    catalog_relation: dict,
    runtime_place_id: str,
    note_en: str,
    actor_by_id: dict[str, dict],
    verified_at: str,
    overrides: dict | None = None,
) -> tuple[dict, list[dict]]:
    records = presence_records(
        catalog_relation,
        runtime_place_id,
        actor_by_id,
        verified_at,
        overrides,
    )
    evidence_urls = sorted(
        {url for record in records for url in record["expectedDecision"]["sourceUrls"]}
    )
    result = {
        "workId": catalog_relation["workId"],
        "placeId": runtime_place_id,
        "sceneNote": {"ko": catalog_relation["sceneNote"]["ko"], "en": note_en},
        "sourceUrls": sorted(set(catalog_relation["sourceUrls"]) | set(evidence_urls)),
        "verifiedAt": verified_at,
        "reviewed": True,
    }
    featured = sorted({record["actorId"] for record in records})
    if featured:
        result.update(
            {
                "featuredActorIds": featured,
                "actorPresenceReviewed": True,
                "actorPresenceVerification": {
                    "method": "automatic",
                    "grade": "A",
                    "decision": "confirmed",
                    "evidenceSourceUrls": evidence_urls,
                },
            }
        )
    return result, records


def build() -> tuple[list[dict], list[dict], dict, list[dict]]:
    catalog = load(CATALOG_PATH)
    manifest = load(MANIFEST_PATH)
    places = load(PLACES_PATH)
    relations = load(RELATIONS_PATH)
    ranking_inputs = load(RANKING_INPUTS_PATH)
    evidence_records = load(EVIDENCE_PATH)
    actors = load(ACTORS_PATH)
    works = load(WORKS_PATH)
    stations = load(STATIONS_PATH)
    train_snapshot = load(TRAINS_PATH)
    train_legs = train_snapshot["legs"] if isinstance(train_snapshot, dict) else train_snapshot

    actor_by_id = {actor["id"]: actor for actor in actors}
    work_by_id = {work["id"]: work for work in works}
    station_ids = {station["id"] for station in stations}
    catalog_place_by_id = {place["id"]: place for place in catalog["places"]}
    catalog_relations = catalog["relations"]
    verified_at = manifest["verifiedAt"]
    datetime.date.fromisoformat(verified_at)
    max_access = manifest["maxAccessMinutes"]

    batch = manifest["places"]
    runtime_ids = [item["runtimePlaceId"] for item in batch]
    retired_runtime_ids = set(manifest.get("retiredRuntimePlaceIds", []))
    managed_runtime_ids = set(runtime_ids) | retired_runtime_ids
    catalog_ids = [item["catalogPlaceId"] for item in batch]
    if len(runtime_ids) != len(set(runtime_ids)) or len(catalog_ids) != len(set(catalog_ids)):
        raise PromotionError("승격 배치에 중복 장소 ID가 있다")
    if set(runtime_ids) & {place["id"] for place in places if place["id"] not in runtime_ids}:
        raise PromotionError("기존 수동 시드와 승격 장소 ID가 충돌한다")

    # 재실행 시 생성 배치만 교체한다. 수동 검증 시드의 순서와 내용은 보존한다.
    places_out = [place for place in places if place["id"] not in managed_runtime_ids]
    generated_pairs: set[tuple[str, str]] = set()
    generated_relations: list[dict] = []
    generated_evidence: list[dict] = []
    generated_ranking_places: list[dict] = []
    checked_stations: set[str] = set()

    for item in batch:
        catalog_place = catalog_place_by_id.get(item["catalogPlaceId"])
        if not catalog_place:
            raise PromotionError(f"카탈로그 장소 없음: {item['catalogPlaceId']}")
        if catalog_place["status"] != "confirmed":
            raise PromotionError(f"조건부 장소는 자동 승격할 수 없다: {catalog_place['name']['ko']}")
        estimate = catalog_place["accessEstimate"]
        if estimate["minutes"] > max_access or not estimate.get("recheckRequired"):
            raise PromotionError(f"접근 게이트 실패: {catalog_place['name']['ko']}")
        station_id = STATION_NAME_TO_ID.get(catalog_place["nearestStationName"])
        if not station_id or station_id not in station_ids:
            raise PromotionError(f"지원 역 조인 실패: {catalog_place['nearestStationName']}")
        if station_id not in checked_stations:
            assert_round_trip(station_id, train_legs)
            checked_stations.add(station_id)
        if item["stayCategory"] not in STAY_MINUTES:
            raise PromotionError(f"체류 유형 오류: {item['stayCategory']}")
        if not catalog_place.get("address") or catalog_place.get("latitude") is None or catalog_place.get("longitude") is None:
            raise PromotionError(f"주소·좌표 누락: {catalog_place['name']['ko']}")

        place_relations = [
            relation for relation in catalog_relations if relation["placeId"] == catalog_place["id"]
        ]
        if not place_relations:
            raise PromotionError(f"작품 관계 없음: {catalog_place['name']['ko']}")
        relation_note_en = item["relationNoteEn"]
        relation_work_ids = {relation["workId"] for relation in place_relations}
        if relation_work_ids != set(relation_note_en):
            raise PromotionError(f"관계 번역 범위 불일치: {catalog_place['name']['ko']}")
        if any(work_id not in work_by_id for work_id in relation_work_ids):
            raise PromotionError(f"검색 Repository에 없는 작품: {catalog_place['name']['ko']}")

        work_titles_ko = "·".join(work_by_id[work_id]["title"]["ko"] for work_id in sorted(relation_work_ids))
        work_titles_en = " / ".join(work_by_id[work_id]["title"]["en"] for work_id in sorted(relation_work_ids))
        runtime_place_id = item["runtimePlaceId"]
        stay_category = item["stayCategory"]
        places_out.append(
            {
                "id": runtime_place_id,
                "name": {"ko": catalog_place["name"]["ko"], "en": item["nameEn"]},
                "workIds": sorted(relation_work_ids),
                "nearestStationId": station_id,
                "accessEstimate": {
                    "minutes": rounded_access(estimate["minutes"]),
                    "source": (
                        f"OSRM 대량 선별 {catalog_place['nearestStationName']}역→"
                        f"{catalog_place['name']['ko']} {estimate['minutes']:.1f}분의 5분 올림값 "
                        f"({estimate['verifiedAt']}; 실시간 교통·교통수단 보장 아님)"
                    ),
                    "verifiedAt": estimate["verifiedAt"],
                },
                "openingHours": {"type": "unverified"},
                "stayMinutes": STAY_MINUTES[stay_category],
                "stayMetadata": {"category": stay_category, "basis": "category_default"},
                "verificationLevel": "원본확인",
                "officialSourceCount": 1,
                "reasonText": {
                    "ko": f"{work_titles_ko}의 검증된 촬영지예요. 현재 운영·내부 출입 여부는 방문 전 확인이 필요해요.",
                    "en": (
                        f"A verified filming location from {work_titles_en}. "
                        "Check current operations and indoor access before visiting."
                    ),
                },
                "address": catalog_place["address"],
                "latitude": catalog_place["latitude"],
                "longitude": catalog_place["longitude"],
            }
        )

        scene_parts = []
        for catalog_relation in place_relations:
            pair = (catalog_relation["workId"], runtime_place_id)
            if pair in generated_pairs:
                raise PromotionError(f"중복 작품 관계: {pair[0]}|{pair[1]}")
            generated_pairs.add(pair)
            promoted, records = promoted_relation(
                catalog_relation,
                runtime_place_id,
                relation_note_en[catalog_relation["workId"]],
                actor_by_id,
                verified_at,
                item.get("actorEvidence", {}).get(catalog_relation["workId"]),
            )
            generated_relations.append(promoted)
            generated_evidence.extend(records)
            scene_parts.append(catalog_relation["sceneNote"]["ko"])
        generated_ranking_places.append(
            {
                "placeId": runtime_place_id,
                "text": f"{catalog_place['name']['ko']} — " + " ".join(scene_parts),
            }
        )

    relations_out = [
        relation
        for relation in relations
        if (relation["workId"], relation["placeId"]) not in generated_pairs
        and relation["placeId"] not in retired_runtime_ids
    ]

    # 기존 검증 장소는 새 장소를 복제하지 않고, 카탈로그의 배우명·배역명 근거만 합친다.
    relation_index = {(r["workId"], r["placeId"]): r for r in relations_out}
    for item in manifest["existingRelationActorPromotions"]:
        key = (item["workId"], item["runtimePlaceId"])
        runtime_relation = relation_index.get(key)
        catalog_place = catalog_place_by_id.get(item["catalogPlaceId"])
        catalog_relation = next(
            (
                relation
                for relation in catalog_relations
                if relation["workId"] == item["workId"]
                and relation["placeId"] == item["catalogPlaceId"]
            ),
            None,
        )
        if not runtime_relation or not catalog_place or not catalog_relation:
            raise PromotionError(f"기존 관계 승격 조인 실패: {key[0]}|{key[1]}")
        runtime_place = next(place for place in places_out if place["id"] == item["runtimePlaceId"])
        if runtime_place["name"]["ko"] != catalog_place["name"]["ko"]:
            raise PromotionError(f"동명이소 방어 실패: {key[1]}")
        records = presence_records(
            catalog_relation,
            item["runtimePlaceId"],
            actor_by_id,
            verified_at,
        )
        featured = sorted({record["actorId"] for record in records})
        if not featured:
            raise PromotionError(f"배우 등장 근거 없음: {key[0]}|{key[1]}")
        generated_evidence.extend(records)
        evidence_urls = sorted(
            {url for record in records for url in record["expectedDecision"]["sourceUrls"]}
        )
        runtime_relation["featuredActorIds"] = sorted(
            set(runtime_relation.get("featuredActorIds", [])) | set(featured)
        )
        runtime_relation["actorPresenceReviewed"] = True
        runtime_relation["sourceUrls"] = sorted(
            set(runtime_relation["sourceUrls"]) | set(catalog_relation["sourceUrls"]) | set(evidence_urls)
        )
        runtime_relation["verifiedAt"] = verified_at
        runtime_relation["reviewed"] = True
        runtime_relation["actorPresenceVerification"] = {
            "method": "automatic",
            "grade": "A",
            "decision": "confirmed",
            "evidenceSourceUrls": evidence_urls,
        }

    relations_out.extend(generated_relations)
    ranking_inputs_out = copy.deepcopy(ranking_inputs)
    generated_id_set = managed_runtime_ids
    ranking_inputs_out["places"] = [
        place for place in ranking_inputs_out["places"] if place["placeId"] not in generated_id_set
    ] + generated_ranking_places

    generated_scope = generated_pairs | {
        (item["workId"], item["runtimePlaceId"])
        for item in manifest["existingRelationActorPromotions"]
    }
    evidence_out = [
        record
        for record in evidence_records
        if (record["workId"], record["placeId"]) not in generated_scope
        and record["placeId"] not in retired_runtime_ids
    ] + generated_evidence
    evidence_ids = [record["id"] for record in evidence_out]
    if len(evidence_ids) != len(set(evidence_ids)):
        raise PromotionError("배우 근거 레코드 ID가 중복된다")

    return places_out, relations_out, ranking_inputs_out, evidence_out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="생성 결과가 커밋된 시드와 같은지만 확인")
    args = parser.parse_args()
    try:
        places, relations, ranking_inputs, evidence_records = build()
    except (KeyError, ValueError, StopIteration, PromotionError) as error:
        print(f"승격 중단: {error}")
        return 1

    outputs = {
        PLACES_PATH: places,
        RELATIONS_PATH: relations,
        RANKING_INPUTS_PATH: ranking_inputs,
        EVIDENCE_PATH: evidence_records,
    }
    if args.check:
        stale = [path for path, value in outputs.items() if load(path) != value]
        if stale:
            print("재생성 필요: " + ", ".join(str(path.relative_to(ROOT)) for path in stale))
            return 1
        print(f"승격 스냅샷 일치: 장소 {len(places)}곳 · 관계 {len(relations)}건")
        return 0

    for path, value in outputs.items():
        dump(path, value)
    print(f"승격 완료: 장소 {len(places)}곳 · 관계 {len(relations)}건")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
