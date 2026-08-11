/**
 * 명령 실행기 (#141 P0-1, 구현 순서 2·5번)
 *
 * 자연어·버튼·드래그가 공유하는 단 하나의 실행 경로다. 명령을 `PlanRequest` 패치로 옮기고,
 * **검증된 엔진이 전체 재계산한 결과를 판정**한다. 이 모듈은 일정을 만들지 않는다.
 *
 * ## 적용하지 않고 제안만 한다
 *
 * #141 결정: 일정이 생성됐다는 이유로 사용자가 요청하지 않은 날짜 변경이나 장소 제외를
 * 조용히 확정하지 않는다. 그래서 실행기는 `decision` 셋만 돌려주고,
 * **무엇을 화면에 띄우고 언제 확정할지는 레인 A가 정한다.**
 *
 * | outcome (#139 8절) | 요청 밖 변화 | decision |
 * |---|---|---|
 * | `honored` | 없음 | `ready` |
 * | `honored` | 다른 장소가 빠짐 | `needs_confirmation` (`places_displaced`) |
 * | `honored` | 다른 장소의 날짜가 바뀜 | `needs_confirmation` (`places_moved`) |
 * | `honored` | 이동시간·환승·출국 여유가 나빠짐 | `needs_confirmation` (아래 3종) |
 * | `adjusted` | 무관 | `needs_confirmation` (`date_adjusted`) |
 * | `unplaced` | 무관 | `impossible` |
 *
 * **제외뿐 아니라 날짜 변경도 확인 대상이다** (PR #142 리뷰 1번). 전체 재계산이라
 * 요청하지 않은 장소가 다른 날로 밀릴 수 있고, #141 결정문은 "요청하지 않은 장소 제외나
 * 날짜 변경을 조용히 확정하면 안 된다"이다. 빠진 것만 보면 그 절반을 놓친다.
 *
 * 문구는 만들지 않는다 — 코드만 돌려주고 ko/en은 `messages.ts`(레인 A)가 붙인다.
 */
import type { PlanRequest } from "./actions/itinerary";
import { diffItineraries } from "./itinerary-diff";
import type { CandidateRejection, ItineraryResult } from "./engine/types";
import type { ItineraryCommand, VisitDateCommand } from "./itinerary-command";

/** 이 변경으로 일정에서 빠지는 장소 — 자동 제외하지 않고 사용자에게 보여 줄 재료다 */
export type DisplacedPlace = {
  placeId: string;
  reason?: CandidateRejection["code"];
};

/** 이 변경으로 방문일이 바뀌는 **다른** 장소 — 요청하지 않은 이동이다 */
export type MovedPlace = {
  placeId: string;
  fromDate: string;
  toDate: string;
};

export type ProposalReason =
  | "date_adjusted"
  /** 순서 선호를 못 지켰다 (#145). 날짜의 `date_adjusted`와 같은 성격이다 */
  | "order_adjusted"
  | "places_displaced"
  | "places_moved"
  | "travel_time_increased"
  | "transfers_increased"
  | "departure_slack_reduced";

/**
 * 요청 밖에서 나빠진 정도. `before`가 `empty`(첫 생성)면 비교 대상이 없어 싣지 않는다.
 *
 * 화면이 `이동시간이 40분 늘어납니다`처럼 실제 숫자로 말할 수 있게 델타를 그대로 준다 —
 * 엔진·diff에 있는 값만 쓰고 우리가 만들어 내지 않는다.
 */
export type ProposalImpact = {
  /** 양수면 증가 */
  travelMinutesDelta: number;
  transferCountDelta: number;
  /** 음수면 출국 전 여유가 줄었다 */
  departureSlackMinutesDelta: number;
};

