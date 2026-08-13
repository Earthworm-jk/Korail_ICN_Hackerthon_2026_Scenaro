import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  PlaceRecommendationSheet,
  PlaceThumbnail,
} from "../../app/place-recommendation-sheet";
import { PlaceBrowser } from "../../app/place-browser";
import type { MessageKey } from "../i18n/messages";

const copy: Partial<Record<MessageKey, string>> = {
  "step3.sheetTitle": "지도 위 추천 장소",
  "step3.sheetSubtitle": "장소를 고르면 일정과 경로가 함께 바뀝니다.",
  "step3.selectedCount": "{selected}/{total}곳 선택",
  "step3.routeUpdating": "일정·경로 다시 그리는 중",
  "step3.routeUpdated": "새 일정·경로 반영 완료",
  "step3.sortLabel": "장소 정렬 방식",
  "step3.sortRelevance": "추천순",
  "step3.sortOfficial": "공식 출처순",
  "step3.openBrowser": "전체 촬영지 보기",
  "step3.closeBrowser": "전체 촬영지 닫기",
  "step3.sheetCollapse": "추천 장소 접기",
  "step3.sheetExpand": "추천 장소 펼치기",
  "step3.browserTitle": "전체 촬영지",
  "step3.browserCount": "후보 {n}곳",
  "step3.browserEmpty": "이 조건에 맞는 후보가 없습니다.",
  "step3.filterRegion": "지역",
  "step3.filterContent": "콘텐츠",
  "step3.filterAll": "전체",
  "ai.recommendSheetTitle": "현재 동선에 맞는 촬영지",
  "ai.recommendSheetSubtitle": "추가 전에는 일정이 바뀌지 않습니다.",
  "map.placesTitle": "추천 장소 지도",
  "step3.selectionState": "선택 {selected} · 일정 반영 {placed} · 미배치 {unplaced}",
  "step3.unplacedHint": "시간·동선 제약",
  "step3.chipKCulture": "K-컬처 {n}",
  "step3.chipThemeNone": "테마체험 추천 없음",
  "step3.chipThemeAvailable": "테마체험 추천 있음",
  "common.back": "이전",
};

const tr = (key: MessageKey) => copy[key] ?? key;

