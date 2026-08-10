import { describe, expect, it } from "vitest";
import {
  draftContentEquals,
  draftDecision,
  draftFromInput,
  restoreBlocksSave,
  type DraftInput,
  type RestoreState,
} from "../local-draft";
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
  airportReadyTouched: false,
  airportDeadlineTouched: false,
};

const input: DraftInput = {
  trip,
  context: {
    actors: [{ id: "actor-kim-go-eun", name: { ko: "김고은", en: "Kim Go-eun" } }],
    works: [],
  },
  selectedPlaceIds: ["place-yeongjin-beach", "place-lala-muri"],
};

const at = (iso: string) => new Date(iso);

describe("언제 초안을 쓰는가", () => {
  /**
   * 재열람 중 초안을 덮으면, 새로고침했을 때 사용자가 만들던 조율이 아니라 저장해 둔
   * 남의 일정이 복구된다. 자동 재계산이 재열람을 건너뛰는 것과 같은 이유다.
   */
  it("재열람 중에는 쓰지 않는다 — 내용이 바뀌었어도", () => {
    expect(draftDecision({ enabled: false, changed: true, restorePending: false })).toBe("skip");
  });

  it("내용이 그대로면 쓰지 않는다 — 디바운스가 무의미해지지 않게", () => {
    expect(draftDecision({ enabled: true, changed: false, restorePending: false })).toBe("skip");
  });

  it("조율 중이고 내용이 바뀌었으면 쓴다", () => {
    expect(draftDecision({ enabled: true, changed: true, restorePending: false })).toBe("save");
  });

  /**
   * PR #127 리뷰 3 — 마운트 직후 화면은 아직 초기값이다. 복구가 배우·작품·후보 재조회를
   * 포함해 늦게 끝나는 동안 저장이 돌면, 방금 읽은 초안이 빈 선택 상태로 덮인다.
   */
  it("복구가 끝나기 전에는 쓰지 않는다 — 초기값으로 덮어쓰지 않게", () => {
    expect(draftDecision({ enabled: true, changed: true, restorePending: true })).toBe("skip");
  });

  it("복구 대기는 다른 조건보다 우선한다", () => {
    for (const enabled of [true, false]) {
      for (const changed of [true, false]) {
        expect(draftDecision({ enabled, changed, restorePending: true })).toBe("skip");
      }
    }
  });
});

/**
 * PR #127 2차 리뷰 — 저장 잠금은 복구 상태 하나로 결정된다.
 *
 * 성공이 늦는 동안만 막고 실패에는 열어 주면, 화면이 복원되지 않은 채로 자동 저장이 돌아
 * **원본 초안을 초기값·부분 상태로 덮는다.** 오프라인·일시 오류에서 오히려 원본을 잃는다.
 */
describe("복구 상태가 저장 잠금을 정한다", () => {
  it("복구할 초안이 없으면 처음부터 열려 있다", () => {
    expect(restoreBlocksSave("none")).toBe(false);
  });

  it("복구 중에는 막는다", () => {
    expect(restoreBlocksSave("pending")).toBe(true);
  });

  it("복구에 성공해야 열린다", () => {
    expect(restoreBlocksSave("restored")).toBe(false);
  });

  it("복구가 실패하면 계속 막는다 — 원본 초안을 지킨다", () => {
    expect(restoreBlocksSave("failed")).toBe(true);
  });

  it("열리는 상태는 none과 restored 둘뿐이다", () => {
    const states: RestoreState[] = ["none", "pending", "restored", "failed"];
    expect(states.filter((s) => !restoreBlocksSave(s))).toEqual(["none", "restored"]);
  });

  it("막히면 저장 판단도 skip이다 — 두 함수가 어긋나지 않게", () => {
    for (const state of ["pending", "failed"] as RestoreState[]) {
      expect(
        draftDecision({ enabled: true, changed: true, restorePending: restoreBlocksSave(state) }),
        state,
      ).toBe("skip");
    }
    expect(
      draftDecision({ enabled: true, changed: true, restorePending: restoreBlocksSave("restored") }),
    ).toBe("save");
  });
});