export type CommandProposal = {
  /**
   * 무엇을 요청한 제안인가 (#145).
   *
   * **타입을 나누지 않고 갈래만 둔다.** 판정(`decision`)·확인 창·실행 취소·diff는
   * 날짜와 순서가 같은 경로를 써야 한다 — `planner-wizard`의 네 곳과
   * `itinerary-command.ts`의 displaced 재계산이 전부 `decision` 하나를 보고 도는데,
   * 타입을 갈라 두면 그 다섯 자리에 두 번째 분기가 생기고 시간이 지나면 규칙이 갈린다.
   *
   * 갈리는 것은 **문구뿐이다.** 순서 제안에는 날짜가 없으므로 날짜 문구를 만드는
   * 자리에서 이 값을 먼저 봐야 한다.
   */
  kind: "date" | "order";
  decision: "ready" | "needs_confirmation" | "impossible";
  /** 대표 대상. 날짜 통 이동이면 `placeIds`의 첫 항목이다 */
  placeId: string;
  /**
   * 이 제안이 옮기려는 장소 전부 (#146 10 — 날짜 통 드래그).
   *
   * 한 곳짜리 명령에서는 `[placeId]`와 같다. 화면은 길이가 2 이상일 때만 다르게 말하면 된다 —
   * 판정·부작용 계산은 **같은 경로**를 쓴다. 갈라 두면 통 이동에서만 확인 기준이 달라진다.
   */
  placeIds: string[];
  requestedDate: string;
  /** 실제 배치된 날짜. `impossible`이면 없다 */
  scheduledDate?: string;
  /** 왜 확인이 필요한가. `ready`면 빈 배열 */
  reasons: ProposalReason[];
  displaced: DisplacedPlace[];
  /** 명령 대상을 제외한, 날짜가 바뀌는 장소들 */
  moved: MovedPlace[];
  impact?: ProposalImpact;
  /** `impossible`일 때 엔진이 준 사유 (`rejectedPlaces`에서 그대로) */
  rejection?: CandidateRejection["code"];
  /** `kind: "order"`에서만 — 요청한 `[먼저, 나중]` 쌍 */
  orderPair?: readonly [string, string];
  /** `kind: "order"`에서만 — 엔진이 그 쌍을 어떻게 처리했는지 */
  orderOutcome?: "honored" | "adjusted" | "unplaced";
};

/**
 * 이동시간 증가를 `크게`로 볼 기준 — 경로가 둘이다.
 *
 * **중간 증가**는 절대와 비율을 함께 넘어야 한다. 절대만 쓰면 원래 10시간짜리 일정에서
 * 30분 증가에도 확인을 받아 성가시고, 비율만 쓰면 짧은 일정의 20%(예: 12분)에도 받는다.
 *
 * **다만 그 AND만 두면 기준 일정이 길수록 허용되는 절대 증가량에 상한이 없어진다** —
 * 600분 일정에서 119분이 늘어도 20% 미만이라 그냥 통과한다(PR #148 리뷰 2번).
 * 그래서 비율과 무관하게 걸리는 절대 상한 경로를 함께 둔다.
 */
const LARGE_TRAVEL_INCREASE_MINUTES = 60;
const TRAVEL_INCREASE_MINUTES = 30;
const TRAVEL_INCREASE_RATIO = 0.2;
/** 출국 전 여유가 이만큼 줄면 알린다 — 공항 마감은 되돌리기 어려운 축이다 */
const SLACK_DROP_MINUTES = 30;

/**
 * 명령을 요청 패치로 옮긴다. **엔진 입력은 `preferredVisitDates` 하나다** —
 * 이동이든 추가든 사용자가 원하는 최종 상태(그 날짜에 있다)가 같기 때문이다.
 *
 * 추가는 제외 목록에서 빼 준다. 사용자가 선택 해제해 둔 장소를 "넣어줘"라고 부르면
 * 제외가 선호보다 우선이라(#139 7절) 선호만 넣어서는 아무 일도 일어나지 않는다.
 */
export function planRequestFor(command: VisitDateCommand, current: PlanRequest): PlanRequest {
  return planRequestForPlaces([command.placeId], command.targetDate, current);
}

