import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FinalItineraryPage } from "../../app/final-itinerary-page";
import type { DayPlan } from "../engine/types";
import type { MessageKey } from "../i18n/messages";

const copy: Partial<Record<MessageKey, string>> = {
  "final.eyebrow": "여행 준비 완료",
  "final.title": "최종 일정",
  "final.subtitle": "모든 날짜와 핵심 이동을 한 화면에서 확인하세요.",
  "final.days": "여행 일수",
  "final.places": "방문 장소",
  "final.legs": "이동 구간",
  "final.dayNumber": "DAY {n}",
  "final.daySummary": "장소 {places} · 이동 {legs}",
  "final.movementWindow": "핵심 이동 범위",
  "final.noMovement": "당일 장거리 이동 없음",
  "final.placesTitle": "방문 순서",
  "final.transportDetails": "교통 상세",
  "final.legCount": "{n}구간",
  "final.warningCount": "{n}건",
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
