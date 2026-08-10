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
 * | outcome (#139 8절) | 빠지는 장소 | decision |
 * |---|---|---|
 * | `honored` | 없음 | `ready` |
 * | `honored` | 있음 | `needs_confirmation` (`places_displaced`) |
 * | `adjusted` | 무관 | `needs_confirmation` (`date_adjusted`) |
 * | `unplaced` | 무관 | `impossible` |
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

export type ProposalReason = "date_adjusted" | "places_displaced";

export type CommandProposal = {
  decision: "ready" | "needs_confirmation" | "impossible";
  placeId: string;
  requestedDate: string;
  /** 실제 배치된 날짜. `impossible`이면 없다 */
  scheduledDate?: string;
  /** 왜 확인이 필요한가. `ready`면 빈 배열 */
  reasons: ProposalReason[];
  displaced: DisplacedPlace[];
  /** `impossible`일 때 엔진이 준 사유 (`rejectedPlaces`에서 그대로) */
  rejection?: CandidateRejection["code"];
};

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

  if (after.status !== "planned") {
    // 일정 자체가 서지 않았다 — 요청한 장소 탓이라고 단정하지 않고 사유만 옮긴다
    return {
      ...base,
      decision: "impossible",
      reasons: [],
      displaced: [],
      rejection: rejectionOf(after, command.placeId),
    };
  }

  const outcome = after.preferredDateOutcomes
    ?.find((entry) => entry.placeId === command.placeId)?.outcome;

  if (outcome === undefined || outcome === "unplaced") {
    return {
      ...base,
      decision: "impossible",
      reasons: [],
      displaced: [],
      rejection: rejectionOf(after, command.placeId),
    };
  }

  // 명령한 장소 자신은 "빠지는 장소"가 아니다 — 그건 위에서 이미 unplaced로 갈렸다
  const displaced = diffItineraries(before, after).places.dropped
    .filter((entry) => entry.placeId !== command.placeId);

  const scheduledDate = dateOf(after, command.placeId);
  const reasons: ProposalReason[] = [];
  if (outcome === "adjusted") reasons.push("date_adjusted");
  if (displaced.length > 0) reasons.push("places_displaced");

  return {
    ...base,
    decision: reasons.length > 0 ? "needs_confirmation" : "ready",
    scheduledDate,
    reasons,
    displaced,
  };
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