describe("바뀐 것으로 볼지", () => {
  it("쓴 적이 없으면 바뀐 것이다", () => {
    expect(draftContentEquals(null, input)).toBe(false);
  });

  it("같은 내용이면 같다고 본다", () => {
    const draft = draftFromInput(input, at("2026-08-10T00:00:00.000Z"));
    expect(draftContentEquals(draft, input)).toBe(true);
  });

  /**
   * savedAt은 쓸 때마다 달라진다. 비교에 넣으면 항상 "바뀜"이 되어 디바운스가 무의미해지고
   * 타이핑 한 글자마다 저장소에 쓴다.
   */
  it("savedAt이 달라도 내용이 같으면 같다", () => {
    const older = draftFromInput(input, at("2026-08-01T00:00:00.000Z"));
    const newer = draftFromInput(input, at("2026-08-10T00:00:00.000Z"));
    expect(older.savedAt).not.toBe(newer.savedAt);
    expect(draftContentEquals(older, input)).toBe(true);
  });

  it("선택 순서만 다르면 같다 — 순서는 의미가 없다", () => {
    const draft = draftFromInput(input, at("2026-08-10T00:00:00.000Z"));
    const reordered: DraftInput = {
      ...input,
      selectedPlaceIds: [...input.selectedPlaceIds].reverse(),
    };
    expect(draftContentEquals(draft, reordered)).toBe(true);
  });

  /**
   * PR #127 리뷰 1 — 시각이 같아도 파생 여부가 달라졌으면 다른 상태다. 이걸 놓치면
   * 자동으로 따라오던 공항 시각이 굳거나, 사용자가 직접 고친 값이 덮인다.
   */
  it("공항 시각의 touched가 달라지면 다르다 — 시각이 같아도", () => {
    const draft = draftFromInput(input, at("2026-08-10T00:00:00.000Z"));
    for (const key of ["airportReadyTouched", "airportDeadlineTouched"] as const) {
      const changed: DraftInput = { ...input, trip: { ...trip, [key]: true } };
      expect(draftContentEquals(draft, changed), key).toBe(false);
    }
  });

  it("배우·작품 선택이 달라지면 다르다", () => {
    const draft = draftFromInput(input, at("2026-08-10T00:00:00.000Z"));
    const noActor: DraftInput = { ...input, context: { actors: [], works: [] } };
    const addedWork: DraftInput = {
      ...input,
      context: { ...input.context, works: [{ id: "work-goblin", title: { ko: "도깨비", en: "Goblin" } }] },
    };
    expect(draftContentEquals(draft, noActor)).toBe(false);
    expect(draftContentEquals(draft, addedWork)).toBe(false);
  });

  it("여행 조건이 하나라도 다르면 다르다", () => {
    const draft = draftFromInput(input, at("2026-08-10T00:00:00.000Z"));
    for (const key of ["arrivalAt", "departureAt", "airportReadyAt", "airportArrivalDeadline"] as const) {
      const changed: DraftInput = { ...input, trip: { ...trip, [key]: "2026-09-01T00:00" } };
      expect(draftContentEquals(draft, changed), key).toBe(false);
    }
  });

  it("장소 선택이 늘거나 줄면 다르다", () => {
    const draft = draftFromInput(input, at("2026-08-10T00:00:00.000Z"));
    expect(draftContentEquals(draft, { ...input, selectedPlaceIds: ["place-yeongjin-beach"] })).toBe(false);
  });

  it("같은 개수라도 내용이 다르면 다르다 — 길이만 보지 않는다", () => {
    const draft = draftFromInput(input, at("2026-08-10T00:00:00.000Z"));
    const swapped: DraftInput = {
      ...input,
      selectedPlaceIds: ["place-yeongjin-beach", "place-woljeongsa-temple"],
    };
    expect(draftContentEquals(draft, swapped)).toBe(false);
  });
});

/**
 * PR #129 리뷰 — 최종 저장 뒤 초안이 되살아나던 경쟁 조건.
 *
 * 키만 지우면 훅의 비교 기준(`lastWritten`)은 예전 상태로 남아 있어, 지운 직후 현재
 * 화면이 "바뀐 것"으로 보여 다시 쓰인다. `finalizeDraft`는 지금 화면을 기준으로 삼아
 * 그 즉시 재저장을 막는다 — 아래가 그 성질이다.
 */
describe("종료 시 비교 기준 갱신", () => {
  it("지금 화면을 기준으로 삼으면 곧바로 다시 쓰이지 않는다", () => {
    const baseline = draftFromInput(input, at("2026-08-10T12:00:00.000Z"));
    expect(draftContentEquals(baseline, input)).toBe(true);
    expect(
      draftDecision({ enabled: true, restorePending: false, changed: !draftContentEquals(baseline, input) }),
    ).toBe("skip");
  });

  it("그 뒤 사용자가 실제로 바꾸면 다시 열린다", () => {
    const baseline = draftFromInput(input, at("2026-08-10T12:00:00.000Z"));
    const changed: DraftInput = { ...input, selectedPlaceIds: ["place-yeongjin-beach"] };
    expect(
      draftDecision({ enabled: true, restorePending: false, changed: !draftContentEquals(baseline, changed) }),
    ).toBe("save");
  });
});

describe("저장 형태", () => {
  it("쓰는 시점의 시각을 붙이고 선택은 그대로 담는다", () => {
    const when = at("2026-08-10T12:34:56.000Z");
    const draft: LocalDraft = draftFromInput(input, when);
    expect(draft.savedAt).toBe(when.toISOString());
    expect(draft.trip).toEqual(trip);
    expect(draft.context.actors[0].name.ko).toBe("김고은");
    expect(draft.selectedPlaceIds).toEqual(input.selectedPlaceIds);
  });
});
