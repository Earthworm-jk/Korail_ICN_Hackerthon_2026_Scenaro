/**
 * 저장 → 다시 열기 → 항공편 변경 → 재계산 E2E (#6 품질·시연).
 *
 * 로드맵의 최종 MVP 완료 기준에서 **`다시 연 일정에서 항공편 변경과 재계산`이 유일하게
 * 비어 있던 인증·저장 항목**이다. 저장·목록·다시 열기는 PR #74로 닫혔는데, 다시 연
 * 뒤에 조건을 바꾸는 경로는 검증된 적이 없다.
 *
 * 이 경로는 조용히 깨진다. 재열람 중에는 **자동 재계산이 꺼져 있어서**
 * (`autoPlanDecision` → `skip`) 조건만 바꾸고 아무 일도 안 일어나면 화면은 저장 당시
 * 일정을 그대로 보여준다 — 사용자는 **바뀐 항공편이 반영된 일정을 보고 있다고 믿는다.**
 * 실패가 아니라 침묵이라 더 나쁘다.
 *
 * 그래서 reducer 계약만 보지 않는다. **항공 입력 → 요청 생성 → 액션 → reducer**를
 * 화면이 걷는 순서로 걷는다 (PR #195 리뷰). reducer에 이벤트를 직접 넣으면
 * `PLAN_SUCCESS`가 `reopened`를 지우는지만 증명되고, **바꾼 입력이 요청에 실리는지**는
 * 끊겨도 초록이다.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { planItinerary, type PlanRequest } from "../actions/itinerary";
import { getCandidatePlaces, type PlaceCandidate } from "../actions/places";
import { searchEntities, type ActorSummary, type WorkSummary } from "../actions/search";
import { excludedPlaceIdsFrom, initialCandidateIds } from "../candidates";
import { autoPlanDecision } from "../auto-plan";
import { toKstLocalInput } from "../kst-datetime";
import {
  constraintsFromTripInputs,
  tripInputsFromConstraints,
  SAVED_SCHEMA_VERSION,
  type SavedItineraryStub,
} from "../saved-itineraries-stub";
import {
  displayedDays,
  initialItineraryView,
  reduceItineraryView,
  type ItineraryView,
} from "../itinerary-view";

type Context = { actors: ActorSummary[]; works: WorkSummary[] };

/**
 * 화면이 들고 있는 것은 ID가 아니라 **검색으로 고른 요약 객체**다 (PR #195 리뷰 2번).
 * 재열람은 이 상태를 `record.context`에서 되살리고, 요청의 ID는 거기서 나온다.
 */
async function pickedContext(actorQuery: string, actorId: string): Promise<Context> {
  const [byActor, byWork] = await Promise.all([
    searchEntities(actorQuery),
    searchEntities("도깨비"),
  ]);
  const actor = byActor.actors.find((a) => a.id === actorId);
  const work = byWork.works.find((w) => w.id === "work-goblin");
  if (!actor || !work) throw new Error(`검색으로 선택 context 를 못 만들었다: ${actorId}`);
  return { actors: [actor], works: [work] };
}

/**
 * **저장본과 지금 화면의 콘텐츠를 다르게 둔다.**
 *
 * 같은 조합이면 재열람이 선택 상태를 복원하지 않아도 값이 우연히 맞아 통과한다 —
 * 실제로 복원을 빼고 돌려보니 초록이었다. 다른 배우로 두면 복원이 빠지는 순간
 * 요청의 배우 ID 가 어긋나 바로 드러난다.
 */
const SAVED_ACTOR = { query: "김고은", id: "actor-kim-go-eun" };
const OTHER_ACTOR = { query: "박보검", id: "actor-park-bo-gum" };

const FIRST_TRIP = {
  arrivalAt: "2026-08-12T10:00:00+09:00",
  departureAt: "2026-08-14T18:00:00+09:00",
  airportReadyAt: "2026-08-12T12:00:00+09:00",
  airportArrivalDeadline: "2026-08-14T16:00:00+09:00",
};