/** 여러 장소를 같은 날짜로 (#146 10). 한 곳짜리와 같은 규칙을 그대로 넓힌다 */
export function planRequestForPlaces(
  placeIds: string[],
  targetDate: string,
  current: PlanRequest,
): PlanRequest {
  const targets = new Set(placeIds);
  return {
    ...current,
    excludedPlaceIds: current.excludedPlaceIds.filter((id) => !targets.has(id)),
    preferredVisitDates: {
      ...(current.preferredVisitDates ?? {}),
      ...Object.fromEntries(placeIds.map((placeId) => [placeId, targetDate])),
    },
  };
}

/**
 * 순서 선호 쌍을 요청에 얹는다 (#145).
 *
 * **쌓지 않고 정리한다.** 드래그는 여러 번 일어나고, 그때마다 쌍을 더하기만 하면
 * `A→B`와 `B→A`가 함께 남는다. 엔진 스키마는 그런 순환을 `INVALID_REQUEST`로 거부하므로
 * 재계산 자체가 실패한다 - 사용자는 방금 끈 것과 무관한 오류를 보게 된다.
 *
 * 그래서 새 쌍과 **같은 두 장소를 다루는 기존 쌍은 방향과 무관하게 걷어내고** 새 쌍을 넣는다.
 * 마지막 드래그가 그 두 장소에 대한 사용자의 뜻이다.
 *
 * 길이 3 이상의 순환(`A→B, B→C, C→A`)까지는 여기서 막지 않는다. 엔진이 결정적인 순환 경로와
 * 함께 거부하므로(PR #153 리뷰 3) 그 오류를 화면이 받아 처리하는 쪽이 맞다 - 여기서
 * 조용히 버리면 사용자가 요청한 쌍 중 어느 것이 사라졌는지 알 수 없다.
 */
export function planRequestForOrder(
  firstPlaceId: string,
  secondPlaceId: string,
  current: PlanRequest,
): PlanRequest {
  const pair = new Set([firstPlaceId, secondPlaceId]);
  const kept = (current.preferredOrder ?? []).filter(
    ([first, second]) => !(pair.has(first) && pair.has(second)),
  );
  return {
    ...current,
    // 순서를 요청한 장소가 제외돼 있으면 선호가 통째로 버려진다 (엔진 계약: 제외 우선).
    // 날짜 선호와 같은 규칙으로 제외에서 빼 준다
    excludedPlaceIds: current.excludedPlaceIds.filter((id) => !pair.has(id)),
    preferredOrder: [...kept, [firstPlaceId, secondPlaceId] as const],
  };
}

/**
 * 순서 제안 판정 (#145).
 *
 * 날짜 제안과 **같은 부작용 계산을 쓴다.** 다른 것은 요청 자체를 지켰는지 보는 축뿐이라,
 * 그 축만 엔진의 `preferredOrderOutcomes`에서 읽고 나머지(밀려난 장소·이동시간·환승·여유)는
 * 날짜 쪽 함수를 그대로 통과시킨다.
 */
