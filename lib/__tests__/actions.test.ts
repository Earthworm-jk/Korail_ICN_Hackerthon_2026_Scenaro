import { describe, expect, it } from "vitest";
import { getCandidatePlaces } from "../actions/places";
import { planItinerary, type PlanRequest } from "../actions/itinerary";
import { excludedPlaceIdsFrom, selectableCandidateIds } from "../candidates";

// PR #30 리뷰 재리뷰 조건: 후보 합집합·미확인 제외·잘못된 시각 요청의 액션 단위 테스트

const ACTOR = "actor-kim-go-eun";
const WORK = "work-goblin";

function validRequest(): PlanRequest {
  return {
    arrivalAt: "2026-08-12T10:00:00+09:00",
    departureAt: "2026-08-14T18:00:00+09:00",
    airportExitOffsetMin: 120,
    departureBufferMinutes: 120,
    selectedActorIds: [ACTOR],
    selectedWorkIds: [],
    excludedPlaceIds: [],
  };
}

type MinimalCandidate = Pick<
  Awaited<ReturnType<typeof getCandidatePlaces>>["candidates"][number],
  "id" | "openingHours"
>;
const verified = (id: string): MinimalCandidate => ({
  id,
  openingHours: { type: "always_open", source: "fixture", verifiedAt: "2026-08-07" },
});
const unverified = (id: string): MinimalCandidate => ({ id, openingHours: { type: "unverified" } });

describe("후보 합집합·중복 제거 (#14 복수 선택)", () => {
  it("배우와 그 배우의 작품을 함께 선택해도 후보는 한 번만, 관계는 selected_work 우선", async () => {
    const { candidates } = await getCandidatePlaces({
      selectedActorIds: [ACTOR],
      selectedWorkIds: [WORK],
    });
    const ids = candidates.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(candidates.find((c) => c.workIds.includes(WORK))?.relation).toBe("selected_work");
  });

  it("배우만 선택하면 그 작품의 촬영지가 actor_other_work 관계로 나온다", async () => {
    const { candidates } = await getCandidatePlaces({
      selectedActorIds: [ACTOR],
      selectedWorkIds: [],
    });
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((c) => c.relation === "actor_other_work")).toBe(true);
  });
});

describe("미확인 후보 제외 (#14·PR #30 리뷰 ①)", () => {
  const candidates = [verified("p-1"), unverified("p-2"), verified("p-3")];

  it("초기 선택은 검증 후보만 포함한다", () => {
    expect(selectableCandidateIds(candidates)).toEqual(["p-1", "p-3"]);
  });

  it("전부 미확인이면 선택 가능 후보가 없다 — 생성 CTA 비활성 근거", () => {
    expect(selectableCandidateIds([unverified("p-1"), unverified("p-2")])).toEqual([]);
  });

  it("미확인 후보는 일정 요청의 excludedPlaceIds로 들어간다", () => {
    const selected = new Set(selectableCandidateIds(candidates));
    expect(excludedPlaceIdsFrom(candidates, selected)).toEqual(["p-2"]);
  });
});

describe("잘못된 시각 요청 (PR #30 리뷰 ③ — throw 없이 INVALID_REQUEST)", () => {
  it("유효한 요청은 ok:true로 엔진 결과를 반환한다", async () => {
    const res = await planItinerary(validRequest());
    expect(res.ok).toBe(true);
  });

  it("빈 시각 입력(datetime-local 미입력)은 INVALID_REQUEST", async () => {
    const res = await planItinerary({ ...validRequest(), arrivalAt: ":00+09:00" });
    expect(res).toMatchObject({ ok: false, code: "INVALID_REQUEST" });
    if (!res.ok) expect(Object.keys(res.fieldErrors)).toContain("arrivalAt");
  });

  it("입출국 역전은 INVALID_REQUEST — departureAt 필드 오류", async () => {
    const res = await planItinerary({
      ...validRequest(),
      arrivalAt: "2026-08-14T18:00:00+09:00",
      departureAt: "2026-08-12T10:00:00+09:00",
    });
    expect(res).toMatchObject({ ok: false, code: "INVALID_REQUEST" });
    if (!res.ok) expect(Object.keys(res.fieldErrors)).toContain("departureAt");
  });

  it("입국·출국 동일 시각도 거절한다", async () => {
    const at = "2026-08-12T10:00:00+09:00";
    const res = await planItinerary({ ...validRequest(), arrivalAt: at, departureAt: at });
    expect(res).toMatchObject({ ok: false, code: "INVALID_REQUEST" });
  });

  it("배우·작품 모두 미선택인 요청도 throw하지 않고 INVALID_REQUEST", async () => {
    const res = await planItinerary({ ...validRequest(), selectedActorIds: [], selectedWorkIds: [] });
    expect(res).toMatchObject({ ok: false, code: "INVALID_REQUEST" });
  });
});
