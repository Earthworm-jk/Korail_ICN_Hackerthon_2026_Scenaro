#!/usr/bin/env python3
"""Build the search-only filming catalogue from the reviewed public snapshot.

The itinerary engine deliberately continues to use data/places.json.  This
catalogue is broader and includes locations whose rail timetable integration
has not been completed yet.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import unicodedata
from collections import defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_RAW = ROOT / "data/raw/filming_locations_20260807.csv"
DEFAULT_ACCESS = ROOT / "data/raw/catalog_access_review_20260809.json"
DEFAULT_POLICY = ROOT / "data/filming-catalog-policy.json"
DEFAULT_OUTPUT = ROOT / "data/filming-catalog.json"


def normalized(value: str) -> str:
    return unicodedata.normalize("NFC", value).strip()


def stable_place_id(name: str, address: str, lat: object, lon: object) -> str:
    """Return an order-independent ID that remains stable when rows are added."""
    identity = "|".join((normalized(name), normalized(address), str(lat), str(lon)))
    digest = hashlib.sha1(identity.encode("utf-8")).hexdigest()[:12]
    return f"catalog-place-{digest}"


def source_work_key(title: str) -> str:
    return normalized(title).replace("더 킹 :", "더 킹:")


def raw_key(row: dict[str, str]) -> tuple[str, str, str]:
    return (
        source_work_key(row["제목"]),
        normalized(row["장소명"]),
        re.sub(r"\s+", "", normalized(row["주소"])),
    )


def reviewed_key(row: dict[str, object]) -> tuple[str, str, str]:
    return (
        source_work_key(str(row["work"])),
        normalized(str(row["name"])),
        re.sub(r"\s+", "", normalized(str(row["address"]))),
    )


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw", type=Path, default=DEFAULT_RAW)
    parser.add_argument("--access", type=Path, default=DEFAULT_ACCESS)
    parser.add_argument("--policy", type=Path, default=DEFAULT_POLICY)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    policy = load_json(args.policy)
    access_rows = load_json(args.access)
    with args.raw.open(encoding="utf-8-sig", newline="") as handle:
        raw_rows = list(csv.DictReader(handle))

    raw_by_key: dict[tuple[str, str, str], list[dict[str, str]]] = defaultdict(list)
    for row in raw_rows:
        raw_by_key[raw_key(row)].append(row)

    work_by_source: dict[str, dict[str, object]] = {}
    for work in policy["works"]:
        for title in work["sourceTitles"]:
            work_by_source[source_work_key(title)] = work

    actors_by_id = {actor["id"]: actor for actor in policy["actors"]}
    excluded = {
        name
        for names in policy["excludedPlaces"].values()
        for name in names
    }
    reinclude = set(policy["reincludeBlockedPlaces"])
    canonical_names = policy["canonicalPlaceNames"]
    season_overrides = policy["seasonOverrides"]
    conditional = policy["conditionalPlaces"]
    address_overrides = policy.get("addressOverrides", {})
    coordinate_overrides = policy.get("coordinateOverrides", {})
    place_type_overrides = policy.get("placeTypeOverrides", {})
    place_source_urls = policy.get("placeSourceUrls", {})
    actor_presence_exclusions = {
        actor_id: set(place_names)
        for actor_id, place_names in policy.get("actorPresenceExclusions", {}).items()
    }

    selected: list[dict[str, object]] = []
    seen_relation: set[tuple[str, str]] = set()
    for reviewed in access_rows:
        name = normalized(str(reviewed["name"]))
        if float(reviewed["minutes"]) > 60:
            continue
        if bool(reviewed["blocked"]) and name not in reinclude:
            continue
        if name in excluded:
            continue

        source_work = source_work_key(str(reviewed["work"]))
        work = work_by_source.get(source_work)
        if work is None:
            continue
        work_id = str(season_overrides.get(name, work["id"]))
        canonical_name = str(canonical_names.get(name, name))
        relation_key = (work_id, canonical_name)
        if relation_key in seen_relation:
            continue
        seen_relation.add(relation_key)

        raw_matches = raw_by_key.get(reviewed_key(reviewed), [])
        raw = raw_matches[0] if raw_matches else {}
        reviewed = dict(reviewed)
        if canonical_name in coordinate_overrides:
            override = coordinate_overrides[canonical_name]
            reviewed["lat"] = override["latitude"]
            reviewed["lon"] = override["longitude"]
        selected.append({
            "reviewed": reviewed,
            "raw": raw,
            "workId": work_id,
            "canonicalName": canonical_name,
        })

    # A physical place is shared when the reviewed coordinates match.  This
    # intentionally folds facilities in one complex (for example Signiel and
    # Lotte World Mall) into one catalogue destination.
    grouped: dict[tuple[object, object], list[dict[str, object]]] = defaultdict(list)
    for item in selected:
        reviewed = item["reviewed"]
        lat = reviewed.get("lat")
        lon = reviewed.get("lon")
        if lat is not None and lon is not None:
            key = (round(float(lat), 5), round(float(lon), 5))
        else:
            key = ("address", re.sub(r"\s+", "", str(reviewed["address"])))
        grouped[key].append(item)

    places: list[dict[str, object]] = []
    relations: list[dict[str, object]] = []
    for items in sorted(grouped.values(), key=lambda rows: str(rows[0]["canonicalName"])):
        first = items[0]
        reviewed = first["reviewed"]
        canonical_name = str(first["canonicalName"])
        address = str(address_overrides.get(canonical_name, reviewed["address"]))
        place_id = stable_place_id(
            canonical_name,
            address,
            reviewed.get("lat"),
            reviewed.get("lon"),
        )

        work_ids = sorted({str(item["workId"]) for item in items})
        place_status = "conditional" if canonical_name in conditional else "confirmed"
        place = {
            "id": place_id,
            "name": {"ko": canonical_name, "en": canonical_name},
            "translationStatus": "ko_fallback",
            "placeType": str(place_type_overrides.get(canonical_name, reviewed["kind"])),
            "address": address,
            "latitude": float(reviewed["lat"]),
            "longitude": float(reviewed["lon"]),
            "nearestStationName": str(reviewed["station"]),
            "accessEstimate": {
                "minutes": round(float(reviewed["minutes"]), 1),
                "method": "osrm_screening",
                "verifiedAt": policy["verifiedAt"],
                "recheckRequired": True,
            },
            "status": place_status,
            "workIds": work_ids,
            "verifiedAt": policy["verifiedAt"],
            "sourceUrls": list(dict.fromkeys([
                *policy["sourceUrls"],
                *place_source_urls.get(canonical_name, []),
            ])),
        }
        if place_status == "conditional":
            place["visitNote"] = {
                "ko": conditional[canonical_name],
                "en": conditional[canonical_name],
            }
        places.append(place)

        for item in items:
            raw = item["raw"]
            description = normalized(str(raw.get("장소설명", "")))
            work_id = str(item["workId"])
            work = next(work for work in policy["works"] if work["id"] == work_id)
            actor_presence_matches = []
            for actor_id in work["actorIds"]:
                actor = actors_by_id[actor_id]
                excluded_places = actor_presence_exclusions.get(actor_id, set())
                matched_tokens = sorted({
                    token for token in actor["roleTokens"] if token in description
                })
                if str(item["canonicalName"]) not in excluded_places and matched_tokens:
                    actor_presence_matches.append({
                        "actorId": actor_id,
                        "method": "source_text_match",
                        "matchedTokens": matched_tokens,
                        "excerpt": description,
                    })
            relation = {
                "workId": work_id,
                "placeId": place_id,
                "sourceRowId": str(raw.get("연번", "")),
                "sourceSnapshotPath": "data/raw/filming_locations_20260807.csv",
                "sourcePlaceName": normalized(str(raw.get("장소명", item["canonicalName"]))),
                "sceneNote": {"ko": description, "en": description},
                "sourceUrls": [policy["sourceUrls"][0]],
                "verifiedAt": policy["verifiedAt"],
                "catalogReviewStatus": "source_transcribed",
            }
            # This is a searchable source-text candidate, not #92 A/B actor
            # presence verification.  Keep the excerpt and exact matched tokens
            # auditable without assigning a verification grade.
            if actor_presence_matches:
                relation["actorPresenceMatches"] = actor_presence_matches
            relations.append(relation)

    works = [
        {key: value for key, value in work.items() if key in {"id", "title", "year"}}
        for work in policy["works"]
    ]
    work_ids_by_actor: dict[str, list[str]] = defaultdict(list)
    for work in policy["works"]:
        for actor_id in work["actorIds"]:
            work_ids_by_actor[actor_id].append(work["id"])
    actors = [
        {
            "id": actor["id"],
            "name": actor["name"],
            "workIds": work_ids_by_actor[actor["id"]],
        }
        for actor in policy["actors"]
    ]

    place_status_counts = defaultdict(int)
    for place in places:
        place_status_counts[place["status"]] += 1
    status_by_place = {place["id"]: place["status"] for place in places}
    relation_status_counts = defaultdict(int)
    for relation in relations:
        relation_status_counts[status_by_place[relation["placeId"]]] += 1
    work_counts = defaultdict(int)
    for relation in relations:
        work_counts[relation["workId"]] += 1
    output = {
        "metadata": {
            "version": 1,
            "verifiedAt": policy["verifiedAt"],
            "relationCount": len(relations),
            "placeCount": len(places),
            "placeStatusCounts": dict(sorted(place_status_counts.items())),
            "relationStatusCounts": dict(sorted(relation_status_counts.items())),
            "workRelationCounts": dict(sorted(work_counts.items())),
            "sourceUrls": policy["sourceUrls"],
            "plannerSeedSeparated": True,
            "translationStatus": "ko_fallback",
            "englishDisplayPolicy": "hide_ko_fallback",
            "actorCandidateMethod": "source_text_match_not_ab_verified",
            "nearestStationReference": "display_name_only_not_join_key",
            "accessScreeningMethod": "OSRM estimated driving time; recheck boundary locations before itinerary use",
        },
        "actors": actors,
        "works": works,
        "places": places,
        "relations": sorted(relations, key=lambda row: (row["workId"], row["placeId"])),
    }
    args.output.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(relations)} relations / {len(places)} places to {args.output}")


if __name__ == "__main__":
    main()