export function proposalForOrder(
  firstPlaceId: string,
  secondPlaceId: string,
  before: ItineraryResult,
  after: ItineraryResult,
): CommandProposal {
  const base = {
    kind: "order" as const,
    placeId: firstPlaceId,
    placeIds: [firstPlaceId],
    requestedDate: "",
    orderPair: [firstPlaceId, secondPlaceId] as const,
  };

  /*
   * **부작용을 날짜 경로에서 빌려 오지 않는다** (PR #170 리뷰).
   *
   * `proposalForPlaces`는 `preferredDateOutcomes`로 배치 여부를 가른다. 순서 요청은
   * `preferredVisitDates`를 넣지 않으므로 그 배열이 비고, 함수가 곧장 `impossible()`로
   * 빠져 **`displaced`·`moved`·`impact`가 전부 빈 값으로 돌아온다.** 그 위에서 판정만
   * 다시 계산하면 사유가 없어 `ready`가 되고, 선택한 장소가 빠져도 확인 없이 적용된다.
   *
   * 그래서 순서 축으로 직접 센다. 판정 규칙은 날짜 쪽과 같다 - 요청 밖에서 나빠진 것이
   * 하나라도 있으면 확인을 받는다.
   */
  if (after.status !== "planned") {
    return { ...base, decision: "impossible", reasons: [], displaced: [], moved: [],
      rejection: rejectionOf(after, firstPlaceId) };
  }

  const scheduledDate = dateOfPlaceIn(after, firstPlaceId);
  if (scheduledDate === undefined) {
    return { ...base, decision: "impossible", reasons: [], displaced: [], moved: [],
      rejection: rejectionOf(after, firstPlaceId) };
  }

  /*
   * **빠진 장소는 요청 대상이라도 손실이다** (PR #170 리뷰 2).
   *
   * 앞서 두 대상을 `dropped`에서 통째로 뺐다 - "요청한 장소의 이동은 의도한 것"이라는
   * 이유였는데, 이동과 소멸은 다르다. `firstPlaceId`가 빠진 경우는 위에서 `impossible`로
   * 잡지만 `secondPlaceId`가 빠지면 어디에도 안 걸려 사유가 없어지고, **사용자가 고른
   * 카드가 사라졌는데 확인 없이 적용됐다.**
   *
   * 날짜가 바뀐 것(`moved`)도 빼지 않는다. 순서는 같은 날 안의 요청이라 대상이 다른 날로
   * 넘어갔다면 요청한 적 없는 변화다. 같은 날 안에서 자리만 바뀌면 날짜가 그대로라
   * `moved`에 잡히지 않으므로, 정상적인 순서 변경이 이 때문에 확인을 받지는 않는다.
   */
  const diff = diffItineraries(before, after).places;
  const displaced = diff.dropped;
  const moved = diff.moved;
  const impact = impactOf(before, after);

  const outcome = (after.preferredOrderOutcomes ?? []).find(
    (row) => row.firstPlaceId === firstPlaceId && row.secondPlaceId === secondPlaceId,
  )?.outcome;

  const reasons: ProposalReason[] = [];
  // 순서를 못 지킨 것은 실패가 아니라 조정이다 — 소프트 선호라 일정은 그대로 나온다
  if (outcome === "adjusted") reasons.push("order_adjusted");
  if (displaced.length > 0) reasons.push("places_displaced");
  if (moved.length > 0) reasons.push("places_moved");
  if (impact) {
    if (isLargeTravelIncrease(impact.travelMinutesDelta, before)) {
      reasons.push("travel_time_increased");
    }
    if (impact.transferCountDelta > 0) reasons.push("transfers_increased");
    if (impact.departureSlackMinutesDelta <= -SLACK_DROP_MINUTES) {
      reasons.push("departure_slack_reduced");
    }
  }

  return {
    ...base,
    decision: reasons.length > 0 ? "needs_confirmation" : "ready",
    scheduledDate,
    reasons,
    displaced,
    moved,
    ...(impact ? { impact } : {}),
    ...(outcome ? { orderOutcome: outcome } : {}),
  };
}

/** 그 장소가 앉은 날짜 — 없으면 `undefined` */
function dateOfPlaceIn(result: ItineraryResult, placeId: string): string | undefined {
  if (result.status !== "planned") return undefined;
  return result.days.find((day) => day.items.some((item) => item.placeId === placeId))?.date;
}

/**
 * 선호 하나를 걷어낸다.
 *
 * **원래 요청으로 되돌리는 함수가 아니다.** `planRequestFor`가 제외 목록에서도 뺐다면
 * 그것까지 복원하지는 못한다 — 패치된 요청에는 "원래 제외돼 있었는지"가 남아 있지 않다.
 * 되돌리기가 필요한 호출부는 **명령 이전 요청을 그대로 들고 있다가 다시 쓰는 것**이 맞고,
 * 이 함수는 선호만 정리하면 되는 경우에 쓴다.
 */