/**
 * 지연 폭은 **2시간**이다. 처음에 4시간을 썼더니 일정이 아예 성립하지 않아
 * (`status: "empty"`) 테스트가 조기 반환으로 **빈 채 통과**했다 — 재열람 해제를
 * 뒤집어도 초록이었다. 이 파일에서 조기 반환을 쓰지 않는 이유다.
 */
const DELAY_HOURS = 2;

/** 하루를 장소 나열로 눌러 비교한다 — 무엇이 바뀌었는지 눈으로 읽히게 */
const shapeOf = (days: ReturnType<typeof displayedDays>) =>
  (days ?? []).map((day) => day.items.map((item) => item.placeId).join(","));

const shift = (iso: string, hours: number) =>
  new Date(Date.parse(iso) + hours * 3_600_000).toISOString();

/** 표기가 갈리므로(`+09:00` / `Z`) 시각으로 비교한다 */
const at = (iso: string | undefined) => Date.parse(iso ?? "");

/**
 * 화면 상태를 그대로 옮긴 것 — `app/planner-wizard.tsx`와 같은 함수를 같은 순서로 부른다.
 *
 * 특히 **항공 입력 네 칸을 실제로 들고 있다.** 재열람이 이 칸을 복원하지 않거나
 * 재계산이 이 칸 대신 저장 당시 조건을 보내면 여기서 깨진다.
 */
class Screen {
  candidates: PlaceCandidate[] | null = null;
  /** 화면의 `selectedActors`/`selectedWorks` — 재열람이 되살려야 하는 상태 */
  selectedActors: ActorSummary[] = [];
  selectedWorks: WorkSummary[] = [];
  selected = new Set<string>();
  view: ItineraryView = initialItineraryView;
  /** datetime-local 문자열 — 화면 입력과 같은 표현 */
  arrival = { at: "", touched: false };
  departure = { at: "", touched: false };
  airportReady = { at: "", touched: false };
  airportDeadline = { at: "", touched: false };
  /** 재계산이 실제로 보낸 요청 — 배선을 눈으로 확인하려고 남긴다 */
  lastSentRequest: PlanRequest | null = null;

  async startFrom(trip: typeof FIRST_TRIP, context: Context) {
    const inputs = tripInputsFromConstraints({
      ...trip,
      selectedActorIds: [],
      selectedWorkIds: [],
      excludedPlaceIds: [],
    });
    this.arrival = { at: inputs.arrivalAt, touched: false };
    this.departure = { at: inputs.departureAt, touched: false };
    this.airportReady = { at: inputs.airportReadyAt, touched: true };
    this.airportDeadline = { at: inputs.airportArrivalDeadline, touched: true };
    await this.chooseContent(context);
  }

  /** 콘텐츠를 고른다 — 후보는 **선택 상태의 ID** 로 받는다 */
  async chooseContent(context: Context) {
    this.selectedActors = context.actors;
    this.selectedWorks = context.works;
    const data = await getCandidatePlaces({
      selectedActorIds: this.selectedActors.map((a) => a.id),
      selectedWorkIds: this.selectedWorks.map((w) => w.id),
    });
    this.candidates = data.candidates;
    this.selected = new Set(initialCandidateIds(data.candidates));
  }

  /** 화면의 `currentConstraints()` — 후보가 없으면 아무것도 못 보낸다 */
  currentConstraints(): PlanRequest | null {
    if (!this.candidates) return null;
    // ID 는 상수가 아니라 **선택 상태에서 나온다** — 재열람이 상태를 안 되살리면 여기서 빈다
    return constraintsFromTripInputs(
      {
        arrivalAt: this.arrival.at,
        departureAt: this.departure.at,
        airportReadyAt: this.airportReady.at,
        airportArrivalDeadline: this.airportDeadline.at,
      },
      this.selectedActors.map((a) => a.id),
      this.selectedWorks.map((w) => w.id),
      excludedPlaceIdsFrom(this.candidates, this.selected),
    );
  }

