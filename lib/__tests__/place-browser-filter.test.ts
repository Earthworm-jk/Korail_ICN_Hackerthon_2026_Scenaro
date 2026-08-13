import { describe, expect, it } from "vitest";
import {
  filterPlaceBrowserCandidates,
  showsPlaceBrowserWorkFilter,
} from "../place-browser-filter";

describe("전체 촬영지 작품 필터", () => {
  const candidates = Array.from({ length: 9 }, (_, index) => ({
    id: `place-${index + 1}`,
    nearestStationId: index < 5 ? "seoul" : "gangneung",
    workIds: index % 2 === 0 ? ["goblin"] : ["the-king"],
  }));

  it("작품이 하나면 중복 필터를 숨기고 둘 이상이면 노출한다", () => {
    expect(showsPlaceBrowserWorkFilter(1)).toBe(false);
    expect(showsPlaceBrowserWorkFilter(2)).toBe(true);
  });

  it("여러 작품의 합집합 후보를 선택 작품으로 좁힌다", () => {
    expect(filterPlaceBrowserCandidates(candidates, null, "goblin"))
      .toHaveLength(5);
    expect(filterPlaceBrowserCandidates(candidates, "gangneung", "the-king"))
      .toEqual([candidates[5], candidates[7]]);
  });
});
