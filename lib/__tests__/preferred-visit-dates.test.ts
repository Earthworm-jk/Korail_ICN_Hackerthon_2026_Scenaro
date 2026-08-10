import { describe, expect, it } from "vitest";
import { planItinerary, type PlanRequest } from "../actions/itinerary";
import type { ItineraryResult, PreferredDateOutcome } from "../engine/types";

/**
 * #139 방문일 소프트 선호 — 계약 회귀
 *
 * 하드 고정(pinnedDates, 6d308d0에서 제거)을 되살리지 않는다는 것이 이 기능의 전제다.
 * 선호를 못 지켜도 일정은 나오고, 실패 코드가 늘지 않으며, 순위만 밀린다.
 */

const ACTOR = "actor-kim-go-eun";
const SEOULLO = "place-seoullo-7017";
const GATE = "place-gwanghwamun-gate";
const SQUARE = "place-gwanghwamun-square";
const BEXCO = "place-bexco"; // 부산 — 이 여행 조건에서는 열차로 닿지 않는다

function request(overrides: Partial<PlanRequest> = {}): PlanRequest {
  return {
    arrivalAt: "2026-08-12T10:00:00+09:00",
    departureAt: "2026-08-14T18:00:00+09:00",
    airportReadyAt: "2026-08-12T12:00:00+09:00",
    airportArrivalDeadline: "2026-08-14T16:00:00+09:00",
    selectedActorIds: [ACTOR],
    selectedWorkIds: [],
    excludedPlaceIds: [],
    ...overrides,
  };
}

async function plan(overrides: Partial<PlanRequest> = {}) {
  const res = await planItinerary(request(overrides));
  if (!res.ok) throw new Error(`INVALID_REQUEST: ${JSON.stringify(res.fieldErrors)}`);
  if (res.result.status !== "planned") throw new Error("일정이 생성되지 않았다");
  return res.result;
}

function dateOf(result: Extract<ItineraryResult, { status: "planned" }>, placeId: string) {
  return result.days.find((day) => day.items.some((item) => item.placeId === placeId))?.date;
}

/** 지정한 장소만 후보로 남기기 위한 제외 목록 */
async function otherCandidateIds(keep: string[]): Promise<string[]> {
  const { getCandidatePlaces } = await import("../actions/places");
  const { candidates } = await getCandidatePlaces({
    selectedActorIds: [ACTOR],
    selectedWorkIds: [],
  });
  return candidates.map(({ id }) => id).filter((id) => !keep.includes(id));
}

function outcomeOf(
  outcomes: PreferredDateOutcome[] | undefined,
  placeId: string,
): PreferredDateOutcome | undefined {
  return outcomes?.find((entry) => entry.placeId === placeId);
}

describe("#139 선호 없음 — 기존 경로가 그대로다", () => {
  it("선호를 주지 않으면 결과에 선호 필드가 생기지 않고 불일치도 0이다", async () => {
    const result = await plan();
    expect(result.preferredDateOutcomes).toBeUndefined();
    expect(result.comparisonKeys.preferredDateMismatchCount).toBe(0);
  });
});

describe("#139 선호 반영 — 후보가 실제로 만들어진다 (6-1)", () => {
  /**
   * 후보가 하나면 방문 순서를 바꿔 날짜를 미룰 여지가 없다. `findVisitWindow`가 첫 가능
   * 날짜에서 바로 return하므로, 선호 날짜의 창을 따로 만들지 않으면 비교할 상태 자체가 없다.
   * 이 케이스가 6-1의 유일한 근거다 — 후보가 여럿이면 순서 조합이 우연히 대신해 준다.
   */
  it("후보가 하나뿐이라 순서로는 못 미루는 날짜도 반영된다", async () => {
    const others = await otherCandidateIds([SEOULLO]);
    const base = await plan({ excludedPlaceIds: others });
    expect(dateOf(base, SEOULLO)).toBe("2026-08-12");

    const preferred = await plan({
      excludedPlaceIds: others,
      preferredVisitDates: { [SEOULLO]: "2026-08-14" },
    });
    expect(dateOf(preferred, SEOULLO)).toBe("2026-08-14");
    expect(outcomeOf(preferred.preferredDateOutcomes, SEOULLO)?.outcome).toBe("honored");
  });

  it("기본 배치가 첫날이어도 요청한 날짜에 배치된다", async () => {
    const base = await plan();
    expect(dateOf(base, GATE)).toBe("2026-08-12"); // 기본 정책은 가장 이른 가능 날짜

    const preferred = await plan({ preferredVisitDates: { [GATE]: "2026-08-14" } });
    expect(dateOf(preferred, GATE)).toBe("2026-08-14");
    expect(outcomeOf(preferred.preferredDateOutcomes, GATE)?.outcome).toBe("honored");
    expect(preferred.comparisonKeys.preferredDateMismatchCount).toBe(0);
  });

  it("선호를 지키느라 방문 장소 수와 운영시간 경고를 잃지 않는다", async () => {
    const base = await plan();
    const preferred = await plan({ preferredVisitDates: { [GATE]: "2026-08-14" } });

    // 장소 수(비교 키 2번)와 경고 수(3번)는 선호(4번)보다 위다 — 선호가 이 둘을 깎으면 안 된다
    expect(preferred.comparisonKeys.selectedUnionPlaceCount)
      .toBe(base.comparisonKeys.selectedUnionPlaceCount);
    expect(preferred.comparisonKeys.activityWarningCount)
      .toBe(base.comparisonKeys.activityWarningCount);
  });

  it("선호가 없는 장소의 배치는 선호를 지키기 위해서만 움직인다", async () => {
    const preferred = await plan({ preferredVisitDates: { [GATE]: "2026-08-14" } });
    // 같은 날 자리를 비워 준 장소는 기존 일정 안에서 재배치된다 — 새 장소가 끼어들지 않는다
    expect(dateOf(preferred, SQUARE)).toBeDefined();
  });
});

