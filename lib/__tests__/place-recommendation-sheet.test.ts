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
  "step3.selectionState": "일정 반영 {placed} · 미배치 {unplaced}",
  "step3.unplacedHint": "시간·동선 제약",
  "step3.chipKCulture": "K-컬처 {n}",
  "step3.chipThemeNone": "테마체험 추천 없음",
  "step3.chipThemeAvailable": "테마체험 추천 있음",
  "common.back": "이전",
};

const tr = (key: MessageKey) => copy[key] ?? key;

describe("지도 위 추천 장소 바텀시트", () => {
  it("제목·전체 보기·접기 없이 정렬·상태·후보 목록을 한자리에 둔다", () => {
    const markup = renderToStaticMarkup(createElement(PlaceRecommendationSheet, {
      selectedCount: 3,
      totalCount: 8,
      placedCount: null,
      unplacedCount: null,
      updating: false,
      updated: false,
        tr,
    }, createElement("li", { "data-recommendation-card": true }, "월정사")));

    expect(markup).toContain("data-place-sheet");
    expect(markup).toContain('data-sheet-mode="browser-entry"');
    // 제목·선택 수·전체 보기·접기는 걷었다 (#146 후속 — 독 없애기)
    expect(markup).not.toContain("지도 위 추천 장소");
    expect(markup).not.toContain("전체 촬영지 보기");
    expect(markup).not.toContain("추천 장소 접기");
    expect(markup).not.toContain("추천 장소 펼치기");
    expect(markup).not.toContain("data-sheet-expanded");
    // 정렬은 좁히기와 같은 줄로 내려갔다 — 시트가 그리지 않는다
    expect(markup).not.toContain('aria-label="장소 정렬 방식"');
    // 후보 목록은 늘 보인다 — 호출부가 넘긴 카드가 그대로 실린다
    expect(markup).toContain("월정사");
    expect(markup).not.toContain("data-place-sheet-map");
    // 시트 안 촬영지 위치 지도는 지웠다 (#146) — 화면의 동선 지도와 중복이었다
    expect(markup).not.toContain("data-place-sheet-map");
    // 독으로 옮겨 갈 주 액션 자리는 시트가 제공한다
    expect(markup).toContain('id="stage-sheet-actions"');
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
      updating: true,
      updated: false,
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
      updating: false,
      updated: false,
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
      updating: false,
      updated: true,
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
    tr,
  };
  const render = (over: Record<string, unknown>) =>
    renderToStaticMarkup(createElement(PlaceRecommendationSheet, { ...base, ...over } as never));

  /**
   * 여행 기간과 무관하게 같은 구조를 쓴다. 선택 수는 이 줄에서 뺐다 — 옆의 `K-컬처 n`
   * 칩과 위 요약 막대가 이미 말한다. `일정 반영 + 미배치`가 곧 선택 수다.
   */
  it("일정 반영·미배치를 한 줄로 말한다", () => {
    const html = render({ placedCount: 7, unplacedCount: 1, themeRecommended: false });
    expect(html).toContain("일정 반영 7 · 미배치 1");
    expect(html).not.toContain("선택 8 ·");
  });

  it("미배치가 0이어도 같은 구조를 유지한다", () => {
    const html = render({ placedCount: 8, unplacedCount: 0, themeRecommended: false });
    expect(html).toContain("일정 반영 8 · 미배치 0");
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

  /**
   * `K-컬처 n`은 선택 수를 말했는데 같은 줄의 상태 요약과 위 요약 막대가 이미 같은
   * 숫자를 말한다. 한 화면에 세 번이라 걷었다.
   */
  it("선택 수를 칩으로 다시 세지 않는다", () => {
    expect(render({ placedCount: 7, unplacedCount: 1, themeRecommended: false }))
      .not.toContain("K-컬처");
  });
});

describe("테마체험 대체 칩", () => {
  const base = {
    selectedCount: 8, totalCount: 20, updating: false, updated: false,
    onBrowseAll: () => undefined, tr,
    placedCount: 7, unplacedCount: 1,
  };

  /**
   * 추천이 없을 때 "추천 없음"이라고 말하던 대체 칩은 걷었다 — 고를 수도 없는 것의
   * 부재를 알리는 칩이었다. 호출부가 칩을 주지 않으면 아무것도 그리지 않는다.
   */
  it("호출부가 칩을 주지 않으면 테마체험을 말하지 않는다", () => {
    const html = renderToStaticMarkup(createElement(PlaceRecommendationSheet, base as never));
    expect(html).not.toContain("테마체험");
  });
});
