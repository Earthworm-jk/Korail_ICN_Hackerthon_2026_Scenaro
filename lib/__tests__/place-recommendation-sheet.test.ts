import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  PlaceRecommendationSheet,
  PlaceThumbnail,
} from "../../app/place-recommendation-sheet";
import type { MessageKey } from "../i18n/messages";

const copy: Partial<Record<MessageKey, string>> = {
  "step3.sheetTitle": "지도 위 추천 장소",
  "step3.sheetSubtitle": "장소를 고르면 일정과 경로가 함께 바뀝니다.",
  "step3.sheetCollapse": "접기",
  "step3.sheetExpand": "추천 장소 펼치기",
  "step3.selectedCount": "{selected}/{total}곳 선택",
  "step3.routeUpdating": "일정·경로 다시 그리는 중",
  "step3.routeUpdated": "새 일정·경로 반영 완료",
  "step3.sortRelevance": "관련성순",
  "step3.sortOfficial": "공식 출처순",
  "step3.showMore": "더보기 ({n}곳)",
  "map.placesTitle": "추천 장소 지도",
  "common.back": "이전",
};

const tr = (key: MessageKey) => copy[key] ?? key;

describe("지도 위 추천 장소 바텀시트", () => {
  it("선택 수, 정렬, 카드, 지도 대체 경로를 하나의 시트에 제공한다", () => {
    const markup = renderToStaticMarkup(createElement(PlaceRecommendationSheet, {
      selectedCount: 3,
      totalCount: 8,
      updating: false,
      updated: false,
      sortBy: "relevance",
      onSortChange: () => undefined,
      remainingCount: 3,
      onShowMore: () => undefined,
      onBack: () => undefined,
      map: createElement("div", { "data-test-map": true }, "map"),
      tr,
    }, createElement("li", { "data-recommendation-card": true }, "월정사")));

    expect(markup).toContain("data-place-sheet");
    expect(markup).toContain('data-sheet-expanded="true"');
    expect(markup).toContain("지도 위 추천 장소");
    expect(markup).not.toContain("장소를 고르면 일정과 경로가 함께 바뀝니다.");
    expect(markup).toContain("3/8곳 선택");
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain("더보기 (3곳)");
    expect(markup).toContain("data-test-map");
    const listStart = markup.indexOf("data-place-sheet-list");
    const listEnd = markup.indexOf("</ul>", listStart);
    const moreItem = markup.indexOf("data-place-sheet-more");
    expect(moreItem).toBeGreaterThan(listStart);
    expect(moreItem).toBeLessThan(listEnd);
  });

  it("재계산 중에도 선택 수를 유지하며 일정과 경로가 함께 갱신됨을 알린다", () => {
    const markup = renderToStaticMarkup(createElement(PlaceRecommendationSheet, {
      selectedCount: 2,
      totalCount: 8,
      updating: true,
      updated: false,
      sortBy: "official",
      onSortChange: () => undefined,
      remainingCount: 0,
      onShowMore: () => undefined,
      onBack: () => undefined,
      map: null,
      tr,
    }));

    expect(markup).toContain("일정·경로 다시 그리는 중");
    expect(markup).toContain("2/8곳 선택");
  });

  it("실제 일정이 변경된 뒤에도 선택 수와 반영 완료 상태를 함께 보여준다", () => {
    const markup = renderToStaticMarkup(createElement(PlaceRecommendationSheet, {
      selectedCount: 2,
      totalCount: 8,
      updating: false,
      updated: true,
      sortBy: "official",
      onSortChange: () => undefined,
      remainingCount: 0,
      onShowMore: () => undefined,
      onBack: () => undefined,
      map: null,
      tr,
    }));

    expect(markup).toContain("2/8곳 선택");
    expect(markup).toContain("새 일정·경로 반영 완료");
  });

  it("실제 사진이 없는 카드에 공통 플레이스홀더임을 명시한다", () => {
    const markup = renderToStaticMarkup(createElement(
      PlaceThumbnail,
      { label: "장소 이미지 준비 중" },
      "placeholder",
    ));

    expect(markup).toContain("data-place-thumbnail");
    expect(markup).toContain('role="img"');
    expect(markup).toContain('aria-label="장소 이미지 준비 중"');
    expect(markup).not.toContain(">장소 이미지 준비 중<");
  });

  it("검증된 사진은 장소 설명과 제1유형 원본 링크를 함께 제공한다", () => {
    const markup = renderToStaticMarkup(createElement(PlaceThumbnail, {
      label: "장소 이미지 준비 중",
      locale: "ko",
      photo: {
        src: "/place-photos/place-woljeongsa-temple.jpg",
        alt: { ko: "월정사의 전각과 석등", en: "Temple halls at Woljeongsa" },
        provider: "한국관광공사 TourAPI",
        sourcePlaceName: "월정사",
        sourceUrl: "https://tong.visitkorea.or.kr/cms/resource/54/3304054_image2_1.jpg",
        license: "공공누리 제1유형",
        licenseUrl: "https://www.kogl.or.kr/info/licenseType1.do",
        verifiedAt: "2026-08-10",
        verificationMethod: "TourAPI 이름·좌표 대조 후 이미지 육안 확인",
      },
    }));

    expect(markup).toContain("data-place-photo");
    expect(markup).toContain('alt="월정사의 전각과 석등"');
    expect(markup).toContain("KTO · KOGL 1");
    expect(markup).toContain("tong.visitkorea.or.kr");
    expect(markup).toContain("월정사 사진 원본 · 한국관광공사 TourAPI · 공공누리 제1유형");
    expect(markup).not.toContain('role="img"');
  });
});
