import { beforeEach, describe, expect, it, vi } from "vitest";
import { getFlightInfo } from "../actions/flights";
import { planItinerary, type PlanRequest } from "../actions/itinerary";
import { getCandidatePlaces } from "../actions/places";
import { lookupLiveFlight } from "../adapters/flights-live";
import { flightMode } from "../env";
import {
  deriveFilmingCatalogCandidates,
  loadFilmingCatalog,
} from "../filming-catalog";
import {
  displayedDays,
  initialItineraryView,
  reduceItineraryView,
} from "../itinerary-view";
import { searchEntitiesCore } from "../search/entities";
import { summarizeSelectionCapacity } from "../selection-capacity";

vi.mock("../env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../env")>()),
  flightMode: vi.fn(() => "snapshot" as const),
}));

vi.mock("../adapters/flights-live", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../adapters/flights-live")>()),
  lookupLiveFlight: vi.fn(),
}));

const KIM = "actor-kim-go-eun";
const PARK = "actor-park-bo-gum";
const GOBLIN = "work-goblin";

const baseRequest = (selection: Pick<PlanRequest, "selectedActorIds" | "selectedWorkIds">): PlanRequest => ({
  arrivalAt: "2026-08-12T10:00:00+09:00",
  departureAt: "2026-08-14T18:00:00+09:00",
  airportReadyAt: "2026-08-12T12:00:00+09:00",
  airportArrivalDeadline: "2026-08-14T16:00:00+09:00",
  excludedPlaceIds: [],
  ...selection,
});

const INVALID_REFERENCE_PATCHES: Array<[
  "selectedActorIds" | "selectedWorkIds" | "excludedPlaceIds",
  Partial<PlanRequest>,
]> = [
  ["selectedActorIds", { selectedActorIds: ["actor-missing"] }],
  ["selectedWorkIds", { selectedWorkIds: ["work-missing"] }],
  ["excludedPlaceIds", { excludedPlaceIds: ["place-missing"] }],
];

const visitedPlaceIds = (days: Array<{ items: Array<{ placeId: string }> }>) =>
  [...new Set(days.flatMap((day) => day.items.map(({ placeId }) => placeId)))].sort();

async function expectReadyScenario(
  selection: Pick<PlanRequest, "selectedActorIds" | "selectedWorkIds">,
  expectedGroups: Array<"actor" | "work">,
) {
  const { candidates } = await getCandidatePlaces(selection);
  const candidateIds = candidates.map(({ id }) => id);
  expect(candidateIds.length).toBeGreaterThan(0);
  expect(new Set(candidateIds).size).toBe(candidateIds.length);
  for (const group of expectedGroups) {
    expect(candidates.some(({ selectionGroups }) => selectionGroups.includes(group))).toBe(true);
  }

  const preview = await planItinerary(baseRequest(selection));
  expect(preview.ok).toBe(true);
  if (!preview.ok) throw new Error("valid mentor fixture was rejected");
  expect(preview.result.status).toBe("planned");
  if (preview.result.status !== "planned") throw new Error("mentor fixture produced no itinerary");
  for (const group of expectedGroups) expect(preview.result.selectionGroups.covered).toContain(group);

  const previewVisited = visitedPlaceIds(preview.result.days);
  const previewCapacity = summarizeSelectionCapacity(candidateIds, preview.result.days);
  expect(previewCapacity).toEqual({
    selectedCount: candidateIds.length,
    schedulableCount: previewVisited.length,
    minimumExclusionCount: candidateIds.length - previewVisited.length,
    requiresAdjustment: candidateIds.length > previewVisited.length,
  });

  // 엔진이 장소를 자동 제외해 확정하는 것이 아니다. 테스트가 한 사용자의 선택을 재현한다:
  // 미리보기에서 빠진 후보를 사용자가 직접 끈 뒤 같은 Action으로 전체 재계산한다.
  const userExcluded = candidateIds.filter((id) => !previewVisited.includes(id));
  const finalized = await planItinerary({
    ...baseRequest(selection),
    excludedPlaceIds: userExcluded,
  });
  expect(finalized.ok).toBe(true);
  if (!finalized.ok) throw new Error("user-adjusted mentor fixture was rejected");
  expect(finalized.result.status).toBe("planned");
  if (finalized.result.status !== "planned") throw new Error("user-adjusted mentor fixture was empty");
  expect(summarizeSelectionCapacity(previewVisited, finalized.result.days)).toMatchObject({
    selectedCount: previewVisited.length,
    schedulableCount: previewVisited.length,
    minimumExclusionCount: 0,
    requiresAdjustment: false,
  });
}