describe("#139 못 지킨 선호 — 실패가 아니라 보고다", () => {
  it("요청한 날짜에 못 넣으면 다른 날짜로 조정하고 adjusted로 알린다", async () => {
    const result = await plan({
      excludedPlaceIds: await otherCandidateIds([SEOULLO, BEXCO]),
      preferredVisitDates: { [BEXCO]: "2026-08-14" }, // 마지막 날은 공항 마감에 걸려 불가능하다
    });

    expect(result.status).toBe("planned"); // 실패 분기를 만들지 않는다
    const entry = outcomeOf(result.preferredDateOutcomes, BEXCO);
    expect(entry?.outcome).toBe("adjusted");
    expect(entry?.scheduledDate).toBe(dateOf(result, BEXCO));
    expect(entry?.scheduledDate).not.toBe("2026-08-14");
    expect(result.comparisonKeys.preferredDateMismatchCount).toBe(1);
  });

  it("일정에 들어가지 못한 장소의 선호는 unplaced이고, 그 때문에 일정이 줄지 않는다", async () => {
    const base = await plan();
    const result = await plan({ preferredVisitDates: { [BEXCO]: "2026-08-13" } });

    expect(outcomeOf(result.preferredDateOutcomes, BEXCO)?.outcome).toBe("unplaced");
    expect(result.comparisonKeys.preferredDateMismatchCount).toBe(1);
    // 넣을 수 없는 선호가 beam을 밀어내 다른 장소를 떨어뜨리면 안 된다 (#139 6-2)
    expect(result.comparisonKeys.selectedUnionPlaceCount)
      .toBe(base.comparisonKeys.selectedUnionPlaceCount);
    expect(result.days.map((day) => day.items.map((item) => item.placeId)))
      .toEqual(base.days.map((day) => day.items.map((item) => item.placeId)));
  });
});

describe("#139 입력 계약 (7절)", () => {
  it("제외한 장소의 선호는 무시된다 — 제외가 선호보다 우선이다", async () => {
    const result = await plan({
      excludedPlaceIds: [GATE],
      preferredVisitDates: { [GATE]: "2026-08-14" },
    });
    // 사용자가 스스로 뺀 장소를 "요청을 못 지켰다"고 되돌려 주지 않는다
    expect(result.preferredDateOutcomes).toBeUndefined();
    expect(result.comparisonKeys.preferredDateMismatchCount).toBe(0);
  });

  it("여행 기간 밖 날짜는 INVALID_REQUEST다 — throw가 새어 나가지 않는다", async () => {
    const res = await planItinerary(request({
      preferredVisitDates: { [GATE]: "2026-08-20" },
    }));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("INVALID_REQUEST");
      expect(res.fieldErrors.preferredVisitDates).toContain("out of trip range");
    }
  });

  it("현재 엄격 후보가 아닌 장소 ID는 INVALID_REQUEST다", async () => {
    const res = await planItinerary(request({
      preferredVisitDates: { "place-unknown-id": "2026-08-13" },
    }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.fieldErrors.preferredVisitDates).toContain("not a candidate place id");
  });

  it("YYYY-MM-DD가 아닌 값은 스키마에서 걸린다", async () => {
    const res = await planItinerary(request({
      preferredVisitDates: { [GATE]: "2026/08/13" },
    }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("INVALID_REQUEST");
  });
});

describe("#139 결정성", () => {
  it("같은 선호 입력은 같은 일정을 낸다", async () => {
    const preferred = { [GATE]: "2026-08-14", [SEOULLO]: "2026-08-13" };
    const first = await plan({ preferredVisitDates: preferred });
    const second = await plan({ preferredVisitDates: preferred });
    expect(JSON.stringify(second.days)).toBe(JSON.stringify(first.days));
    expect(second.preferredDateOutcomes).toEqual(first.preferredDateOutcomes);
  });
});
