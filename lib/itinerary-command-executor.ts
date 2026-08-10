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
  decision: "ready" | "needs_confirmation" | "impossible";
  placeId: string;
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
};

/**
 * 이동시간 증가를 `크게`로 볼 기준 — **절대와 비율을 함께** 넘겨야 한다.
 *
 * 절대만 쓰면 원래 10시간짜리 일정에서 30분 증가에도 확인을 받아 성가시고,
 * 비율만 쓰면 짧은 일정의 20%(예: 12분)에도 확인을 받는다.
 */
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
  return {
    ...current,
    excludedPlaceIds: current.excludedPlaceIds.filter((id) => id !== command.placeId),
    preferredVisitDates: {
      ...(current.preferredVisitDates ?? {}),
      [command.placeId]: command.targetDate,
    },
  };
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
  const base = { placeId: command.placeId, requestedDate: command.targetDate };

  const impossible = (): CommandProposal => ({
    ...base,
    decision: "impossible",
    reasons: [],
    displaced: [],
    moved: [],
    rejection: rejectionOf(after, command.placeId),
  });

  // 일정 자체가 서지 않았다 — 요청한 장소 탓이라고 단정하지 않고 사유만 옮긴다
  if (after.status !== "planned") return impossible();

  const outcome = after.preferredDateOutcomes
    ?.find((entry) => entry.placeId === command.placeId)?.outcome;
  if (outcome === undefined || outcome === "unplaced") return impossible();

  // 명령한 장소 자신은 요청 밖 변화가 아니다 — 이동은 의도한 것이고, 빠짐은 위에서 갈렸다
  const diff = diffItineraries(before, after).places;
  const displaced = diff.dropped.filter((entry) => entry.placeId !== command.placeId);
  const moved = diff.moved.filter((entry) => entry.placeId !== command.placeId);

  const impact = impactOf(before, after);

  const reasons: ProposalReason[] = [];
  if (outcome === "adjusted") reasons.push("date_adjusted");
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
    scheduledDate: dateOf(after, command.placeId),
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