describe("멘토링 3회 E2E fixture — 엔진·Server Action", () => {
  it("1회 김고은: 결정적 검색 → 엄격 배우 후보 → 사용자 제외 → 최종 일정", async () => {
    const interpret = vi.fn();
    const search = await searchEntitiesCore("김고은", { apiKey: "unused", interpret });
    expect(search.actors.map(({ id }) => id)).toEqual([KIM]);
    expect(interpret).not.toHaveBeenCalled();
    await expectReadyScenario({ selectedActorIds: [KIM], selectedWorkIds: [] }, ["actor"]);
  });

  it("2회 도깨비: 결정적 검색 → 검토 작품 후보 → 사용자 제외 → 최종 일정", async () => {
    const interpret = vi.fn();
    const search = await searchEntitiesCore("도깨비", { apiKey: "unused", interpret });
    expect(search.works.map(({ id }) => id)).toEqual([GOBLIN]);
    expect(interpret).not.toHaveBeenCalled();
    await expectReadyScenario({ selectedActorIds: [], selectedWorkIds: [GOBLIN] }, ["work"]);
  });

  it("3회 박보검+도깨비: 검색 → 양 그룹 후보 → 사용자 제외 → 최종 일정", async () => {
    const search = await searchEntitiesCore("박보검", { apiKey: "unused", interpret: vi.fn() });
    expect(search.actors.map(({ id }) => id)).toEqual([PARK]);
    const catalogCandidates = deriveFilmingCatalogCandidates(loadFilmingCatalog(), {
      selectedActorIds: [PARK],
      selectedWorkIds: [GOBLIN],
    });
    expect(catalogCandidates.some(({ selectionGroups }) => selectionGroups.includes("actor"))).toBe(true);
    expect(catalogCandidates.some(({ selectionGroups }) => selectionGroups.includes("work"))).toBe(true);

    const plannerCandidates = await getCandidatePlaces({
      selectedActorIds: [PARK],
      selectedWorkIds: [GOBLIN],
    });
    expect(plannerCandidates.candidates.filter(({ selectionGroups }) =>
      selectionGroups.includes("actor"))).toHaveLength(4);
    await expectReadyScenario(
      { selectedActorIds: [PARK], selectedWorkIds: [GOBLIN] },
      ["actor", "work"],
    );
  });
});

describe("실패·오프라인 통합 경계", () => {
  const mockedMode = vi.mocked(flightMode);
  const mockedLookup = vi.mocked(lookupLiveFlight);

  beforeEach(() => {
    mockedMode.mockReset().mockReturnValue("snapshot");
    mockedLookup.mockReset();
  });

  it("항공 API 네트워크 실패 → AF264 스냅샷 → 일정 생성까지 이어진다", async () => {
    mockedMode.mockReturnValue("live");
    mockedLookup.mockRejectedValue(new Error("network unreachable"));
    const flight = await getFlightInfo("AF264", "arrival", "2026-08-12");
    expect(flight).toMatchObject({
      ok: true,
      source: "snapshot",
      flight: { scheduledAt: "2026-08-12T09:35:00+09:00" },
    });
    if (!flight.ok) return;

    const plan = await planItinerary({
      ...baseRequest({ selectedActorIds: [KIM], selectedWorkIds: [] }),
      arrivalAt: flight.flight.scheduledAt,
      airportReadyAt: "2026-08-12T11:35:00+09:00",
    });
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.result.status).toBe("planned");
  });

  it("잘못된 재계산 요청은 구조화 실패로 끝나고 직전 일정은 유지된다", async () => {
    const success = await planItinerary(baseRequest({
      selectedActorIds: [KIM],
      selectedWorkIds: [],
    }));
    expect(success.ok).toBe(true);
    if (!success.ok) return;

    const invalid = await planItinerary({
      ...baseRequest({ selectedActorIds: [KIM], selectedWorkIds: [] }),
      airportReadyAt: "2026-08-12T09:00:00+09:00",
    });
    expect(invalid).toMatchObject({ ok: false, code: "INVALID_REQUEST" });

    const settled = reduceItineraryView(initialItineraryView, {
      type: "PLAN_SUCCESS",
      result: success.result,
    });
    const failed = reduceItineraryView(
      reduceItineraryView(settled, { type: "PLAN_START" }),
      { type: "PLAN_INVALID" },
    );
    expect(failed.planError).toBe("invalid");
    expect(displayedDays(failed)).toEqual(displayedDays(settled));
  });

  it.each(INVALID_REFERENCE_PATCHES)(
    "미등록 참조는 throw하지 않고 %s 필드 오류로 반환한다",
    async (field, patch) => {
      const result = await planItinerary({
        ...baseRequest({ selectedActorIds: [KIM], selectedWorkIds: [] }),
        ...patch,
      });
      expect(result).toMatchObject({ ok: false, code: "INVALID_REQUEST" });
      if (!result.ok) expect(result.fieldErrors).toHaveProperty(field);
    },
  );
});
