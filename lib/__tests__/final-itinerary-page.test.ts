import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FinalItineraryPage } from "../../app/final-itinerary-page";
import type { CandidateWarning, DayPlan, ItineraryMetrics } from "../engine/types";
import type { MessageKey } from "../i18n/messages";

const copy: Partial<Record<MessageKey, string>> = {
  "final.eyebrow": "여행 준비 완료",
  "final.title": "최종 일정",
  "final.subtitle": "모든 날짜와 핵심 이동을 한 화면에서 확인하세요.",
  "final.days": "여행 일수",
  "final.places": "방문 장소",
  "final.legs": "이동 구간",
  "final.dayNumber": "DAY {n}",
  "final.dayPlaceCount.one": "장소 {n}",
  "final.dayPlaceCount.other": "장소 {n}",
  "final.dayLegCount.one": "이동 {n}",
  "final.dayLegCount.other": "이동 {n}",
  "final.movementWindow": "핵심 이동 범위",
  "final.noMovement": "당일 장거리 이동 없음",
  "final.placesTitle": "방문 순서",
  "final.transportDetails": "교통 상세",
  "final.legCount.one": "{n}구간",
  "final.legCount.other": "{n}구간",
  "final.warningCount.one": "{n}건",
  "final.warningCount.other": "{n}건",
  "final.backToAdjust": "일정 조율로 돌아가기",
  "final.save": "최종 일정 저장",
  "step4.warningsTitle": "방문 전 확인이 필요한 배치",
};

const tr = (key: MessageKey) => copy[key] ?? key;

function day(date: string, placeId: string, trainNo?: string): DayPlan {
  return {
    date,
    items: [{
      placeId,
      arriveAt: `${date}T03:00:00.000Z`,
      departAt: `${date}T04:00:00.000Z`,
      accessMinutes: 10,
    }],
    rides: trainNo ? [{
      trainNo,
      fromStationId: "seoul",
      toStationId: "gangneung",
      departAt: `${date}T00:00:00.000Z`,
      arriveAt: `${date}T02:00:00.000Z`,
    }] : [],
    regionWindows: [],
  };
}

describe("최종 일정 한눈에 보기", () => {
  it("모든 날짜를 같은 그리드에 두고 장소와 핵심 이동 범위를 기본 정보로 표시한다", () => {
    const days = [
      day("2026-08-12", "seoullo", "KTX-1"),
      day("2026-08-13", "woljeongsa"),
      day("2026-08-14", "gwanghwamun", "AREX-2"),
    ];
    const markup = renderToStaticMarkup(createElement(FinalItineraryPage, {
      days,
      locale: "ko",
      metrics: null,
      placeName: (id: string) => ({
        seoullo: "서울로7017",
        woljeongsa: "월정사 전나무 숲길",
        gwanghwamun: "광화문 광장",
      })[id] ?? id,
      stationName: (id: string) => ({ seoul: "서울역", gangneung: "강릉역" })[id] ?? id,
      warnings: [],
      warningLabel: (detail) => detail,
      saveStatus: "none",
      saveStatusLabel: "저장되지 않은 일정",
      onBackToAdjust: () => undefined,
      onSave: () => undefined,
      tr,
    }));

    expect(markup).toContain("data-final-itinerary");
    expect(markup.match(/data-final-day=/g)).toHaveLength(3);
    expect(markup).toContain("--final-day-count:3");
    expect(markup).toContain("서울로7017");
    expect(markup).toContain("월정사 전나무 숲길");
    expect(markup).toContain("광화문 광장");
    expect(markup).toContain("09:00 서울역");
    expect(markup).toContain("11:00 강릉역");
    expect(markup).toContain("당일 장거리 이동 없음");
  });

  it("세부 열차 번호는 접힌 교통 상세 안에 유지하고 저장 CTA를 제공한다", () => {
    const markup = renderToStaticMarkup(createElement(FinalItineraryPage, {
      days: [day("2026-08-12", "seoullo", "KTX-1")],
      locale: "ko",
      metrics: null,
      placeName: () => "서울로7017",
      stationName: (id: string) => id === "seoul" ? "서울역" : "강릉역",
      warnings: [],
      warningLabel: (detail) => detail,
      saveStatus: "saved",
      saveStatusLabel: "내 일정에 저장됨",
      onBackToAdjust: () => undefined,
      onSave: () => undefined,
      tr,
    }));

    expect(markup).toContain("<details");
    expect(markup).toContain("교통 상세");
    expect(markup).toContain("KTX-1");
    expect(markup).toContain("최종 일정 저장");
    expect(markup).toContain("내 일정에 저장됨");
  });

  it("방문 전 확인 경고를 해당 장소가 있는 날짜 카드에 접어서 표시한다", () => {
    const markup = renderToStaticMarkup(createElement(FinalItineraryPage, {
      days: [
        day("2026-08-12", "seoullo"),
        day("2026-08-13", "woljeongsa"),
      ],
      locale: "ko",
      metrics: null,
      placeName: (id: string) => id === "seoullo" ? "서울로7017" : "월정사 전나무 숲길",
      stationName: (id: string) => id,
      warnings: [{
        code: "ACTIVITY_WINDOW_MISMATCH",
        placeId: "woljeongsa",
        detail: "UNVERIFIED_HOURS",
      }],
      warningLabel: () => "운영시간이 확인되지 않았습니다",
      saveStatus: "none",
      saveStatusLabel: "저장되지 않은 일정",
      onBackToAdjust: () => undefined,
      onSave: () => undefined,
      tr,
    }));

    expect(markup.match(/data-final-warning/g)).toHaveLength(1);
    expect(markup).toContain("방문 전 확인이 필요한 배치");
    expect(markup).toContain("1건");
    expect(markup).toContain("월정사 전나무 숲길");
    expect(markup).toContain("운영시간이 확인되지 않았습니다");
  });
});