export function withoutPreference(command: VisitDateCommand, patched: PlanRequest): PlanRequest {
  const preferred = { ...(patched.preferredVisitDates ?? {}) };
  delete preferred[command.placeId];
  const next: PlanRequest = { ...patched, preferredVisitDates: preferred };
  if (Object.keys(preferred).length === 0) delete next.preferredVisitDates;
  return next;
}

/**
 * 재계산 결과를 판정한다.
 *
 * `before`는 지금 화면에 있는 일정, `after`는 패치한 요청의 결과다. 둘을 비교해야
 * "이 변경으로 무엇이 빠지는가"를 말할 수 있다 — 결과 하나만 보면 알 수 없다.
 */
export function proposalFor(
  command: VisitDateCommand,
  before: ItineraryResult,
  after: ItineraryResult,
): CommandProposal {
  return proposalForPlaces([command.placeId], command.targetDate, before, after);
}

/**
 * 여러 장소를 같은 날짜로 (#146 10 — 날짜 통 드래그)
 *
 * 한 곳짜리와 **같은 판정을 쓴다.** 갈라 두면 통 이동에서만 확인 기준이 달라져, 손으로 하면
 * 통과하는 변경이 드래그로는 막히는 식이 된다.
 *
 * 통 이동에서 달라지는 것은 셋뿐이다 —
 * - `impossible`은 **전부** 못 들어갔을 때다. 셋 중 하나만 빠지면 나머지는 옮겨졌으므로
 *   불가능이 아니라 확인 대상이다.
 * - `date_adjusted`는 **하나라도** 다른 날에 앉았을 때다.
 * - `scheduledDate`는 전부 같은 날에 앉았을 때만 말한다. 흩어졌으면 한 날짜로 요약할 수 없다.
 */
export function proposalForPlaces(
  placeIds: string[],
  targetDate: string,
  before: ItineraryResult,
  after: ItineraryResult,
): CommandProposal {
  const base = { placeId: placeIds[0], placeIds, requestedDate: targetDate };
  const targets = new Set(placeIds);

  const impossible = (): CommandProposal => ({
    kind: "date",
    ...base,
    decision: "impossible",
    reasons: [],
    displaced: [],
    moved: [],
    rejection: rejectionOf(after, placeIds[0]),
  });

  // 일정 자체가 서지 않았다 — 요청한 장소 탓이라고 단정하지 않고 사유만 옮긴다
  if (after.status !== "planned") return impossible();

  const outcomes = placeIds.map((placeId) => after.preferredDateOutcomes
    ?.find((entry) => entry.placeId === placeId)?.outcome);
  const placed = outcomes.filter((outcome) => outcome === "honored" || outcome === "adjusted");
  if (placed.length === 0) return impossible();

  // 명령한 장소 자신은 요청 밖 변화가 아니다 — 이동은 의도한 것이고, 빠짐은 위에서 갈렸다
  const diff = diffItineraries(before, after).places;
  const displaced = diff.dropped.filter((entry) => !targets.has(entry.placeId));
  const moved = diff.moved.filter((entry) => !targets.has(entry.placeId));

  const impact = impactOf(before, after);
  const scheduled = placeIds.map((placeId) => dateOf(after, placeId));
  const sameDate = scheduled.every((date) => date !== undefined && date === scheduled[0]);

  const reasons: ProposalReason[] = [];
  // 하나라도 다른 날에 앉았거나, 일부가 아예 못 들어갔으면 요청대로가 아니다
  if (outcomes.some((outcome) => outcome === "adjusted") || placed.length < placeIds.length) {
    reasons.push("date_adjusted");
  }
  if (displaced.length > 0) reasons.push("places_displaced");
  if (moved.length > 0) reasons.push("places_moved");
  if (impact) {
    if (isLargeTravelIncrease(impact.travelMinutesDelta, before)) {
      reasons.push("travel_time_increased");
    }
    if (impact.transferCountDelta > 0) reasons.push("transfers_increased");
    if (impact.departureSlackMinutesDelta <= -SLACK_DROP_MINUTES) {
      reasons.push("departure_slack_reduced");
    }
  }

  return {
    kind: "date",
    ...base,
    decision: reasons.length > 0 ? "needs_confirmation" : "ready",
    ...(sameDate ? { scheduledDate: scheduled[0] } : {}),
    reasons,
    displaced,
    moved,
    ...(impact ? { impact } : {}),
  };
}