  /** 화면의 `plan()` — 라이브 입력으로 요청을 만들어 보내고 결과를 reducer에 넣는다 */
  async plan() {
    const constraints = this.currentConstraints();
    if (!constraints) return;
    this.lastSentRequest = constraints;
    this.view = reduceItineraryView(this.view, { type: "PLAN_START" });
    try {
      const res = await planItinerary(constraints);
      this.view = res.ok
        ? reduceItineraryView(this.view, { type: "PLAN_SUCCESS", result: res.result })
        : reduceItineraryView(this.view, { type: "PLAN_INVALID" });
    } catch {
      this.view = reduceItineraryView(this.view, { type: "PLAN_FAILED" });
    }
  }

  /**
   * 화면의 `reopenRecord()` — **입력 네 칸을 저장 당시 값으로 되돌린다.**
   *
   * 공항 시각은 `touched: true`로 고정한다. 안 그러면 이후 항공편 변경이 파생
   * 기본값으로 덮어써 저장 당시 조건이 조용히 사라진다.
   */
  async reopen(record: SavedItineraryStub) {
    const c = record.constraints;
    const inputs = tripInputsFromConstraints(c);
    this.arrival = { ...this.arrival, at: inputs.arrivalAt };
    this.departure = { ...this.departure, at: inputs.departureAt };
    this.airportReady = { at: inputs.airportReadyAt, touched: true };
    this.airportDeadline = { at: inputs.airportArrivalDeadline, touched: true };
    // 선택 context 복원 — 이게 빠지면 재계산 요청의 배우·작품이 비어 invalid 가 된다
    this.selectedActors = record.context.actors;
    this.selectedWorks = record.context.works;

    // 저장 레코드의 일정은 후보 재조회와 무관하게 먼저 연다
    this.candidates = null;
    this.selected = new Set();
    this.view = reduceItineraryView(this.view, { type: "REOPEN", record });

    const data = await getCandidatePlaces({
      selectedActorIds: c.selectedActorIds,
      selectedWorkIds: c.selectedWorkIds,
    });
    this.candidates = data.candidates;
    const excluded = new Set(c.excludedPlaceIds);
    this.selected = new Set(
      initialCandidateIds(data.candidates).filter((id) => !excluded.has(id)),
    );
  }

  /** 사용자가 항공 도착 칸을 고친다 — 공항 출발 가능 시각도 함께 민다 */
  changeArrivalBy(hours: number) {
    const now = constraintsFromTripInputs(
      {
        arrivalAt: this.arrival.at,
        departureAt: this.departure.at,
        airportReadyAt: this.airportReady.at,
        airportArrivalDeadline: this.airportDeadline.at,
      },
      [], [], [],
    );
    this.arrival = { at: toKstLocalInput(shift(now.arrivalAt, hours)), touched: true };
    this.airportReady = {
      at: toKstLocalInput(shift(now.airportReadyAt, hours)),
      touched: true,
    };
  }

  get autoPlan() {
    return autoPlanDecision({
      onPlacesStep: true,
      hasCandidates: this.candidates !== null,
      reopened: this.view.reopened !== null,
      selectedCount: this.selected.size,
    });
  }

  get shown() { return shapeOf(displayedDays(this.view)); }
}

function savedRecordFrom(
  constraints: PlanRequest,
  days: SavedItineraryStub["days"],
  context: SavedItineraryStub["context"],
): SavedItineraryStub {
  return {
    id: "saved-1",
    title: "강릉 2박 3일 · 김고은",
    savedAt: "2026-08-12T11:00:00+09:00",
    days,
    constraints,
    schemaVersion: SAVED_SCHEMA_VERSION,
    snapshotVersion: "unversioned",
    context,
  };
}

/**
 * 저장본 하나와, **다른 콘텐츠·다른 일정**을 띄워 둔 화면을 만든다.
 *
 * 저장본과 화면이 같으면 재열람이 무엇을 복원하든 값이 우연히 맞아 통과한다.
 */