/**
 * 영어 단복수 (#131)
 *
 * `1 places`는 최종 화면에서 크게 보이는 자리다. 분기를 호출부마다 적으면 새 개수 문구가
 * 생길 때 한 곳을 빠뜨리므로, 헬퍼 한 곳에 두고 여기서 실제 렌더로 고정한다.
 */
describe("영어 개수 표기", () => {
  const en: Partial<Record<MessageKey, string>> = {
    ...copy,
    "final.dayPlaceCount.one": "{n} place",
    "final.dayPlaceCount.other": "{n} places",
    "final.dayLegCount.one": "{n} leg",
    "final.dayLegCount.other": "{n} legs",
    "final.legCount.one": "{n} leg",
    "final.legCount.other": "{n} legs",
    "final.warningCount.one": "{n} warning",
    "final.warningCount.other": "{n} warnings",
    "final.transportDetails": "Transport details",
    "step4.warningsTitle": "Placements to check",
  };
  const trEn = (key: MessageKey) => en[key] ?? key;

  function render(
    days: DayPlan[],
    warnings: CandidateWarning[] = [],
    locale: "ko" | "en" = "en",
    metrics: ItineraryMetrics | null = null,
  ) {
    return renderToStaticMarkup(createElement(FinalItineraryPage, {
      days,
      locale,
      metrics,
      placeName: (id: string) => id,
      stationName: (id: string) => id,
      warnings,
      warningLabel: (detail) => detail,
      saveStatus: "none",
      saveStatusLabel: "Itinerary not saved",
      onBackToAdjust: () => undefined,
      onSave: () => undefined,
      tr: locale === "en" ? trEn : tr,
    }));
  }

  function withPlaces(date: string, count: number, trainNos: string[] = []): DayPlan {
    return {
      date,
      items: Array.from({ length: count }, (_, i) => ({
        placeId: `p${i}`,
        arriveAt: `${date}T03:00:00.000Z`,
        departAt: `${date}T04:00:00.000Z`,
        accessMinutes: 10,
      })),
      rides: trainNos.map((trainNo) => ({
        trainNo,
        fromStationId: "seoul",
        toStationId: "gangneung",
        departAt: `${date}T00:00:00.000Z`,
        arriveAt: `${date}T02:00:00.000Z`,
      })),
      regionWindows: [],
    };
  }

  it("장소 0·1·2에서 place/places가 정확하다", () => {
    expect(render([withPlaces("2026-08-12", 0)])).toContain("0 places");
    expect(render([withPlaces("2026-08-12", 1)])).toContain("1 place ");
    expect(render([withPlaces("2026-08-12", 1)])).not.toContain("1 places");
    expect(render([withPlaces("2026-08-12", 2)])).toContain("2 places");
  });

  it("이동 0·1·2에서 leg/legs가 정확하다", () => {
    expect(render([withPlaces("2026-08-12", 1)])).toContain("0 legs");
    expect(render([withPlaces("2026-08-12", 1, ["KTX-1"])])).toContain("1 leg");
    expect(render([withPlaces("2026-08-12", 1, ["KTX-1"])])).not.toContain("1 legs");
    expect(render([withPlaces("2026-08-12", 1, ["KTX-1", "KTX-2"])])).toContain("2 legs");
  });

  it("경고 1건과 2건에서 warning/warnings가 정확하다", () => {
    const day1 = withPlaces("2026-08-12", 2);
    const one: CandidateWarning[] = [
      { code: "ACTIVITY_WINDOW_MISMATCH", placeId: "p0", detail: "UNVERIFIED_HOURS" },
    ];
    const two: CandidateWarning[] = [
      ...one,
      { code: "ACTIVITY_WINDOW_MISMATCH", placeId: "p1", detail: "UNVERIFIED_HOURS" },
    ];
    expect(render([day1], one)).toContain("1 warning");
    expect(render([day1], one)).not.toContain("1 warnings");
    expect(render([day1], two)).toContain("2 warnings");
  });

  it("괄호 표기가 화면에 남지 않는다", () => {
    const markup = render([withPlaces("2026-08-12", 1, ["KTX-1"])], [
      { code: "ACTIVITY_WINDOW_MISMATCH", placeId: "p0", detail: "UNVERIFIED_HOURS" },
    ]);
    expect(markup).not.toContain("place(s)");
    expect(markup).not.toContain("leg(s)");
    expect(markup).not.toContain("warning(s)");
  });

  it("한국어는 수에 따라 바뀌지 않는다", () => {
    const one = render([withPlaces("2026-08-12", 1, ["KTX-1"])], [], "ko");
    const many = render([withPlaces("2026-08-12", 3, ["KTX-1", "KTX-2"])], [], "ko");
    expect(one).toContain("장소 1");
    expect(one).toContain("이동 1");
    expect(many).toContain("장소 3");
    expect(many).toContain("이동 2");
  });
});

