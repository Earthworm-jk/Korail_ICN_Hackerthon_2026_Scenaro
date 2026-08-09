"""공식 체류시간 HTML의 인용이 유지되는지 확인한다.

이 도구는 경보 전용이다. 외부 원문이 바뀌어도 places.json을 수정하지 않는다.
실행: python3 scripts/verify_stay_sources.py
"""
from __future__ import annotations

import html
import json
import sys
import unicodedata
from html.parser import HTMLParser
from pathlib import Path
from typing import Callable
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
PLACES_PATH = ROOT / "data" / "places.json"


class TextExtractor(HTMLParser):
    """script/style을 제외한 화면 텍스트를 순서대로 모은다."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.ignored_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        del attrs
        if tag.lower() in {"script", "style", "noscript"}:
            self.ignored_depth += 1

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() in {"script", "style", "noscript"} and self.ignored_depth:
            self.ignored_depth -= 1

    def handle_data(self, data: str) -> None:
        if not self.ignored_depth:
            self.parts.append(data)


def normalize_text(value: str) -> str:
    """태그 경계·전각 문자 차이를 무시하되 문구 자체의 변경은 감지한다."""
    normalized = unicodedata.normalize("NFKC", html.unescape(value))
    return "".join(normalized.split())


def extract_text(document: str) -> str:
    parser = TextExtractor()
    parser.feed(document)
    parser.close()
    return " ".join(parser.parts)


def fetch_html(url: str, timeout: float = 15.0) -> str:
    request = Request(
        url,
        headers={
            "User-Agent": "ScenaroStaySourceMonitor/1.0 (+GitHub Actions)",
            "Accept": "text/html,application/xhtml+xml",
            "Accept-Encoding": "identity",
        },
    )
    with urlopen(request, timeout=timeout) as response:  # noqa: S310 — 시드의 검증된 http(s) URL
        content_type = response.headers.get_content_type()
        if content_type not in {"text/html", "application/xhtml+xml"}:
            raise ValueError(f"HTML이 아닌 응답: {content_type}")
        charset = response.headers.get_content_charset() or "utf-8"
        return response.read().decode(charset, errors="replace")


def official_source_places(places: list[dict]) -> list[dict]:
    return [
        place
        for place in places
        if place.get("stayMetadata", {}).get("basis") == "official_source"
    ]


def verify_places(
    places: list[dict],
    fetcher: Callable[[str], str] = fetch_html,
) -> tuple[list[str], list[str]]:
    verified: list[str] = []
    errors: list[str] = []
    for place in official_source_places(places):
        place_id = place.get("id", "<unknown>")
        metadata = place["stayMetadata"]
        if metadata.get("sourceFormat") != "html":
            errors.append(f"{place_id}: 지원하지 않는 sourceFormat")
            continue
        try:
            source_text = normalize_text(extract_text(fetcher(metadata["source"])))
            quote = normalize_text(metadata["sourceQuote"])
            if not quote or quote not in source_text:
                errors.append(
                    f"{place_id}: 인용을 찾을 수 없음 "
                    f"({metadata['sourceLocator']}; {metadata['source']})"
                )
                continue
            verified.append(place_id)
        except Exception as exc:  # URL별 실패를 모아 한 번에 보고한다.
            errors.append(f"{place_id}: 원문 확인 실패 ({metadata.get('source')}): {exc}")
    return verified, errors


def main() -> int:
    places = json.loads(PLACES_PATH.read_text(encoding="utf-8"))
    verified, errors = verify_places(places)
    for place_id in verified:
        print(f"verified: {place_id}")
    for error in errors:
        print(f"ERROR: {error}", file=sys.stderr)
    if errors:
        print("외부 원문 변경 가능성 — 운영값은 자동 변경하지 말고 사람이 재검토하세요.", file=sys.stderr)
        return 1
    print(f"공식 체류시간 원문 {len(verified)}건 확인 완료")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
