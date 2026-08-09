import { describe, expect, it } from "vitest";
import { getCandidatePlaces } from "../actions/places";
import { planItinerary, type PlanRequest } from "../actions/itinerary";
import { excludedPlaceIdsFrom, initialCandidateIds } from "../candidates";

// PR #30 리뷰 재리뷰 조건: 후보 합집합·미확인 제외·잘못된 시각 요청의 액션 단위 테스트

const ACTOR = "actor-kim-go-eun";
const WORK = "work-goblin";

function validRequest(): PlanRequest {
  return {
    arrivalAt: "2026-08-12T10:00:00+09:00",
    departureAt: "2026-08-14T18:00:00+09:00",
    airportReadyAt: "2026-08-12T12:00:00+09:00",
    airportArrivalDeadline: "2026-08-14T16:00:00+09:00",
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

describe("미확인 후보 선택 가능 (#43 — 표시 전용 계약 개정)", () => {
  const candidates = [verified("p-1"), unverified("p-2"), verified("p-3")];

  it("초기 선택은 미확인을 포함한 전체 후보다", () => {
    expect(initialCandidateIds(candidates)).toEqual(["p-1", "p-2", "p-3"]);
  });

  it("선택 해제한 후보만 일정 요청의 excludedPlaceIds로 들어간다", () => {
    const selected = new Set(["p-1", "p-3"]);
    expect(excludedPlaceIdsFrom(candidates, selected)).toEqual(["p-2"]);
  });
});

describe("잘못된 시각 요청 (PR #30 리뷰 ③ — throw 없이 INVALID_REQUEST)", () => {
  it("유효한 요청은 ok:true로 엔진 결과를 반환한다", async () => {
    const res = await planItinerary(validRequest());
    expect(res.ok).toBe(true);
  });

  // #56 차단 리뷰: 실시드 전체 요청은 사용자가 실제 거치는 경로이므로 제품 데이터 기준으로
  // NFR-PERF-001(2초)을 고정한다 — 스냅샷 확장(만종·노선 팩)이 계약을 깨면 여기서 잡힌다.
  it("NFR-PERF-001: 실시드 전체 요청이 2초 안에 완료된다", async () => {
    const startedAt = performance.now();
    const res = await planItinerary(validRequest());
    const elapsedMs = performance.now() - startedAt;
    expect(res.ok).toBe(true);
    expect(elapsedMs).toBeLessThan(2000);
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

  // #14 차단 2: 절대 시각 경계 순서 — arrivalAt <= airportReadyAt < airportArrivalDeadline <= departureAt
  it("공항 출발 시각이 입국 도착보다 이르면 INVALID_REQUEST — airportReadyAt 필드 오류", async () => {
    const res = await planItinerary({ ...validRequest(), airportReadyAt: "2026-08-12T09:00:00+09:00" });
    expect(res).toMatchObject({ ok: false, code: "INVALID_REQUEST" });
    if (!res.ok) expect(Object.keys(res.fieldErrors)).toContain("airportReadyAt");
  });

  it("공항 도착 마감이 출국 시각보다 늦으면 INVALID_REQUEST — airportArrivalDeadline 필드 오류", async () => {
    const res = await planItinerary({ ...validRequest(), airportArrivalDeadline: "2026-08-14T19:00:00+09:00" });
    expect(res).toMatchObject({ ok: false, code: "INVALID_REQUEST" });
    if (!res.ok) expect(Object.keys(res.fieldErrors)).toContain("airportArrivalDeadline");
  });

  it("공항 도착 마감이 공항 출발 이전이면 INVALID_REQUEST", async () => {
    const res = await planItinerary({
      ...validRequest(),
      airportReadyAt: "2026-08-13T12:00:00+09:00",
      airportArrivalDeadline: "2026-08-13T11:00:00+09:00",
    });
    expect(res).toMatchObject({ ok: false, code: "INVALID_REQUEST" });
    if (!res.ok) expect(Object.keys(res.fieldErrors)).toContain("airportArrivalDeadline");
  });

  it("배우·작품 모두 미선택인 요청도 throw하지 않고 INVALID_REQUEST", async () => {
    const res = await planItinerary({ ...validRequest(), selectedActorIds: [], selectedWorkIds: [] });
    expect(res).toMatchObject({ ok: false, code: "INVALID_REQUEST" });
  });
});

describe("#56 열차 스냅샷 권역 확장 — 실데이터 회귀", () => {
  const JINBU_PLACE_IDS = [
    "place-woljeongsa-temple",
    "place-woljeongsa-fir-forest",
    "place-samyang-ranch",
    "place-balwangsan-cable-car",
  ];

  // 배치 가능 전환의 증명은 단독 선택 배치다 — 12곳 동시 요청에서는 3일 수용량 경쟁으로
  // 밀린 후보에 엔진이 마지막 실패 지점의 폴백 사유(TRAIN_UNAVAILABLE 등)를 붙이기 때문.
  async function planOnly(placeId: string) {
    const { candidates } = await getCandidatePlaces({
      selectedActorIds: [ACTOR],
      selectedWorkIds: [],
    });
    const excluded = candidates.map(({ id }) => id).filter((id) => id !== placeId);
    return planItinerary({ ...validRequest(), excludedPlaceIds: excluded });
  }

  it("진부 앵커 4곳이 각각 단독 선택 시 TRAIN_UNAVAILABLE 없이 배치된다", async () => {
    for (const placeId of JINBU_PLACE_IDS) {
      const res = await planOnly(placeId);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.result.status).toBe("planned");
      if (res.result.status !== "planned") return;
      expect(res.result.days.flatMap((day) => day.items.map((item) => item.placeId)))
        .toContain(placeId);
    }
  });

  it("만종 앵커 오크밸리가 단독 선택 시 배치된다 — 수집기 무수정 확장 (#56 2단계)", async () => {
    const res = await planOnly("place-oak-valley-resort");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result.status).toBe("planned");
    if (res.result.status !== "planned") return;
    expect(res.result.days.flatMap((day) => day.items.map((item) => item.placeId)))
      .toContain("place-oak-valley-resort");
    // 오크밸리는 운영시간 미확인이라 경고와 함께 배치된다 (#43 계약)
    expect(res.result.warnings).toContainEqual({
      code: "ACTIVITY_WINDOW_MISMATCH",
      placeId: "place-oak-valley-resort",
      detail: "UNVERIFIED_HOURS",
    });
  });

  // #56 (d): 전주 경기전은 정적 MVP 자격 미충족으로 시드에서 제외 — TRAIN_UNAVAILABLE
  // 동적 표시 대상이 아니다(#61 정적/동적 분리). 부재 회귀는 schema.test.ts가 고정한다.
});
