/**
 * 과선택 대표 시나리오 E2E (#171 · #84).
 *
 * 층마다 회귀는 이미 있다. 그런데 **층별 테스트는 전부 통과하면서 배선이 끊길 수 있다** —
 * 실제로 #175에서 여섯 번 그랬다. 계약을 선언한 쪽과 쓰는 쪽이 각자 맞으면 각자의
 * 테스트는 초록이고, 둘을 잇는 줄만 없다.
 *
 * 그래서 이 파일은 **화면이 걷는 순서를 그대로 걷는다.** 콘텐츠를 고르고, 재계산하고,
 * 과선택을 만나고, 제안을 받고, 손보고, 승인하고, 되돌린다. 중간을 흉내내지 않고
 * 실제 모듈을 실제 순서로 부른다.
 */
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * **키 없음을 테스트가 직접 만든다** (PR #193 리뷰).
 *
 * `env`는 모듈 로드 시 파싱된다. 그래서 실행 환경에 `OPENAI_API_KEY`가 있으면
 * 아래 "키 없이도 완주한다"가 **키를 쓰고도 통과한다** — 이름과 다른 것을 검증하고,
 * 개발자 머신과 CI에서 결과가 갈린다. 조건을 환경에 맡기지 않고 여기서 고정한다.
 */
vi.mock("../env", async (importOriginal) => {
  const original = await importOriginal<typeof import("../env")>();
  return { ...original, env: { ...original.env, OPENAI_API_KEY: undefined } };
});
import { getCandidatePlaces } from "../actions/places";
import { planItinerary, type PlanRequest } from "../actions/itinerary";
import { runItineraryCommand } from "../actions/itinerary-command";
import { excludedPlaceIdsFrom, initialCandidateIds } from "../candidates";
import { selectionResultIsCurrent } from "../selection-capacity";
import {
  displayedDays,
  displayedSelectionCapacity,
  initialItineraryView,
  reduceItineraryView,
  rejectedPlaces,
  type ItineraryView,
} from "../itinerary-view";
import {
  commandInputUnavailable,
  commandPanelUnavailable,
  editedKeepPlaceIds,
  overselectionProposalOf,
  proposalEditAfterChange,
  proposalSignature,
  selectionUndoAfterChange,
} from "../itinerary-command-ui";

/** 이슈의 재현 조건 — 배우 넷과 작품 하나를 고르면 후보가 통째로 선택된다 */
const SELECTION = {
  selectedActorIds: [
    "actor-kim-go-eun",
    "actor-park-bo-gum",
    "actor-gong-yoo",
    "actor-lee-min-ho",
  ],
  selectedWorkIds: ["work-goblin"],
};

const TRIP = {
  arrivalAt: "2026-08-12T10:00:00+09:00",
  departureAt: "2026-08-14T18:00:00+09:00",
  airportReadyAt: "2026-08-12T12:00:00+09:00",
  airportArrivalDeadline: "2026-08-14T16:00:00+09:00",
};

/**
 * 화면 상태를 그대로 옮긴 것 — `app/planner-wizard.tsx` 와 같은 함수를 같은 순서로 부른다.
 *
 * 값을 흉내내지 않는다. 재계산은 진짜 엔진을 돌리고, 게이트·제안·되돌리기는 화면이
 * 쓰는 바로 그 함수가 판단한다. 배선이 끊기면 여기서 깨진다.
 */
class Screen {
  candidates: { id: string }[] = [];
  selected = new Set<string>();
  view: ItineraryView = initialItineraryView;
  updating = false;
  selectionUndo: { previousPlaceIds: string[]; appliedPlaceIds: string[] } | null = null;
  proposalEdit: { signature: string; removedPlaceIds: string[] } | null = null;

  /** 콘텐츠를 고른 직후 — 검증된 촬영지가 전부 선택된다 (#51 계약) */
  async chooseContent() {
    const data = await getCandidatePlaces(SELECTION);
    this.candidates = data.candidates;
    this.selected = new Set(initialCandidateIds(data.candidates));
  }

  get request(): PlanRequest {
    return {
      ...TRIP,
      ...SELECTION,
      excludedPlaceIds: excludedPlaceIdsFrom(this.candidates, this.selected),
    };
  }

  async recalculate() {
    this.updating = true;
    this.view = reduceItineraryView(this.view, { type: "PLAN_START" });
    const action = await planItinerary(this.request);
    this.view = action.ok
      ? reduceItineraryView(this.view, { type: "PLAN_SUCCESS", result: action.result })
      : reduceItineraryView(this.view, { type: "PLAN_FAILED" });
    this.updating = false;
  }

  get capacity() {
    return displayedSelectionCapacity(this.view, this.selected);
  }

  /** 배치 수를 말해도 되는가 — 표시 중인 결과가 현재 선택의 것일 때만 */
  get selectionStateShown(): boolean {
    const days = displayedDays(this.view);
    if (this.updating || this.capacity === null || !days) return false;
    return selectionResultIsCurrent(
      this.selected,
      days,
      rejectedPlaces(this.view).map((rejection) => rejection.placeId),
    );
  }

  private get gate() {
    return {
      hasCandidates: this.candidates.length > 0,
      hasPlannedResult: this.view.result?.status === "planned",
      reopened: this.view.reopened !== null,
      alternativeSelected: this.view.selectedAlt !== null,
      requiresSelectionAdjustment: this.capacity?.requiresAdjustment === true,
    };
  }

  get panelBlocked() { return commandPanelUnavailable(this.gate); }
  get inputDisabled() { return commandInputUnavailable(this.gate); }

  get proposal() {
    return overselectionProposalOf({
      capacity: this.capacity,
      selectionStateShown: this.selectionStateShown,
    });
  }

  /** 렌더마다 통과시킨다 — 제안이 사라지거나 바뀌면 편집을 버린다 */
  get liveEdit() {
    return proposalEditAfterChange(this.proposalEdit, this.proposal?.keepPlaceIds ?? null);
  }

  /** 화면이 실제로 보여주는 "남길 곳" */
  get keptPlaceIds() {
    const proposal = this.proposal;
    return proposal ? editedKeepPlaceIds(proposal.keepPlaceIds, this.liveEdit) : [];
  }

  toggleKeep(placeId: string) {
    const proposal = this.proposal;
    if (!proposal) return;
    const signature = proposalSignature(proposal.keepPlaceIds);
    const removed = new Set(
      this.proposalEdit?.signature === signature ? this.proposalEdit.removedPlaceIds : [],
    );
    if (removed.has(placeId)) removed.delete(placeId);
    else removed.add(placeId);
    this.proposalEdit = { signature, removedPlaceIds: [...removed] };
  }

  /** 승인 — 여기서 처음으로 선택이 바뀐다 */
  applyProposal() {
    const proposal = this.proposal;
    if (proposal === null) return;
    const keep = editedKeepPlaceIds(
      proposal.keepPlaceIds,
      proposalEditAfterChange(this.proposalEdit, proposal.keepPlaceIds),
    );
    if (keep.length === 0) return;
    this.selectionUndo = { previousPlaceIds: [...this.selected], appliedPlaceIds: [...keep] };
    this.proposalEdit = null;
    this.selected = new Set(keep);
  }

  get undoAvailable() {
    return selectionUndoAfterChange(this.selectionUndo, this.selected) !== null;
  }

  undo() {
    const undo = selectionUndoAfterChange(this.selectionUndo, this.selected);
    if (undo === null) return;
    this.selected = new Set(undo.previousPlaceIds);
    this.selectionUndo = null;
  }

  toggleCandidate(placeId: string) {
    if (this.selected.has(placeId)) this.selected.delete(placeId);
    else this.selected.add(placeId);
    // 화면이 매 렌더에서 하는 폐기를 여기서도 통과시킨다
    this.selectionUndo = selectionUndoAfterChange(this.selectionUndo, this.selected);
  }
}

describe("#171 과선택 대표 시나리오 — 화면이 걷는 순서 그대로", () => {
  let screen: Screen;

  beforeAll(async () => {
    screen = new Screen();
    await screen.chooseContent();
    await screen.recalculate();
  });

  it("① 콘텐츠를 고르면 후보가 통째로 선택되고, 일정에는 일부만 들어간다", () => {
    const capacity = screen.capacity;
    expect(capacity).not.toBeNull();
    if (capacity === null) return;

    // 사용자가 욕심을 낸 것이 아니라 기본값이 그렇다 (#51)
    expect(capacity.selectedCount).toBe(screen.candidates.length);
    expect(capacity.requiresAdjustment).toBe(true);
    expect(capacity.schedulableCount).toBeLessThan(capacity.selectedCount);
    expect(capacity.minimumExclusionCount).toBe(
      capacity.selectedCount - capacity.schedulableCount,
    );
    // 개수와 목록이 어긋나면 화면이 셋을 말하고 넷을 그린다
    expect(capacity.scheduledPlaceIds).toHaveLength(capacity.schedulableCount);
    expect(capacity.unscheduledPlaceIds).toHaveLength(capacity.minimumExclusionCount);
  });

  it("② 패널은 열리고 입력만 막힌다 — 이유 없이 회색인 버튼이 아니다", () => {
    expect(screen.panelBlocked).toBe(false);
    expect(screen.inputDisabled).toBe(true);
  });

  it("③ 제안은 들어가는 곳을 이름으로 준다 — 개수만이 아니다", () => {
    const proposal = screen.proposal;
    expect(proposal).not.toBeNull();
    if (proposal === null) return;
    expect(proposal.keepPlaceIds).toEqual(screen.capacity?.scheduledPlaceIds);
    expect(proposal.dropCount).toBe(screen.capacity?.minimumExclusionCount);
    expect(proposal.selectedCount).toBe(screen.capacity?.selectedCount);
  });

  it("④ 제안을 보고 손봐도 승인 전에는 선택이 그대로다 — 조용한 변경 금지 (#84)", () => {
    const before = new Set(screen.selected);
    const dropped = screen.proposal?.keepPlaceIds[0];
    expect(dropped).toBeDefined();
    if (dropped === undefined) return;

    screen.toggleKeep(dropped);

    // 화면이 보여주는 목록에서는 빠졌다
    expect(screen.keptPlaceIds).not.toContain(dropped);
    expect(screen.keptPlaceIds).toHaveLength(screen.proposal!.keepPlaceIds.length - 1);
    // 그런데 실제 선택과 일정은 아직 아무것도 안 바뀌었다
    expect(screen.selected).toEqual(before);
    expect(screen.capacity?.requiresAdjustment).toBe(true);
  });

  it("⑤ 승인하면 손본 그대로 적용되고 과선택이 풀린다", async () => {
    const expected = [...screen.keptPlaceIds];
    screen.applyProposal();

    expect([...screen.selected].sort()).toEqual([...expected].sort());
    await screen.recalculate();

    expect(screen.capacity?.requiresAdjustment).toBe(false);
    // 막혔던 입력이 열린다 — 이 줄이 끊기면 정리해도 AI가 계속 회색이다
    expect(screen.inputDisabled).toBe(false);
    expect(screen.proposal).toBeNull();
  });

  it("⑥ 되돌리면 원래 선택으로 돌아온다", async () => {
    expect(screen.undoAvailable).toBe(true);
    screen.undo();

    expect(screen.selected.size).toBe(screen.candidates.length);
    expect(screen.undoAvailable).toBe(false);

    await screen.recalculate();
    expect(screen.capacity?.requiresAdjustment).toBe(true);
  });

  /**
   * 되돌리기는 **적용 직후 한 단계**다. 한 번 벗어나면 집합이 우연히 같아져도 돌아오지
   * 않는다 — 그 사이 작업이 통째로 덮이기 때문이다 (PR #185 리뷰 3회차).
   */
  it("⑦ 승인 뒤 후보를 껐다 켜면 되돌리기는 사라진 채로 남는다", () => {
    const fresh = new Screen();
    fresh.candidates = [...screen.candidates];
    fresh.selected = new Set(initialCandidateIds(screen.candidates));
    fresh.view = screen.view;
    fresh.selectionUndo = {
      previousPlaceIds: initialCandidateIds(screen.candidates),
      appliedPlaceIds: initialCandidateIds(screen.candidates),
    };
    expect(fresh.undoAvailable).toBe(true);

    const wanderer = screen.candidates[0]!.id;
    fresh.toggleCandidate(wanderer);
    expect(fresh.undoAvailable).toBe(false);
    fresh.toggleCandidate(wanderer); // 같은 집합으로 돌아왔다

    expect(fresh.undoAvailable).toBe(false);
  });
});

/**
 * 이 하네스의 한계를 스스로 지킨다.
 *
 * `Screen`은 화면 로직을 **옮겨 적은 것**이다. 그래서 화면이 다른 함수로 갈아타면
 * 하네스는 그대로 초록인 채 **실제 화면만 깨진다** — 위 여덟 건이 통째로 무의미해진다.
 *
 * 화면을 그대로 렌더해 걷는 것이 정답이지만 클라이언트 컴포넌트라 이 층에서는 못 한다.
 * 대신 **하네스가 모델링한 진입점을 화면이 실제로 쓰고 있는지** 원본에서 확인한다.
 * 완전한 방어는 아니고, 갈아타는 순간 눈에 띄게 하는 장치다.
 */
describe("하네스가 화면과 같은 진입점을 본다", () => {
  const wizard = readFileSync(
    new URL("../../app/planner-wizard.tsx", import.meta.url),
    "utf-8",
  );

  const ENTRY_POINTS = [
    "initialCandidateIds",
    "excludedPlaceIdsFrom",
    "displayedSelectionCapacity",
    "selectionResultIsCurrent",
    "commandPanelUnavailable",
    "commandInputUnavailable",
    "overselectionProposalOf",
    "editedKeepPlaceIds",
    "proposalEditAfterChange",
    "selectionUndoAfterChange",
  ];

  it.each(ENTRY_POINTS)("화면이 %s 를 쓴다", (name) => {
    expect(wizard, `화면이 ${name} 를 더는 쓰지 않는다면 이 E2E 는 화면을 대변하지 못한다`)
      .toContain(name);
  });
});

/**
 * 오프라인 폴백 — **키 없이도 같은 흐름을 완주한다** (#160 결정).
 *
 * 심사 현장에서 OpenAI 가 죽어도 화면이 멈추면 안 된다. 해석만 결정적 폴백으로
 * 내려가고 검증·재계산·제안은 그대로여야 한다.
 */
describe("#171 과선택 — 키 없이도 완주한다", () => {
  /** 이 줄이 깨지면 아래 검증은 이름과 다른 것을 보고 있다 */
  it("전제 확인 — 이 파일에서 키는 없는 것으로 고정돼 있다", async () => {
    const { env } = await import("../env");
    expect(env.OPENAI_API_KEY).toBeUndefined();
  });

  it("정리한 뒤 개수 목표 명령이 모델 없이 제안까지 간다", async () => {
    const screen = new Screen();
    await screen.chooseContent();
    await screen.recalculate();
    screen.applyProposal();
    await screen.recalculate();
    expect(screen.capacity?.requiresAdjustment).toBe(false);

    const placed = screen.capacity?.schedulableCount ?? 0;
    expect(placed).toBeGreaterThan(1);

    const result = await runItineraryCommand({
      sentence: `${placed - 1}곳만 남겨줘`,
      request: screen.request,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 키가 없으면 해석만 폴백으로 내려간다
    expect(result.interpretation).toEqual({
      source: "deterministic",
      fallbackReason: "NO_API_KEY",
    });
    expect(result.outcome.kind).toBe("goal_proposal");
    if (result.outcome.kind !== "goal_proposal") return;
    expect(result.outcome.keepPlaceIds).toHaveLength(placed - 1);
    // 제안일 뿐 — 승인 전에는 일정이 바뀌지 않는다
    expect(result.outcome.nextRequest).not.toEqual(screen.request);
  });
});