/**
 * 이동 부담 수치 (#198 B)
 *
 * 고정하는 계약 둘. **엔진 metrics가 없으면 칸을 그리지 않는다** — 재열람 스냅샷에서
 * 화면이 숫자를 다시 세면 엔진과 어긋난 값이 사실처럼 나간다. 그리고 **분모가 다르다는
 * 각주를 함께 낸다** — 총합은 접근시간을 포함하고 최댓값은 교통편만 센다.
 */
describe("이동 부담 수치", () => {
  const loadCopy: Partial<Record<MessageKey, string>> = {
    ...copy,
    "final.travelTotal": "총 이동시간",
    "final.transfers": "환승",
    "final.longestLeg": "가장 긴 단일 교통 구간",
    "final.travelBasis": "총 이동시간은 역-장소 접근시간을 포함하고, 가장 긴 단일 교통 구간은 열차·공항 구간만 셉니다.",
  };
  const trLoad = (key: MessageKey) => loadCopy[key] ?? key;

  const metrics: ItineraryMetrics = {
    totalTravelMinutes: 185,
    totalRailMinutes: 150,
    transferCount: 2,
    departureSlackMinutes: 90,
  };

  /** KTX-1은 00:00 -> 02:00 = 120분 */
  const days = [day("2026-08-12", "seoullo", "KTX-1")];

  function renderLoad(value: ItineraryMetrics | null) {
    return renderToStaticMarkup(createElement(FinalItineraryPage, {
      days,
      locale: "ko" as const,
      metrics: value,
      placeName: (id: string) => id,
      stationName: (id: string) => id,
      warnings: [],
      warningLabel: (detail) => detail,
      saveStatus: "none" as const,
      saveStatusLabel: "저장되지 않은 일정",
      onBackToAdjust: () => undefined,
      onSave: () => undefined,
      tr: trLoad,
    }));
  }

  it("엔진 수치가 있으면 총 이동시간·환승·최장 구간을 공개한다", () => {
    const markup = renderLoad(metrics);
    expect(markup).toContain("총 이동시간");
    expect(markup).toContain("3시간 5분");
    expect(markup).toContain("환승");
    expect(markup).toContain("가장 긴 단일 교통 구간");
    expect(markup).toContain("2시간");
  });

  it("분모가 다르다는 각주를 함께 낸다", () => {
    expect(renderLoad(metrics)).toContain("열차·공항 구간만 셉니다");
  });

  it("수치가 없으면 칸도 각주도 없다", () => {
    const markup = renderLoad(null);
    expect(markup).not.toContain("총 이동시간");
    expect(markup).not.toContain("가장 긴 단일 교통 구간");
    expect(markup).not.toContain("열차·공항 구간만 셉니다");
  });

  it("임의 임계값 경고를 만들지 않는다 — 수치만 준다", () => {
    const heavy = renderLoad({ ...metrics, totalTravelMinutes: 600 });
    expect(heavy).toContain("10시간");
    // 경고 배지·주의 문구를 붙이지 않는다 (#198 결정)
    expect(heavy).not.toContain("이동이 많");
  });
});
