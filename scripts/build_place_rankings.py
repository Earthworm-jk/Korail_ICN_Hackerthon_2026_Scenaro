#!/usr/bin/env python3
"""#48 촬영지 관련성 랭킹 스냅샷 생성기 (오프라인 전용).

`OPENAI_API_KEY`로 Embeddings API를 한 번 호출해 작품×촬영지 코사인 유사도를
계산한다. 생성 결과는 모두 미검토 상태이며, 사람이 점수·근거를 검토한 항목만
`reviewed: true`와 `reason`을 추가해 런타임 정렬에 사용한다.
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

OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings"
DEFAULT_MODEL = "text-embedding-3-small"
DEFAULT_BADGE_THRESHOLD = 0.25
MAX_INPUTS = 100
MAX_TOTAL_CHARS = 50_000


class PipelineError(RuntimeError):
    pass


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
) -> dict:
    work_vectors = dict(zip(work_ids, vectors[:len(work_ids)]))
    place_vectors = dict(zip(place_ids, vectors[len(work_ids):]))
    rankings = [
        {
            "workId": work_id,
            "placeId": place_id,
            "score": round(cosine_similarity(work_vectors[work_id], place_vectors[place_id]), 6),
            "reviewed": False,
        }
        for work_id in work_ids
        for place_id in place_ids
    ]
    return {
        "meta": {
            "model": model,
            "inputRuleVersion": input_rule_version,
            "generatedAt": generated_at,
            "badgeThreshold": badge_threshold,
        },
        "rankings": rankings,
    }


def main_with_args(argv: list[str], api_key: str | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--badge-threshold", type=float, default=DEFAULT_BADGE_THRESHOLD)
    parser.add_argument("--dry-run", action="store_true", help="API 호출·점수 계산만 하고 파일은 쓰지 않음")
    args = parser.parse_args(argv)
    if not -1 <= args.badge_threshold <= 1:
        print("오류: --badge-threshold는 -1~1이어야 합니다", file=sys.stderr)
        return 2
    key = api_key or os.environ.get("OPENAI_API_KEY", "")
    if not key:
        print("오류: 오프라인 실행 환경에 OPENAI_API_KEY가 필요합니다", file=sys.stderr)
        return 2

    try:
        version, works, places = load_inputs()
        work_ids, place_ids = sorted(works), sorted(places)
        texts = [works[item_id] for item_id in work_ids] + [places[item_id] for item_id in place_ids]
        total_chars = sum(map(len, texts))
        if len(texts) > MAX_INPUTS or total_chars > MAX_TOTAL_CHARS:
            raise PipelineError(
                f"호출 비용 상한 초과: inputs={len(texts)}/{MAX_INPUTS}, chars={total_chars}/{MAX_TOTAL_CHARS}",
            )
        vectors, prompt_tokens = request_embeddings(key, args.model, texts)
        generated_at = datetime.now(timezone(timedelta(hours=9))).isoformat(timespec="seconds")
        snapshot = build_snapshot(
            args.model, version, work_ids, place_ids, vectors, args.badge_threshold, generated_at,
        )
    except PipelineError as error:
        print(f"실패: {error}", file=sys.stderr)
        print("기존 스냅샷은 변경하지 않았습니다", file=sys.stderr)
        return 1

    scores = [item["score"] for item in snapshot["rankings"]]
    print(f"모델 {args.model} · 입력 {len(texts)}개/{total_chars}자 · API 사용 {prompt_tokens}토큰")
    print(f"작품×장소 {len(snapshot['rankings'])}쌍 · 점수 {min(scores):.4f}~{max(scores):.4f}")
    if args.dry_run:
        print("--dry-run: 파일을 쓰지 않았습니다")
        return 0

    if OUTPUT_PATH.exists():
        OUTPUT_PATH.with_suffix(".json.bak").write_text(OUTPUT_PATH.read_text(encoding="utf-8"), encoding="utf-8")
    OUTPUT_PATH.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"기록 완료: {OUTPUT_PATH}")
    print("다음 단계: 점수 분포·근거를 사람이 검토한 뒤 reviewed/reason을 확정하세요")
    return 0


def main() -> int:
    return main_with_args(sys.argv[1:])


if __name__ == "__main__":
    raise SystemExit(main())
