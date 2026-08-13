import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VerifiedItineraryAlternatives } from "../../app/verified-itinerary-alternatives";
import type { VerifiedItineraryAlternative } from "../engine/types";
import { messages, type MessageKey } from "../i18n/messages";

const keys = {
  selectionGroupCoverageCount: 1,
  representativePlaceCount: 0,
  selectedUnionPlaceCount: 1,
  verifiedHoursMismatchCount: 0,
  preferredDateMismatchCount: 0,
  preferredOrderMismatchCount: 0,
  totalTravelMinutes: 160,
  transferCount: 0,
  slackSatisfied: true,
};

function alternative(
  improvements: VerifiedItineraryAlternative["improvements"],
  deltas: Pick<VerifiedItineraryAlternative["deltas"], "totalTravelMinutes" | "transferCount">
    & Partial<VerifiedItineraryAlternative["deltas"]>,
  changes: VerifiedItineraryAlternative["changes"] = {
    removedPlaceIds: [], addedPlaceIds: [],
  },
): VerifiedItineraryAlternative {
  return {
    id: "verified-1",
    kind: "verified_itinerary",
    improvements,
    days: [],
    rejectedPlaces: [],
    warnings: [],
    selectionGroups: { requested: ["work"], covered: ["work"], uncovered: [] },
    comparisonKeys: keys,
    metrics: {
      totalTravelMinutes: 160,
      totalRailMinutes: 120,
      transferCount: 0,
      departureSlackMinutes: 90,
    },
    changes,
    deltas: {
      verifiedHoursMismatchCount: 0,
      preferredDateMismatchCount: 0,
      preferredOrderMismatchCount: 0,
      warningCount: 0,
      ...deltas,
    },
  };
}

const tr = (key: MessageKey) => messages.ko[key];
const recommendedMetrics = {
  totalTravelMinutes: 100,
  totalRailMinutes: 80,
  transferCount: 2,
  departureSlackMinutes: 120,
};

describe("VerifiedItineraryAlternatives", () => {
  it("접힌 상태는 문구 너비의 한 줄 토글로 렌더링한다", () => {
    const markup = renderToStaticMarkup(createElement(VerifiedItineraryAlternatives, {
      alternatives: [alternative(["faster"], { totalTravelMinutes: -20, transferCount: 0 })],
      recommendedMetrics,
      placeName: (placeId) => placeId,
      selectedId: null,
      onSelect: () => undefined,
      tr,
    }));

    expect(markup).toContain('data-stage-utility="verified-alternatives"');
    expect(markup).toContain("w-fit");
    expect(markup).toContain("w-max");
    expect(markup).toContain("whitespace-nowrap");
    expect(markup).toContain("검증된 일정 대안");
    expect(markup).toContain("추천 일정");
  });

  it("구조화 diff에 없는 더 빠름 주장은 만들지 않고 실제 증감값을 표시한다", () => {
    const markup = renderToStaticMarkup(createElement(VerifiedItineraryAlternatives, {
      alternatives: [alternative(["fewer_transfers"], { totalTravelMinutes: 60, transferCount: -2 })],
      recommendedMetrics,
      placeName: (placeId) => placeId,
      selectedId: null,
      onSelect: () => undefined,
      tr,
    }));

    expect(markup).toContain("환승 적음");
    expect(markup).not.toContain("더 빠름");
    expect(markup).toContain("추천보다 이동 60분 증가");
    expect(markup).toContain("추천보다 환승 2회 감소");
    expect(markup).not.toContain("목업");
  });

  it("faster diff가 있을 때만 더 빠름 배지를 표시한다", () => {
    const markup = renderToStaticMarkup(createElement(VerifiedItineraryAlternatives, {
      alternatives: [alternative(["faster"], {
        totalTravelMinutes: -20,
        transferCount: 1,
        verifiedHoursMismatchCount: 1,
        preferredDateMismatchCount: 1,
        warningCount: 1,
      }, {
        removedPlaceIds: ["영진해변"],
        addedPlaceIds: ["주문진해변"],
      })],
      recommendedMetrics,
      placeName: (placeId) => placeId,
      selectedId: "verified-1",
      onSelect: () => undefined,
      tr,
    }));

    expect(markup).toContain("더 빠름");
    expect(markup).toContain("추천보다 이동 20분 단축");
    expect(markup).toContain("추천보다 환승 1회 증가");
    expect(markup).toContain("빠지는 곳: 영진해변");
    expect(markup).toContain("대신 들어오는 곳: 주문진해변");
    expect(markup).toContain("검증 운영시간 충돌 1건 증가");
    expect(markup).toContain("선호 방문일 미반영 1건 증가");
    expect(markup).toContain("확인 필요 경고 1건 증가");
  });
});