/**
 * 요청 밖 악화를 재는 재료 (#145 보충 코멘트).
 *
 * **`열차가 바뀌었다`를 그대로 신호로 쓰지 않는다.** 장소를 옮기면 그 사이 열차가 바뀌는 것은
 * 당연한 결과라 사용자가 놀랄 일이 아니고, 매번 확인을 받으면 직접 조작의 즉시성이 무너진다.
 * 놀랄 일은 `바뀌었다`가 아니라 **`바뀌어서 나빠졌다`** 이므로 이동시간·환승·출국 여유로 잰다.
 */
function impactOf(before: ItineraryResult, after: ItineraryResult): ProposalImpact | undefined {
  // 첫 생성(before가 empty)은 비교 대상이 없다 — 없는 악화를 지어내지 않는다
  if (before.status !== "planned" || after.status !== "planned") return undefined;
  return {
    travelMinutesDelta: after.metrics.totalTravelMinutes - before.metrics.totalTravelMinutes,
    transferCountDelta: after.metrics.transferCount - before.metrics.transferCount,
    departureSlackMinutesDelta:
      after.metrics.departureSlackMinutes - before.metrics.departureSlackMinutes,
  };
}

function isLargeTravelIncrease(delta: number, before: ItineraryResult): boolean {
  // 절대 상한 — 기준 일정이 아무리 길어도 이만큼 늘면 알린다
  if (delta >= LARGE_TRAVEL_INCREASE_MINUTES) return true;
  if (delta < TRAVEL_INCREASE_MINUTES) return false;
  if (before.status !== "planned") return false;
  const baseline = before.metrics.totalTravelMinutes;
  // 원래 이동이 0에 가까우면 비율이 의미를 잃는다 — 절대 기준만으로 판정한다
  return baseline <= 0 || delta >= baseline * TRAVEL_INCREASE_RATIO;
}

/**
 * "방금 변경해서 무엇이 달라졌어?" — `itinerary-diff`의 실제 값만 옮긴다 (#141 P0-3).
 *
 * API를 부르지 않는다. 내부 점수나 확인되지 않은 인과를 만들지 않고, 화면이 문장으로
 * 옮길 수 있는 최소 재료만 돌려준다.
 */
export function changeSummaryOf(before: ItineraryResult, after: ItineraryResult) {
  const diff = diffItineraries(before, after);
  return {
    changed: diff.changed,
    moved: diff.places.moved,
    added: diff.places.added,
    dropped: diff.places.dropped,
    rideChangeCount: diff.rides.dropped.length + diff.rides.added.length,
  };
}

export function isExplainCommand(
  command: ItineraryCommand,
): command is Extract<ItineraryCommand, { intent: "explain_changes" }> {
  return command.intent === "explain_changes";
}

function rejectionOf(
  result: ItineraryResult,
  placeId: string,
): CandidateRejection["code"] | undefined {
  return result.rejectedPlaces.find((entry) => entry.placeId === placeId)?.code;
}

function dateOf(
  result: Extract<ItineraryResult, { status: "planned" }>,
  placeId: string,
): string | undefined {
  return result.days.find((day) => day.items.some((item) => item.placeId === placeId))?.date;
}
