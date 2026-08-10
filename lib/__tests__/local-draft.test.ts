import { describe, expect, it } from "vitest";
import { draftContentEquals, draftDecision, draftFromInput, type DraftInput } from "../local-draft";
import type { LocalDraft } from "../local-itineraries";

/**
 * 초안 저장 판단 (#118 P0-3)
 *
 * 훅을 직접 렌더할 테스트 인프라가 없어(이 저장소에 React 테스트 설정이 없다)
 * `lib/auto-plan.ts`(#85)·`lib/save-routing.ts`(#123) 선례대로 판단만 순수 함수로 분리했다.
 * 훅과 테스트가 같은 함수를 쓴다.
 */

const trip = {
  arrivalAt: "2026-08-12T10:00",
  departureAt: "2026-08-14T18:00",
  airportReadyAt: "2026-08-12T12:00",
  airportArrivalDeadline: "2026-08-14T16:00",
};

const input: DraftInput = {
  trip,
  selectedActorIds: ["actor-kim-go-eun"],
  selectedWorkIds: [],
  selectedPlaceIds: ["place-yeongjin-beach", "place-lala-muri"],
};

describe("언제 초안을 쓰는가", () => {
  /**
   * 재열람 중 초안을 덮으면, 새로고침했을 때 사용자가 만들던 조율이 아니라 저장해 둔
   * 남의 일정이 복구된다. 자동 재계산이 재열람을 건너뛰는 것과 같은 이유다.
   */
  it("재열람 중에는 쓰지 않는다 — 내용이 바뀌었어도", () => {
    expect(draftDecision({ enabled: false, changed: true })).toBe("skip");
  });

  it("내용이 그대로면 쓰지 않는다 — 디바운스가 무의미해지지 않게", () => {
    expect(draftDecision({ enabled: true, changed: false })).toBe("skip");
  });

  it("조율 중이고 내용이 바뀌었으면 쓴다", () => {
    expect(draftDecision({ enabled: true, changed: true })).toBe("save");
  });
});

describe("바뀐 것으로 볼지", () => {
  it("쓴 적이 없으면 바뀐 것이다", () => {
    expect(draftContentEquals(null, input)).toBe(false);
  });

  it("같은 내용이면 같다고 본다", () => {
    const draft = draftFromInput(input, new Date("2026-08-10T00:00:00.000Z"));
    expect(draftContentEquals(draft, input)).toBe(true);
  });

  /**
   * savedAt은 쓸 때마다 달라진다. 비교에 넣으면 항상 "바뀜"이 되어 디바운스가 무의미해지고
   * 타이핑 한 글자마다 저장소에 쓴다.
   */
  it("savedAt이 달라도 내용이 같으면 같다", () => {
    const older = draftFromInput(input, new Date("2026-08-01T00:00:00.000Z"));
    const newer = draftFromInput(input, new Date("2026-08-10T00:00:00.000Z"));
    expect(older.savedAt).not.toBe(newer.savedAt);
    expect(draftContentEquals(older, input)).toBe(true);
  });

  it("선택 순서만 다르면 같다 — 순서는 의미가 없다", () => {
    const draft = draftFromInput(input, new Date("2026-08-10T00:00:00.000Z"));
    const reordered: DraftInput = {
      ...input,
      selectedPlaceIds: [...input.selectedPlaceIds].reverse(),
    };
    expect(draftContentEquals(draft, reordered)).toBe(true);
  });

  it("여행 조건이 하나라도 다르면 다르다", () => {
    const draft = draftFromInput(input, new Date("2026-08-10T00:00:00.000Z"));
    for (const key of ["arrivalAt", "departureAt", "airportReadyAt", "airportArrivalDeadline"] as const) {
      const changed: DraftInput = { ...input, trip: { ...trip, [key]: "2026-09-01T00:00" } };
      expect(draftContentEquals(draft, changed), key).toBe(false);
    }
  });

  it("선택이 늘거나 줄면 다르다", () => {
    const draft = draftFromInput(input, new Date("2026-08-10T00:00:00.000Z"));
    expect(draftContentEquals(draft, { ...input, selectedPlaceIds: ["place-yeongjin-beach"] })).toBe(false);
    expect(draftContentEquals(draft, { ...input, selectedWorkIds: ["work-goblin"] })).toBe(false);
    expect(draftContentEquals(draft, { ...input, selectedActorIds: [] })).toBe(false);
  });

  it("같은 개수라도 내용이 다르면 다르다 — 길이만 보지 않는다", () => {
    const draft = draftFromInput(input, new Date("2026-08-10T00:00:00.000Z"));
    const swapped: DraftInput = {
      ...input,
      selectedPlaceIds: ["place-yeongjin-beach", "place-woljeongsa-temple"],
    };
    expect(draftContentEquals(draft, swapped)).toBe(false);
  });
});

describe("저장 형태", () => {
  it("쓰는 시점의 시각을 붙이고 선택은 그대로 담는다", () => {
    const at = new Date("2026-08-10T12:34:56.000Z");
    const draft: LocalDraft = draftFromInput(input, at);
    expect(draft.savedAt).toBe(at.toISOString());
    expect(draft.trip).toEqual(trip);
    expect(draft.selectedPlaceIds).toEqual(input.selectedPlaceIds);
  });
});