describe("지도 위 추천 장소 바텀시트", () => {
  it("미리보기 없이 선택 수, 정렬, 전체 촬영지 진입을 제공한다", () => {
    const markup = renderToStaticMarkup(createElement(PlaceRecommendationSheet, {
      selectedCount: 3,
      totalCount: 8,
      placedCount: null,
      unplacedCount: null,
      themeState: "none" as const,
      updating: false,
      updated: false,
      sortBy: "relevance",
      onSortChange: () => undefined,
      onBrowseAll: () => undefined,
      tr,
    }, createElement("li", { "data-recommendation-card": true }, "월정사")));

    expect(markup).toContain("data-place-sheet");
    expect(markup).toContain('data-sheet-mode="browser-entry"');
    expect(markup).toContain('data-sheet-expanded="true"');
    expect(markup).toContain("지도 위 추천 장소");
    expect(markup).not.toContain("장소를 고르면 일정과 경로가 함께 바뀝니다.");
    expect(markup).toContain("3/8곳 선택");
    expect(markup).toContain('aria-label="장소 정렬 방식"');
    expect(markup).toContain('<option value="relevance" selected="">추천순</option>');
    expect(markup).not.toContain("data-place-sheet-controls");
    expect(markup).toContain("전체 촬영지 보기");
    expect(markup).toContain('aria-label="추천 장소 접기"');
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain("min-h-11");
    expect(markup).toContain('aria-haspopup="dialog"');
    expect(markup).toContain('aria-controls="place-browser-dialog"');
    // 5개 미리보기는 구현에서 제거한다 (#207). 호출부가 넘겨도 표시하지 않는다.
    expect(markup).not.toContain("월정사");
    expect(markup).not.toContain("data-place-sheet-list");
    expect(markup).not.toContain("data-place-sheet-more");
    // 시트 안 촬영지 위치 지도는 지웠다 (#146) — 화면의 동선 지도와 중복이었다
    expect(markup).not.toContain("data-place-sheet-map");
    // 독으로 옮겨 갈 주 액션 자리는 시트가 제공한다
    expect(markup).toContain('id="stage-sheet-actions"');
  });

  it("다시 계산 없이 하단 추천 독을 접고 펼칠 수 있다", () => {
    const markup = renderToStaticMarkup(createElement(PlaceRecommendationSheet, {
      selectedCount: 3,
      totalCount: 8,
      placedCount: 3,
      unplacedCount: 0,
      themeState: "none" as const,
      updating: false,
      updated: false,
      sortBy: "relevance" as const,
      onSortChange: () => undefined,
      onBrowseAll: () => undefined,
      initialExpanded: false,
      tr,
    }));

    expect(markup).toContain('data-sheet-expanded="false"');
    expect(markup).toContain("추천 장소 펼치기");
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain("min-h-11");
    expect(markup).not.toContain("전체 촬영지 보기");
    expect(markup).not.toContain('id="stage-sheet-actions"');
  });

  it("열린 전체 촬영지 모달 안에 명시적인 닫기 버튼을 제공한다", () => {
    const markup = renderToStaticMarkup(createElement(
      PlaceBrowser,
      {
        open: true,
        onClose: () => undefined,
        count: 1,
        stations: [{ id: "station-jinbu", label: "진부역" }],
        station: null,
        onStationChange: () => undefined,
        tr,
      },
      createElement("li", null, "월정사"),
    ));

    expect(markup).toContain('id="place-browser-dialog"');
    expect(markup).toContain("전체 촬영지 닫기");
    expect(markup).toContain("lucide-x");
    expect(markup).toContain("data-place-browser-toggle");
    expect(markup).toContain("data-place-browser-filters");
    expect(markup).toContain("지역");
    expect(markup).toContain("진부역");
    expect(markup).not.toContain("콘텐츠");
  });

  it("선택 작품이 둘 이상일 때만 콘텐츠 필터를 제공한다", () => {
    const markup = renderToStaticMarkup(createElement(PlaceBrowser, {
      open: true,
      onClose: () => undefined,
      count: 9,
      stations: [],
      station: null,
      onStationChange: () => undefined,
      works: [
        { id: "goblin", label: "도깨비" },
        { id: "the-king", label: "더 킹" },
      ],
      work: null,
      onWorkChange: () => undefined,
      tr,
    }));

    expect(markup).toContain("콘텐츠");
    expect(markup).toContain("도깨비");
    expect(markup).toContain("더 킹");
  });

  it("재계산 중에도 선택 수를 유지하며 일정과 경로가 함께 갱신됨을 알린다", () => {
    const markup = renderToStaticMarkup(createElement(PlaceRecommendationSheet, {
      selectedCount: 2,
      totalCount: 8,
      placedCount: null,
      unplacedCount: null,
      themeState: "none" as const,
      updating: true,
      updated: false,
      sortBy: "official",
      onSortChange: () => undefined,
      onBrowseAll: () => undefined,
      tr,
    }));

    expect(markup).toContain("일정·경로 다시 그리는 중");
    expect(markup).toContain("2/8곳 선택");
  });

  it("AI 동선 추천을 일반 후보보다 앞에서 별도 확인하게 한다", () => {
    const markup = renderToStaticMarkup(createElement(PlaceRecommendationSheet, {
      selectedCount: 2,
      totalCount: 8,
      placedCount: null,
      unplacedCount: null,
      themeState: "none" as const,
      updating: false,
      updated: false,
      sortBy: "relevance",
      onSortChange: () => undefined,
      onBrowseAll: () => undefined,
      routeRecommendations: createElement("li", { "data-route-card": true }, "영진해변"),
      tr,
    }));

    expect(markup).toContain("data-route-recommendations");
    expect(markup).toContain("현재 동선에 맞는 촬영지");
    expect(markup).toContain("추가 전에는 일정이 바뀌지 않습니다.");
    expect(markup).toContain("data-route-card");
  });

  it("실제 일정이 변경된 뒤에도 선택 수와 반영 완료 상태를 함께 보여준다", () => {
    const markup = renderToStaticMarkup(createElement(PlaceRecommendationSheet, {
      selectedCount: 2,
      totalCount: 8,
      placedCount: null,
      unplacedCount: null,
      themeState: "none" as const,
      updating: false,
      updated: true,
      sortBy: "official",
      onSortChange: () => undefined,
      onBrowseAll: () => undefined,
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
        kind: "kto",
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

  it("방송 장면 캡처는 배지 없이 깔리고 크레딧은 스크린리더에만 남는다", () => {
    const markup = renderToStaticMarkup(createElement(PlaceThumbnail, {
      label: "장소 이미지 준비 중",
      locale: "ko",
      photo: {
        kind: "scene_still",
        src: "/place-photos/scene-place-sinchon-mural-tunnel.jpg",
        alt: { ko: "터널을 걷는 두 사람", en: "Two characters walking through the tunnel" },
        broadcaster: "tvN",
        workTitle: { ko: "도깨비", en: "Guardian: The Lonely and Great God" },
        episodeLabel: "10화",
        rights: "방송사 저작물 — 시연용 인용",
        verifiedAt: "2026-08-14",
        verificationMethod: "캡처 화면 육안 확인 — 장소·작품 대조",
      },
    }));

    expect(markup).toContain("data-place-photo");
    // 사진 위에 배지를 얹지 않는다
    expect(markup).not.toContain("thumbnailAttribution");
    expect(markup).toContain("tvN");
    // 방송 화면에 공공누리 표기가 붙으면 사실과 다르다
    expect(markup).not.toContain("KOGL");
    expect(markup).not.toContain("공공누리");
    expect(markup).not.toContain("<a");
  });
});

describe("#146 ① 상태 요약과 분류", () => {
  const base = {
    selectedCount: 8, totalCount: 20, updating: false, updated: false,
    sortBy: "relevance" as const, onSortChange: () => undefined,
    onBrowseAll: () => undefined,
    tr,
  };
  const render = (over: Record<string, unknown>) =>
    renderToStaticMarkup(createElement(PlaceRecommendationSheet, { ...base, ...over } as never));

  /**
   * 여행 기간과 무관하게 같은 구조를 쓴다. `일정 반영 + 미배치 = 선택` 관계가 유지되므로
   * "왜 8곳을 골랐는데 7곳만 있지"가 화면에서 바로 풀린다.
   */
  it("선택·일정 반영·미배치를 한 줄로 말한다", () => {
    const html = render({ placedCount: 7, unplacedCount: 1, themeRecommended: false });
    expect(html).toContain("선택 8 · 일정 반영 7 · 미배치 1");
  });

  it("미배치가 0이어도 같은 구조를 유지한다", () => {
    const html = render({ placedCount: 8, unplacedCount: 0, themeRecommended: false });
    expect(html).toContain("선택 8 · 일정 반영 8 · 미배치 0");
    // 경고 강조만 뺀다
    expect(html).not.toContain("시간·동선 제약");
  });

  it("미배치가 있으면 사유를 덧붙인다", () => {
    expect(render({ placedCount: 7, unplacedCount: 1, themeRecommended: false }))
      .toContain("시간·동선 제약");
  });

  // 아직 계산 전이면 반영·미배치를 알 수 없다 — 지어내지 않는다
  it("계산 전에는 기존 선택 수 표기로 남는다", () => {
    const html = render({ placedCount: null, unplacedCount: null, themeRecommended: false });
    expect(html).toContain("8/20곳 선택");
    expect(html).not.toContain("일정 반영");
  });

  it("K-컬처 칩은 선택 수를 센다", () => {
    expect(render({ placedCount: 7, unplacedCount: 1, themeRecommended: false }))
      .toContain("K-컬처 8");
  });

  /** 테마체험은 아직 선택할 수 없다 — 선택 수를 세면 언제나 0이라 의미가 없다 */
  it("테마체험은 숫자 대신 추천 유무를 말한다", () => {
    expect(render({ placedCount: 7, unplacedCount: 1, themeRecommended: false }))
      .toContain("테마체험 추천 없음");
    expect(render({ placedCount: 7, unplacedCount: 1, themeState: "available" }))
      .toContain("테마체험 추천 있음");
  });

  /** 성격이 다른 숫자를 같은 줄에 섞으면 둘 다 무슨 뜻인지 흐려진다 */
  it("상태 요약과 분류 칩은 다른 자리에 선다", () => {
    const html = render({ placedCount: 7, unplacedCount: 1, themeRecommended: false });
    expect(html.indexOf("data-selection-state")).toBeLessThan(html.indexOf("data-category-chips"));
    expect(html).toMatch(/data-selection-state[\s\S]*?<\/span>[\s\S]*?data-category-chips/);
  });
});

describe("PR #156 리뷰 4 — 테마체험은 아는 것만 말한다", () => {
  const base = {
    selectedCount: 8, totalCount: 20, updating: false, updated: false,
    sortBy: "relevance" as const, onSortChange: () => undefined,
    onBrowseAll: () => undefined, tr,
    placedCount: 7, unplacedCount: 1,
  };
  const render = (themeState: "available" | "none" | "unknown") =>
    renderToStaticMarkup(createElement(PlaceRecommendationSheet, { ...base, themeState } as never));

  /**
   * 재계산마다 조회 상태가 `null`로 초기화된다. 미조회를 "추천 없음"으로 합치면
   * **매번 없다고 단언했다가 뒤집힌다.** 모르는 동안은 말하지 않는다.
   */
  it("조회 전·확인 불가에는 칩을 두지 않는다", () => {
    const html = render("unknown");
    expect(html).not.toContain("테마체험");
    // K-컬처 칩은 그대로 있다 — 선택 수는 지금도 아는 값이다
    expect(html).toContain("K-컬처 8");
  });

  it("조회가 끝났을 때만 있음·없음을 말한다", () => {
    expect(render("none")).toContain("테마체험 추천 없음");
    expect(render("available")).toContain("테마체험 추천 있음");
  });
});
