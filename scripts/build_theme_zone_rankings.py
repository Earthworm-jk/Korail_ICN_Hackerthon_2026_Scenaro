#!/usr/bin/env python3
"""#80 테마체험 권역 관련성 랭킹 스냅샷 생성기 (오프라인 전용).

`OPENAI_API_KEY`로 Embeddings API를 한 번 호출해 작품×테마권역 코사인 유사도를
계산한다. 생성 결과는 모두 미검토 상태이며, 사람이 점수·근거를 검토한 항목만
`reviewed: true`와 `reason`·`sourceUrls`(작품 서사 연결 근거)를 추가해 런타임에 사용한다.

작품 설명문은 `data/place-ranking-inputs.json`을 재사용한다 — 같은 작품을 두 곳에
다르게 적어 두면 설명이 어긋나므로 단일 원본을 유지한다 (#48 입력 규칙 공유).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from scripts.build_place_rankings import (
    DEFAULT_MODEL,
    MAX_INPUTS,
    MAX_TOTAL_CHARS,
    PipelineError,
    _validated_texts,
    cosine_similarity,
    read_json,
    request_embeddings,
)

REPO_ROOT = Path(__file__).resolve().parent.parent
WORK_INPUT_PATH = REPO_ROOT / "data" / "place-ranking-inputs.json"
ZONE_INPUT_PATH = REPO_ROOT / "data" / "theme-zone-ranking-inputs.json"
OUTPUT_PATH = REPO_ROOT / "data" / "theme-zone-rankings.json"
WORKS_PATH = REPO_ROOT / "data" / "works.json"
ZONES_PATH = REPO_ROOT / "data" / "theme-zones.json"

# #80 확정: 기존 place-rankings.json과 같은 하한을 먼저 고정하고 결과를 받는다.
# 결과를 본 뒤 하한을 조정하지 않는다 — 카드가 뜨도록 임계값을 맞추는 것을 막기 위해서다.
DEFAULT_BADGE_THRESHOLD = 0.25


def load_inputs(
    work_input_path: Path = WORK_INPUT_PATH,
    zone_input_path: Path = ZONE_INPUT_PATH,
) -> tuple[str, dict[str, str], dict[str, str]]:
    work_raw = read_json(work_input_path)
    zone_raw = read_json(zone_input_path)
    if not isinstance(work_raw, dict) or not isinstance(zone_raw, dict):
        raise PipelineError("랭킹 입력 파일은 객체여야 합니다")

    version = zone_raw.get("inputRuleVersion")
    if not isinstance(version, str) or not version:
        raise PipelineError("inputRuleVersion이 필요합니다")
    work_version = work_raw.get("inputRuleVersion")
    if work_version != version:
        raise PipelineError(
            f"입력 규칙 버전 불일치: 작품 {work_version!r} vs 권역 {version!r}",
        )

    works = _validated_texts(work_raw.get("works"), "workId", "works")
    zones = _validated_texts(zone_raw.get("zones"), "zoneId", "zones")

    expected_works = {item["id"] for item in read_json(WORKS_PATH)}  # type: ignore[index]
    expected_zones = {item["id"] for item in read_json(ZONES_PATH)}  # type: ignore[index]
    if set(works) != expected_works:
        raise PipelineError(
            f"작품 입력 ID 불일치: 누락={sorted(expected_works - set(works))}, 초과={sorted(set(works) - expected_works)}",
        )
    if set(zones) != expected_zones:
        raise PipelineError(
            f"권역 입력 ID 불일치: 누락={sorted(expected_zones - set(zones))}, 초과={sorted(set(zones) - expected_zones)}",
        )
    return version, works, zones


def build_snapshot(
    model: str,
    input_rule_version: str,
    work_ids: list[str],
    zone_ids: list[str],
    vectors: list[list[float]],
    badge_threshold: float,
    generated_at: str,
) -> dict:
    work_vectors = dict(zip(work_ids, vectors[: len(work_ids)]))
    zone_vectors = dict(zip(zone_ids, vectors[len(work_ids) :]))
    rankings = [
        {
            "workId": work_id,
            "zoneId": zone_id,
            "score": round(cosine_similarity(work_vectors[work_id], zone_vectors[zone_id]), 6),
            "reviewed": False,
        }
        for work_id in work_ids
        for zone_id in zone_ids
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
        version, works, zones = load_inputs()
        work_ids, zone_ids = sorted(works), sorted(zones)
        texts = [works[item_id] for item_id in work_ids] + [zones[item_id] for item_id in zone_ids]
        total_chars = sum(map(len, texts))
        if len(texts) > MAX_INPUTS or total_chars > MAX_TOTAL_CHARS:
            raise PipelineError(
                f"호출 비용 상한 초과: inputs={len(texts)}/{MAX_INPUTS}, chars={total_chars}/{MAX_TOTAL_CHARS}",
            )
        vectors, prompt_tokens = request_embeddings(key, args.model, texts)
        generated_at = datetime.now(timezone(timedelta(hours=9))).isoformat(timespec="seconds")
        snapshot = build_snapshot(
            args.model, version, work_ids, zone_ids, vectors, args.badge_threshold, generated_at,
        )
    except PipelineError as error:
        print(f"실패: {error}", file=sys.stderr)
        print("기존 스냅샷은 변경하지 않았습니다", file=sys.stderr)
        return 1

    scores = [item["score"] for item in snapshot["rankings"]]
    print(f"모델 {args.model} · 입력 {len(texts)}개/{total_chars}자 · API 사용 {prompt_tokens}토큰")
    print(f"작품×권역 {len(snapshot['rankings'])}쌍 · 점수 {min(scores):.4f}-{max(scores):.4f}")
    for item in sorted(snapshot["rankings"], key=lambda row: -row["score"]):
        mark = "통과" if item["score"] >= args.badge_threshold else "미달"
        print(f"  {mark} {item['score']:.4f} {item['workId']} × {item['zoneId']}")
    if args.dry_run:
        print("--dry-run: 파일을 쓰지 않았습니다")
        return 0

    if OUTPUT_PATH.exists():
        OUTPUT_PATH.with_suffix(".json.bak").write_text(
            OUTPUT_PATH.read_text(encoding="utf-8"), encoding="utf-8",
        )
    OUTPUT_PATH.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"기록 완료: {OUTPUT_PATH}")
    print("다음 단계: 점수·근거 2종을 사람이 검토한 뒤 reviewed/reason/sourceUrls를 확정하세요")
    return 0


def main() -> int:
    return main_with_args(sys.argv[1:])


if __name__ == "__main__":
    raise SystemExit(main())