async function screenWithSavedRecord() {
  const screen = new Screen();
  await screen.startFrom(FIRST_TRIP, await pickedContext(SAVED_ACTOR.query, SAVED_ACTOR.id));
  await screen.plan();
  if (screen.view.result?.status !== "planned") throw new Error("첫 계획 실패");
  const saved = savedRecordFrom(screen.lastSentRequest!, screen.view.result.days, {
    actors: screen.selectedActors,
    works: screen.selectedWorks,
  });

  // 저장 뒤 다른 배우·다른 시각으로 계산해 둔다
  await screen.chooseContent(await pickedContext(OTHER_ACTOR.query, OTHER_ACTOR.id));
  screen.changeArrivalBy(DELAY_HOURS);
  await screen.plan();
  if (screen.view.result?.status !== "planned") throw new Error("변경 계산 실패");
  if (screen.shown.join("|") === shapeOf(saved.days).join("|")) {
    throw new Error("변경이 일정을 바꾸지 못했다 — 이 시나리오로는 아무것도 증명할 수 없다");
  }
  return { screen, saved };
}

describe("#6 다시 연 일정에서 항공편 변경과 재계산", () => {
  it("재열람 중에는 자동 재계산이 저장 일정을 덮지 않는다", async () => {
    const { screen, saved } = await screenWithSavedRecord();
    expect(screen.autoPlan).toBe("schedule");

    await screen.reopen(saved);
    expect(screen.autoPlan).toBe("skip");
  });

  it("다시 열면 항공 입력과 선택 콘텐츠가 저장 당시로 돌아온다", async () => {
    const { screen, saved } = await screenWithSavedRecord();
    // 지금 화면은 저장 당시와 시각도 배우도 다르다
    expect(at(screen.currentConstraints()?.arrivalAt)).not.toBe(at(saved.constraints.arrivalAt));
    expect(screen.currentConstraints()?.selectedActorIds).toEqual([OTHER_ACTOR.id]);

    await screen.reopen(saved);

    // 입력이 안 돌아오면 이후 재계산이 엉뚱한 조건을 보낸다
    const restored = screen.currentConstraints();
    expect(at(restored?.arrivalAt)).toBe(at(saved.constraints.arrivalAt));
    expect(at(restored?.airportReadyAt)).toBe(at(saved.constraints.airportReadyAt));
    // 선택 콘텐츠도 저장본 것이어야 한다 — 안 되살리면 요청의 배우가 어긋난다
    expect(restored?.selectedActorIds).toEqual([SAVED_ACTOR.id]);
    expect(screen.shown).toEqual(shapeOf(saved.days));
  });

  it("다시 연 뒤 항공편을 늦추면 바뀐 시각으로 요청이 나가고 재열람이 풀린다", async () => {
    const { screen, saved } = await screenWithSavedRecord();
    await screen.reopen(saved);

    screen.changeArrivalBy(DELAY_HOURS);
    await screen.plan();

    // **핵심** — 옛 저장 조건이 아니라 바꾼 입력이 요청에 실려야 한다
    expect(at(screen.lastSentRequest?.arrivalAt))
      .toBe(at(shift(saved.constraints.arrivalAt, DELAY_HOURS)));
    expect(at(screen.lastSentRequest?.arrivalAt)).not.toBe(at(saved.constraints.arrivalAt));
    // 배우는 저장본 것이 실려야 한다 — 복원이 빠지면 화면에 남아 있던 배우가 나간다
    expect(screen.lastSentRequest?.selectedActorIds).toEqual([SAVED_ACTOR.id]);

    // 재열람이 풀려야 새 일정이 보인다 — 안 풀리면 저장 당시 일정이 계속 보인다
    expect(screen.view.reopened).toBeNull();
    expect(screen.view.result?.status).toBe("planned");
    expect(screen.shown).not.toEqual(shapeOf(saved.days));
  });

  it("저장 레코드는 재계산에 영향을 받지 않는다", async () => {
    const { screen, saved } = await screenWithSavedRecord();
    const before = JSON.stringify(saved);

    await screen.reopen(saved);
    screen.changeArrivalBy(DELAY_HOURS);
    await screen.plan();

    expect(screen.view.reopened).toBeNull();
    // 저장본은 화면 상태와 별개다 — 재계산이 레코드를 건드리면 목록의 일정이 바뀐다
    expect(JSON.stringify(saved)).toBe(before);
  });

  /**
   * 재계산이 실패하면 **다시 연 일정이 그대로 남아야 한다.** 여기서 화면을 비우면
   * 사용자는 저장해 둔 일정까지 잃은 것처럼 본다.
   */
  it("재계산이 실패해도 다시 연 일정은 그대로 남는다", async () => {
    const { screen, saved } = await screenWithSavedRecord();
    await screen.reopen(saved);

    screen.view = reduceItineraryView(screen.view, { type: "PLAN_START" });
    screen.view = reduceItineraryView(screen.view, { type: "PLAN_FAILED" });

    expect(screen.view.reopened).not.toBeNull();
    expect(screen.view.planError).toBe("unexpected");
    expect(screen.shown).toEqual(shapeOf(saved.days));
  });

  /**
   * 조건이 아예 성립하지 않는 변경도 저장 일정을 지우지 않는다.
   *
   * `PLAN_INVALID`는 **직전 결과를 유지하는 것이 계약**이다(`1단계 검증을 우회한 요청`).
   * 그래서 `result.status`가 아니라 사유 표시와 재열람 유지로 판정한다.
   */
  it("불가능한 변경은 다시 연 일정을 유지한다", async () => {
    const { screen, saved } = await screenWithSavedRecord();
    await screen.reopen(saved);

    // 도착을 출국 뒤로 민다 — 성립할 수 없는 조건
    const beyondDeparture =
      (Date.parse(saved.constraints.departureAt) - Date.parse(saved.constraints.arrivalAt))
      / 3_600_000 + 1;
    screen.changeArrivalBy(beyondDeparture);
    await screen.plan();

    expect(screen.view.planError).toBe("invalid");
    expect(screen.view.reopened).not.toBeNull();
    expect(screen.shown).toEqual(shapeOf(saved.days));
  });
});

