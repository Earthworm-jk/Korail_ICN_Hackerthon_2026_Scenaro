import { describe, expect, it } from "vitest";
import {
  commandResponseIsCurrent,
  selectionAfterCommand,
  stateAfterRouteRecommendation,
} from "../itinerary-command-ui";

describe("자연어 명령 응답 적용 경계 (#144 리뷰)", () => {
  it("제출 뒤 선택 시퀀스가 바뀌면 늦은 응답을 폐기한다", () => {
    expect(commandResponseIsCurrent(7, 7)).toBe(true);
    expect(commandResponseIsCurrent(7, 8)).toBe(false);
  });

  it("확인 창에서 고지한 displaced 장소만 기존 선택에서 제외한다", () => {
    const selected = selectionAfterCommand({
      candidatePlaceIds: ["requested", "displaced", "already-rejected", "newly-scheduled"],
      currentSelectedPlaceIds: new Set(["displaced", "already-rejected"]),
      scheduledPlaceIds: new Set(["requested", "newly-scheduled"]),
      displacedPlaceIds: new Set(["displaced"]),
    });

    expect([...selected]).toEqual(["requested", "already-rejected", "newly-scheduled"]);
  });

  it("동선 추천 적용은 고지한 제외만 반영하고 추천 장소의 방문일을 보존한다", () => {
    expect(stateAfterRouteRecommendation({
      currentSelectedPlaceIds: new Set(["kept", "displaced"]),
      currentPreferredVisitDates: { displaced: "2026-08-12", kept: "2026-08-13" },
      recommendation: {
        placeId: "recommended",
        targetDate: "2026-08-13",
        displacedPlaceIds: ["displaced"],
      },
    })).toEqual({
      selectedPlaceIds: new Set(["kept", "recommended"]),
      preferredVisitDates: { kept: "2026-08-13", recommended: "2026-08-13" },
    });
  });
});
