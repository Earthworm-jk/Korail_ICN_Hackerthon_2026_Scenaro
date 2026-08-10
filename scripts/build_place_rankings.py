#!/usr/bin/env python3
"""#48 촬영지 관련성 랭킹 스냅샷 생성기 (오프라인 전용).

`OPENAI_API_KEY`로 Embeddings API를 한 번 호출해 검증된 작품×촬영지 관계의 코사인
유사도를 계산한다. 작품–장소 관계와 장면 설명이 이미 검토된 항목은 자동 활성화하고,
관계 미검토·설명 누락·참조 불일치만 파이프라인을 중단해 사람이 예외를 확인한다.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
INPUT_PATH = REPO_ROOT / "data" / "place-ranking-inputs.json"
OUTPUT_PATH = REPO_ROOT / "data" / "place-rankings.json"
WORKS_PATH = REPO_ROOT / "data" / "works.json"
PLACES_PATH = REPO_ROOT / "data" / "places.json"
RELATIONS_PATH = REPO_ROOT / "data" / "work-place-relations.json"

OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings"
DEFAULT_MODEL = "text-embedding-3-small"
DEFAULT_BADGE_THRESHOLD = 0.25
MAX_INPUTS = 100
MAX_TOTAL_CHARS = 50_000
AUTO_REVIEWER = "pipeline:verified-relation-v1"
AUTO_REVIEW_METHOD = "verified_relation_auto"


class PipelineError(RuntimeError):
    pass


def load_api_key() -> str:
    key = os.environ.get("OPENAI_API_KEY", "").strip()
    if key:
        return key
    env_path = REPO_ROOT / ".env.local"
    if not env_path.exists():
        return ""
    for line in env_path.read_text(encoding="utf-8").splitlines():
        if not line.startswith("OPENAI_API_KEY="):
            continue
        return line.split("=", 1)[1].strip().strip("\"'")
    return ""


def read_json(path: Path) -> object:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise PipelineError(f"JSON 읽기 실패: {path}: {error}") from error


def _validated_texts(items: object, id_key: str, kind: str) -> dict[str, str]:
    if not isinstance(items, list):
        raise PipelineError(f"입력 파일의 {kind}는 배열이어야 합니다")
    result: dict[str, str] = {}
    for index, item in enumerate(items):
        if not isinstance(item, dict):
            raise PipelineError(f"{kind}[{index}]는 객체여야 합니다")
        item_id, text = item.get(id_key), item.get("text")
        if not isinstance(item_id, str) or not item_id:
            raise PipelineError(f"{kind}[{index}].{id_key}가 비어 있습니다")
        if not isinstance(text, str) or not text.strip():
            raise PipelineError(f"{kind}[{index}].text가 비어 있습니다")
        if item_id in result:
            raise PipelineError(f"중복 입력 ID: {item_id}")
        result[item_id] = text.strip()
    return result


def load_inputs(input_path: Path = INPUT_PATH) -> tuple[str, dict[str, str], dict[str, str]]:
    raw = read_json(input_path)
    if not isinstance(raw, dict):
        raise PipelineError("랭킹 입력 파일은 객체여야 합니다")
    version = raw.get("inputRuleVersion")
    if not isinstance(version, str) or not version:
        raise PipelineError("inputRuleVersion이 필요합니다")
    works = _validated_texts(raw.get("works"), "workId", "works")
    places = _validated_texts(raw.get("places"), "placeId", "places")

    expected_works = {item["id"] for item in read_json(WORKS_PATH)}  # type: ignore[index]
    expected_places = {item["id"] for item in read_json(PLACES_PATH)}  # type: ignore[index]
    if set(works) != expected_works:
        raise PipelineError(f"작품 입력 ID 불일치: 누락={sorted(expected_works - set(works))}, 초과={sorted(set(works) - expected_works)}")
    if set(places) != expected_places:
        raise PipelineError(f"장소 입력 ID 불일치: 누락={sorted(expected_places - set(places))}, 초과={sorted(set(places) - expected_places)}")
    return version, works, places


def load_relations(relations_path: Path = RELATIONS_PATH) -> dict[tuple[str, str], dict[str, str]]:
    raw = read_json(relations_path)
    if not isinstance(raw, list):
        raise PipelineError("작품–장소 관계 파일은 배열이어야 합니다")
    result: dict[tuple[str, str], dict[str, str]] = {}
    for index, item in enumerate(raw):
        if not isinstance(item, dict):
            raise PipelineError(f"relations[{index}]는 객체여야 합니다")
        work_id, place_id = item.get("workId"), item.get("placeId")
        if not isinstance(work_id, str) or not work_id or not isinstance(place_id, str) or not place_id:
            raise PipelineError(f"relations[{index}] 작품·장소 ID가 비어 있습니다")
        if item.get("reviewed") is not True:
            raise PipelineError(f"미검토 관계는 자동 랭킹할 수 없습니다: {work_id}|{place_id}")
        scene_note = item.get("sceneNote")
        if not isinstance(scene_note, dict) or not all(
            isinstance(scene_note.get(locale), str) and scene_note[locale].strip() for locale in ("ko", "en")
        ):
            raise PipelineError(f"장면 설명 ko/en 누락: {work_id}|{place_id}")
        key = (work_id, place_id)
        if key in result:
            raise PipelineError(f"중복 작품–장소 관계: {work_id}|{place_id}")
        result[key] = {locale: scene_note[locale].strip() for locale in ("ko", "en")}
    return result


def request_embeddings(api_key: str, model: str, texts: list[str], timeout: float = 30.0) -> tuple[list[list[float]], int]:
    body = json.dumps({"model": model, "input": texts, "encoding_format": "float"}).encode("utf-8")
    request = urllib.request.Request(
        OPENAI_EMBEDDINGS_URL,
        data=body,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")[:500]
        raise PipelineError(f"OpenAI API HTTP {error.code}: {detail}") from error
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
        raise PipelineError(f"OpenAI API 호출/파싱 실패: {error}") from error

    rows = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(rows, list) or len(rows) != len(texts):
        raise PipelineError(f"임베딩 수 불일치: 요청 {len(texts)}개, 응답 {len(rows) if isinstance(rows, list) else 0}개")
    vectors: list[list[float] | None] = [None] * len(texts)
    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get("index"), int) or not isinstance(row.get("embedding"), list):
            raise PipelineError("임베딩 응답 형식이 올바르지 않습니다")
        index = row["index"]
        if not 0 <= index < len(texts) or vectors[index] is not None:
            raise PipelineError(f"임베딩 index가 잘못되었거나 중복입니다: {index}")
        vector = row["embedding"]
        if not vector or not all(isinstance(value, (int, float)) and math.isfinite(value) for value in vector):
            raise PipelineError(f"임베딩 벡터가 비었거나 유한수가 아닙니다: {index}")
        vectors[index] = [float(value) for value in vector]
    result = [vector for vector in vectors if vector is not None]
    dimensions = {len(vector) for vector in result}
    if len(dimensions) != 1:
        raise PipelineError(f"임베딩 차원이 서로 다릅니다: {sorted(dimensions)}")
    usage = payload.get("usage", {}) if isinstance(payload, dict) else {}
    prompt_tokens = usage.get("prompt_tokens", 0) if isinstance(usage, dict) else 0
    return result, int(prompt_tokens) if isinstance(prompt_tokens, int) else 0


def cosine_similarity(a: list[float], b: list[float]) -> float:
    if len(a) != len(b) or not a:
        raise PipelineError("코사인 유사도 입력 벡터 차원이 올바르지 않습니다")
    norm_a = math.sqrt(sum(value * value for value in a))
    norm_b = math.sqrt(sum(value * value for value in b))
    if norm_a == 0 or norm_b == 0:
        raise PipelineError("영벡터의 코사인 유사도는 계산할 수 없습니다")
    return sum(x * y for x, y in zip(a, b)) / (norm_a * norm_b)


def build_snapshot(
    model: str,
    input_rule_version: str,
    work_ids: list[str],
    place_ids: list[str],
    vectors: list[list[float]],
    badge_threshold: float,
    generated_at: str,
    relation_reasons: dict[tuple[str, str], dict[str, str]],
    previous_snapshot: dict | None = None,
) -> dict:
    work_vectors = dict(zip(work_ids, vectors[:len(work_ids)]))
    place_vectors = dict(zip(place_ids, vectors[len(work_ids):]))
    previous_by_pair = {
        (item["workId"], item["placeId"]): item
        for item in (previous_snapshot or {}).get("rankings", [])
        if isinstance(item, dict) and isinstance(item.get("workId"), str) and isinstance(item.get("placeId"), str)
    }
    rankings = []
    reviewed_at = generated_at[:10]
    for work_id, place_id in sorted(relation_reasons):
        if work_id not in work_vectors or place_id not in place_vectors:
            raise PipelineError(f"랭킹 입력에 없는 관계: {work_id}|{place_id}")
        item = {
            "workId": work_id,
            "placeId": place_id,
            "score": round(cosine_similarity(work_vectors[work_id], place_vectors[place_id]), 6),
            "reviewed": True,
        }
        previous = previous_by_pair.get((work_id, place_id))
        if previous and previous.get("reviewed") is True:
            item.update({
                key: previous[key]
                for key in ("reviewedAt", "reviewedBy", "reviewMethod", "reason")
                if key in previous
            })
        else:
            item.update({
                "reviewedAt": reviewed_at,
                "reviewedBy": AUTO_REVIEWER,
                "reviewMethod": AUTO_REVIEW_METHOD,
                "reason": relation_reasons[(work_id, place_id)],
            })
        rankings.append(item)
    return {
        "meta": {
            "model": model,
            "inputRuleVersion": input_rule_version,
            "generatedAt": generated_at,
            "badgeThreshold": badge_threshold,
        },
        "rankings": rankings,
    }


def assert_snapshot_coverage(
    snapshot: object,
    input_rule_version: str,
    relation_reasons: dict[tuple[str, str], dict[str, str]],
) -> None:
    if not isinstance(snapshot, dict) or not isinstance(snapshot.get("meta"), dict):
        raise PipelineError("랭킹 스냅샷 meta가 없습니다")
    if snapshot["meta"].get("inputRuleVersion") != input_rule_version:
        raise PipelineError("랭킹 입력 규칙 버전이 현재 입력과 다릅니다")
    rankings = snapshot.get("rankings")
    if not isinstance(rankings, list):
        raise PipelineError("랭킹 스냅샷 rankings가 배열이 아닙니다")
    actual: set[tuple[str, str]] = set()
    for index, item in enumerate(rankings):
        if not isinstance(item, dict):
            raise PipelineError(f"rankings[{index}]는 객체여야 합니다")
        pair = (item.get("workId"), item.get("placeId"))
        if not all(isinstance(value, str) and value for value in pair):
            raise PipelineError(f"rankings[{index}] 작품·장소 ID가 비어 있습니다")
        typed_pair = (str(pair[0]), str(pair[1]))
        if typed_pair in actual:
            raise PipelineError(f"중복 랭킹: {typed_pair[0]}|{typed_pair[1]}")
        actual.add(typed_pair)
        if item.get("reviewed") is not True:
            raise PipelineError(f"런타임 관계 랭킹이 활성화되지 않았습니다: {typed_pair[0]}|{typed_pair[1]}")
        reason = item.get("reason")
        if not isinstance(reason, dict) or not all(
            isinstance(reason.get(locale), str) and reason[locale].strip() for locale in ("ko", "en")
        ):
            raise PipelineError(f"랭킹 이유 ko/en 누락: {typed_pair[0]}|{typed_pair[1]}")
    expected = set(relation_reasons)
    if actual != expected:
        missing = sorted(f"{work}|{place}" for work, place in expected - actual)
        extra = sorted(f"{work}|{place}" for work, place in actual - expected)
        raise PipelineError(f"관계 랭킹 범위 불일치: 누락={missing}, 초과={extra}")


def main_with_args(argv: list[str], api_key: str | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--badge-threshold", type=float, default=DEFAULT_BADGE_THRESHOLD)
    parser.add_argument("--dry-run", action="store_true", help="API 호출·점수 계산만 하고 파일은 쓰지 않음")
    parser.add_argument("--check", action="store_true", help="API 호출 없이 현재 관계의 랭킹 준비 상태만 확인")
    args = parser.parse_args(argv)
    if not -1 <= args.badge_threshold <= 1:
        print("오류: --badge-threshold는 -1~1이어야 합니다", file=sys.stderr)
        return 2
    try:
        version, works, places = load_inputs()
        relation_reasons = load_relations()
        if args.check:
            assert_snapshot_coverage(read_json(OUTPUT_PATH), version, relation_reasons)
            print(f"랭킹 준비 완료: 검증 관계 {len(relation_reasons)}건")
            return 0
        key = api_key or load_api_key()
        if not key:
            raise PipelineError("오프라인 실행 환경에 OPENAI_API_KEY가 필요합니다")
        work_ids, place_ids = sorted(works), sorted(places)
        texts = [works[item_id] for item_id in work_ids] + [places[item_id] for item_id in place_ids]
        total_chars = sum(map(len, texts))
        if len(texts) > MAX_INPUTS or total_chars > MAX_TOTAL_CHARS:
            raise PipelineError(
                f"호출 비용 상한 초과: inputs={len(texts)}/{MAX_INPUTS}, chars={total_chars}/{MAX_TOTAL_CHARS}",
            )
        vectors, prompt_tokens = request_embeddings(key, args.model, texts)
        generated_at = datetime.now(timezone(timedelta(hours=9))).isoformat(timespec="seconds")
        previous_snapshot = read_json(OUTPUT_PATH) if OUTPUT_PATH.exists() else None
        snapshot = build_snapshot(
            args.model, version, work_ids, place_ids, vectors, args.badge_threshold, generated_at,
            relation_reasons, previous_snapshot if isinstance(previous_snapshot, dict) else None,
        )
        assert_snapshot_coverage(snapshot, version, relation_reasons)
    except PipelineError as error:
        print(f"실패: {error}", file=sys.stderr)
        print("기존 스냅샷은 변경하지 않았습니다", file=sys.stderr)
        return 1

    scores = [item["score"] for item in snapshot["rankings"]]
    print(f"모델 {args.model} · 입력 {len(texts)}개/{total_chars}자 · API 사용 {prompt_tokens}토큰")
    print(f"검증 작품×장소 {len(snapshot['rankings'])}쌍 · 점수 {min(scores):.4f}~{max(scores):.4f}")
    if args.dry_run:
        print("--dry-run: 파일을 쓰지 않았습니다")
        return 0

    if OUTPUT_PATH.exists():
        OUTPUT_PATH.with_suffix(".json.bak").write_text(OUTPUT_PATH.read_text(encoding="utf-8"), encoding="utf-8")
    OUTPUT_PATH.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"기록 완료: {OUTPUT_PATH}")
    print("정상 관계는 자동 활성화했습니다. 파이프라인이 중단한 예외만 사람이 검토하세요")
    return 0


def main() -> int:
    return main_with_args(sys.argv[1:])


if __name__ == "__main__":
    raise SystemExit(main())