/**
 * 하네스의 한계를 스스로 지킨다 (PR #193과 같은 장치).
 *
 * `Screen`은 화면 로직을 옮겨 적은 것이라, 화면이 다른 함수로 갈아타면 여기만 초록일 수
 * 있다. 완전한 방어가 아니라 갈아타는 순간 눈에 띄게 하는 장치다.
 */
describe("하네스가 화면과 같은 진입점을 본다", () => {
  const wizard = readFileSync(new URL("../../app/planner-wizard.tsx", import.meta.url), "utf-8");

  it.each([
    "tripInputsFromConstraints",
    "constraintsFromTripInputs",
    "initialCandidateIds",
    "excludedPlaceIdsFrom",
    "autoPlanDecision",
    "setSelectedActors",
    "setSelectedWorks",
  ])("화면이 %s 를 쓴다", (name) => {
    expect(wizard, `화면이 ${name} 를 더는 쓰지 않으면 이 E2E 는 화면을 대변하지 못한다`)
      .toContain(name);
  });

  /** 재계산이 라이브 입력으로 요청을 만드는지 — 저장 조건을 되쓰면 이 경로가 무의미해진다 */
  it("재계산은 currentConstraints() 로 요청을 만든다", () => {
    expect(wizard).toMatch(
      /const plan = useCallback\(async \(\) => \{\s*const constraints = currentConstraints\(\);/,
    );
  });

  /** 재열람이 항공 입력 네 칸을 되돌리는지 */
  it.each([
    "setArrival",
    "setDeparture",
    "setAirportReady",
    "setAirportDeadline",
    "setSelectedActors",
    "setSelectedWorks",
  ])(
    "재열람이 %s 로 상태를 복원한다",
    (setter) => {
      const reopen = wizard.slice(wizard.indexOf("const c = record.constraints;"));
      expect(reopen.slice(0, 900)).toContain(setter);
    },
  );
});
