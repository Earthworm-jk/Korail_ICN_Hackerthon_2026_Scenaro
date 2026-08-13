#!/usr/bin/env python3
"""작품×촬영지 대표성 AI 제안 스냅샷 생성기 (오프라인 전용).

검증된 시드의 장면·추천 사유만 OpenAI에 전달해 등급 제안을 만들고, 규칙 검증을
통과한 결과를 별도 스냅샷에 기록한다. 제안은 항상 사람 검토가 필요하며 런타임은
`work-place-relations.json`에 명시적으로 승인된 값만 사용한다.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
WORKS_PATH = REPO_ROOT / "data" / "works.json"
PLACES_PATH = REPO_ROOT / "data" / "places.json"
RELATIONS_PATH = REPO_ROOT / "data" / "work-place-relations.json"
OUTPUT_PATH = REPO_ROOT / "data" / "place-representativeness-proposals.json"

OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses"
DEFAULT_MODEL = "gpt-5.6-luna"
INPUT_RULE_VERSION = "v1"
LEVELS = {"iconic", "major", "standard", "insufficient"}
CONFIDENCES = {"high", "medium", "low"}
MAX_RELATIONS = 100
MAX_INPUT_CHARS = 100_000


class PipelineError(RuntimeError):
    pass


def read_json(path: Path) -> object:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise PipelineError(f"JSON 읽기 실패: {path}: {error}") from error


def load_api_key() -> str:
    key = os.environ.get("OPENAI_API_KEY", "").strip()
    if key:
        return key
    env_path = REPO_ROOT / ".env.local"
    if not env_path.exists():
        return ""
    for line in env_path.read_text(encoding="utf-8").splitlines():
        if line.startswith("OPENAI_API_KEY="):
            return line.split("=", 1)[1].strip().strip("\"'")
    return ""


def _index(items: object, kind: str) -> dict[str, dict[str, Any]]:
    if not isinstance(items, list):
        raise PipelineError(f"{kind} 시드는 배열이어야 합니다")
    result: dict[str, dict[str, Any]] = {}
    for index, item in enumerate(items):
        if not isinstance(item, dict) or not isinstance(item.get("id"), str) or not item["id"]:
            raise PipelineError(f"{kind}[{index}].id가 비어 있습니다")
        if item["id"] in result:
            raise PipelineError(f"중복 {kind} ID: {item['id']}")
        result[item["id"]] = item
    return result


def load_inputs(
    works_path: Path = WORKS_PATH,
    places_path: Path = PLACES_PATH,
    relations_path: Path = RELATIONS_PATH,
) -> list[dict[str, Any]]:
    works = _index(read_json(works_path), "works")
    places = _index(read_json(places_path), "places")
    raw_relations = read_json(relations_path)
    if not isinstance(raw_relations, list):
        raise PipelineError("작품–장소 관계 시드는 배열이어야 합니다")

    result: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for index, relation in enumerate(raw_relations):
        if not isinstance(relation, dict):
            raise PipelineError(f"relations[{index}]는 객체여야 합니다")
        work_id, place_id = relation.get("workId"), relation.get("placeId")
        if not isinstance(work_id, str) or work_id not in works:
            raise PipelineError(f"relations[{index}]의 알 수 없는 workId: {work_id}")
        if not isinstance(place_id, str) or place_id not in places:
            raise PipelineError(f"relations[{index}]의 알 수 없는 placeId: {place_id}")
        pair = (work_id, place_id)
        if pair in seen:
            raise PipelineError(f"중복 관계: {work_id}|{place_id}")
        seen.add(pair)
        if relation.get("reviewed") is not True:
            raise PipelineError(f"미검토 관계는 제안할 수 없습니다: {work_id}|{place_id}")
        scene_note = relation.get("sceneNote")
        reason_text = places[place_id].get("reasonText")
        source_urls = relation.get("sourceUrls")
        if not isinstance(scene_note, dict) or not all(isinstance(scene_note.get(x), str) and scene_note[x].strip() for x in ("ko", "en")):
            raise PipelineError(f"장면 설명 ko/en 누락: {work_id}|{place_id}")
        if not isinstance(reason_text, dict) or not all(isinstance(reason_text.get(x), str) and reason_text[x].strip() for x in ("ko", "en")):
            raise PipelineError(f"장소 추천 사유 ko/en 누락: {place_id}")
        if not isinstance(source_urls, list) or not source_urls or not all(isinstance(url, str) and url for url in source_urls):
            raise PipelineError(f"관계 출처 누락: {work_id}|{place_id}")
        result.append({
            "workId": work_id,
            "workTitle": works[work_id]["title"],
            "placeId": place_id,
            "placeName": places[place_id]["name"],
            "sceneNote": scene_note,
            "reasonText": reason_text,
            "sourceUrls": source_urls,
            "officialSourceCount": places[place_id].get("officialSourceCount", 0),
        })
    if len(result) > MAX_RELATIONS:
        raise PipelineError(f"호출 비용 상한 초과: relations={len(result)}/{MAX_RELATIONS}")
    return sorted(result, key=lambda item: (item["workId"], item["placeId"]))


def input_digest(inputs: list[dict[str, Any]]) -> str:
    canonical = json.dumps(inputs, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


PROPOSAL_ITEM_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "workId", "placeId", "level", "confidence", "evidenceSourceUrls",
        "evidenceSummary", "rationale", "requiresHumanReview",
    ],
    "properties": {
        "workId": {"type": "string", "minLength": 1},
        "placeId": {"type": "string", "minLength": 1},
        "level": {"type": "string", "enum": sorted(LEVELS)},
        "confidence": {"type": "string", "enum": sorted(CONFIDENCES)},
        "evidenceSourceUrls": {"type": "array", "minItems": 1, "items": {"type": "string"}},
        "evidenceSummary": {"type": "string", "minLength": 1},
        "rationale": {"type": "string", "minLength": 1},
        "requiresHumanReview": {"type": "boolean", "const": True},
    },
}

RESPONSE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["proposals"],
    "properties": {
        "proposals": {"type": "array", "items": PROPOSAL_ITEM_SCHEMA},
    },
}


def build_request(model: str, inputs: list[dict[str, Any]]) -> dict[str, Any]:
    system = (
        "You classify how representative a verified filming location is for one specific work. "
        "Use only the supplied verified scene note, place reason, and source URL list; never use outside memory. "
        "Representativeness is not general popularity. iconic requires explicit representative, symbolic, famous, "
        "signature, or defining-scene evidence. major means narratively important but not demonstrably iconic; "
        "standard means a verified ordinary filming location; insufficient means the supplied text cannot support a grade. "
        "Cite only URLs supplied for that same relation. Every row requires human review. Return exactly one row per input."
    )
    return {
        "model": model,
        "instructions": system,
        "input": json.dumps({"relations": inputs}, ensure_ascii=False, separators=(",", ":")),
        "text": {
            "format": {
                "type": "json_schema",
                "name": "place_representativeness_proposals",
                "strict": True,
                "schema": RESPONSE_SCHEMA,
            },
        },
    }


def _extract_output_text(payload: object) -> str:
    if not isinstance(payload, dict):
        raise PipelineError("Responses API 응답이 객체가 아닙니다")
    if isinstance(payload.get("output_text"), str) and payload["output_text"].strip():
        return payload["output_text"]
    texts: list[str] = []
    output = payload.get("output")
    if isinstance(output, list):
        for item in output:
            if not isinstance(item, dict) or item.get("type") != "message":
                continue
            content = item.get("content")
            if not isinstance(content, list):
                continue
            for part in content:
                if isinstance(part, dict) and part.get("type") == "output_text" and isinstance(part.get("text"), str):
                    texts.append(part["text"])
    if not texts:
        raise PipelineError("Responses API 응답에 output_text가 없습니다")
    return "".join(texts)


def request_proposals(api_key: str, model: str, inputs: list[dict[str, Any]], timeout: float = 120.0) -> tuple[list[dict[str, Any]], dict[str, int]]:
    body = json.dumps(build_request(model, inputs), ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        OPENAI_RESPONSES_URL,
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
    try:
        parsed = json.loads(_extract_output_text(payload))
    except json.JSONDecodeError as error:
        raise PipelineError(f"Structured Output JSON 파싱 실패: {error}") from error
    proposals = parsed.get("proposals") if isinstance(parsed, dict) else None
    if not isinstance(proposals, list):
        raise PipelineError("Structured Output에 proposals 배열이 없습니다")
    usage = payload.get("usage", {}) if isinstance(payload, dict) else {}
    token_usage = {
        key: int(usage.get(key, 0)) if isinstance(usage, dict) and isinstance(usage.get(key, 0), int) else 0
        for key in ("input_tokens", "output_tokens", "total_tokens")
    }
    return proposals, token_usage


def validate_proposals(proposals: object, inputs: list[dict[str, Any]]) -> None:
    if not isinstance(proposals, list):
        raise PipelineError("proposals는 배열이어야 합니다")
    expected = {(item["workId"], item["placeId"]): item for item in inputs}
    actual: set[tuple[str, str]] = set()
    required = set(PROPOSAL_ITEM_SCHEMA["required"])
    for index, item in enumerate(proposals):
        if not isinstance(item, dict):
            raise PipelineError(f"proposals[{index}]는 객체여야 합니다")
        if set(item) != required:
            raise PipelineError(f"proposals[{index}] 필드 불일치: {sorted(set(item) ^ required)}")
        pair = (item.get("workId"), item.get("placeId"))
        if pair not in expected:
            raise PipelineError(f"알 수 없는 제안 관계: {pair[0]}|{pair[1]}")
        if pair in actual:
            raise PipelineError(f"중복 제안 관계: {pair[0]}|{pair[1]}")
        actual.add(pair)  # type: ignore[arg-type]
        if item.get("level") not in LEVELS or item.get("confidence") not in CONFIDENCES:
            raise PipelineError(f"제안 등급/신뢰도 오류: {pair[0]}|{pair[1]}")
        urls = item.get("evidenceSourceUrls")
        allowed = set(expected[pair]["sourceUrls"])  # type: ignore[index]
        if not isinstance(urls, list) or not urls or not all(isinstance(url, str) and url in allowed for url in urls):
            raise PipelineError(f"제안 근거 URL이 관계 출처의 부분집합이 아닙니다: {pair[0]}|{pair[1]}")
        if not all(isinstance(item.get(key), str) and item[key].strip() for key in ("evidenceSummary", "rationale")):
            raise PipelineError(f"제안 근거 요약/판단 사유 누락: {pair[0]}|{pair[1]}")
        if item.get("requiresHumanReview") is not True:
            raise PipelineError(f"AI 제안은 항상 사람 검토가 필요합니다: {pair[0]}|{pair[1]}")
    if actual != set(expected):
        missing = sorted(f"{work}|{place}" for work, place in set(expected) - actual)
        raise PipelineError(f"제안 관계 누락: {missing}")


def validate_snapshot(snapshot: object, inputs: list[dict[str, Any]], relations: object | None = None) -> None:
    if not isinstance(snapshot, dict) or not isinstance(snapshot.get("meta"), dict):
        raise PipelineError("대표성 제안 스냅샷 meta가 없습니다")
    meta = snapshot["meta"]
    if meta.get("inputRuleVersion") != INPUT_RULE_VERSION:
        raise PipelineError("대표성 입력 규칙 버전이 다릅니다")
    if meta.get("inputDigest") != input_digest(inputs):
        raise PipelineError("대표성 입력 digest가 현재 시드와 다릅니다")
    if not all(isinstance(meta.get(key), str) and meta[key] for key in ("model", "generatedAt")):
        raise PipelineError("대표성 제안 모델/생성시각이 없습니다")
    validate_proposals(snapshot.get("proposals"), inputs)
    if relations is not None:
        validate_approvals(relations, snapshot)


def validate_approvals(relations: object, snapshot: dict[str, Any]) -> None:
    if not isinstance(relations, list):
        raise PipelineError("작품–장소 관계 시드는 배열이어야 합니다")
    proposals = {(item["workId"], item["placeId"]): item for item in snapshot["proposals"]}
    meta = snapshot["meta"]
    for relation in relations:
        if not isinstance(relation, dict):
            continue
        approval = relation.get("representativeness")
        if not isinstance(approval, dict) or approval.get("method") != "openai_assisted":
            continue
        pair = (relation.get("workId"), relation.get("placeId"))
        proposal = proposals.get(pair)
        if proposal is None:
            raise PipelineError(f"승인에 대응하는 AI 제안 없음: {pair[0]}|{pair[1]}")
        expected = {
            "level": proposal["level"],
            "evidenceSourceUrls": proposal["evidenceSourceUrls"],
            "proposalModel": meta["model"],
            "proposalGeneratedAt": meta["generatedAt"],
            "proposalInputDigest": meta["inputDigest"],
        }
        for key, value in expected.items():
            if approval.get(key) != value:
                raise PipelineError(f"AI 제안과 승인 불일치: {pair[0]}|{pair[1]} field={key}")
        if not isinstance(approval.get("approvedBy"), str) or not approval["approvedBy"].strip():
            raise PipelineError(f"승인자 누락: {pair[0]}|{pair[1]}")
        if not isinstance(approval.get("approvedAt"), str) or not approval["approvedAt"]:
            raise PipelineError(f"승인일 누락: {pair[0]}|{pair[1]}")


def main_with_args(argv: list[str], api_key: str | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--dry-run", action="store_true", help="API 호출·검증만 하고 파일은 쓰지 않음")
    parser.add_argument("--check", action="store_true", help="API 호출 없이 스냅샷·승인 정합성 확인")
    args = parser.parse_args(argv)
    try:
        inputs = load_inputs()
        total_chars = len(json.dumps(inputs, ensure_ascii=False))
        if total_chars > MAX_INPUT_CHARS:
            raise PipelineError(f"호출 비용 상한 초과: chars={total_chars}/{MAX_INPUT_CHARS}")
        relations = read_json(RELATIONS_PATH)
        if args.check:
            validate_snapshot(read_json(OUTPUT_PATH), inputs, relations)
            print(f"대표성 제안 준비 완료: 관계 {len(inputs)}건 · 승인 정합성 확인")
            return 0
        key = api_key or load_api_key()
        if not key:
            raise PipelineError("오프라인 실행 환경에 OPENAI_API_KEY가 필요합니다")
        proposals, usage = request_proposals(key, args.model, inputs)
        validate_proposals(proposals, inputs)
        snapshot = {
            "meta": {
                "model": args.model,
                "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
                "inputRuleVersion": INPUT_RULE_VERSION,
                "inputDigest": input_digest(inputs),
            },
            "proposals": sorted(proposals, key=lambda item: (item["workId"], item["placeId"])),
        }
        validate_snapshot(snapshot, inputs)
    except PipelineError as error:
        print(f"실패: {error}", file=sys.stderr)
        print("기존 대표성 제안 스냅샷은 변경하지 않았습니다", file=sys.stderr)
        return 1
    print(f"모델 {args.model} · 관계 {len(inputs)}건/{total_chars}자 · 토큰 {usage['total_tokens']}")
    if args.dry_run:
        print("--dry-run: 파일을 쓰지 않았습니다")
        return 0
    OUTPUT_PATH.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"제안 기록 완료: {OUTPUT_PATH}")
    print("런타임 반영에는 work-place-relations.json의 별도 사람 승인이 필요합니다")
    return 0


def main() -> int:
    return main_with_args(sys.argv[1:])


if __name__ == "__main__":
    raise SystemExit(main())
