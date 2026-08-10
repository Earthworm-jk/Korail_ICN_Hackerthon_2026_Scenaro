/**
 * 제안 사유 → 확인 창 문구 매핑 (PR #148 리뷰 1번)
 *
 * 사유를 늘렸는데 화면이 그리지 않으면 **`확인해 주세요` 아래가 비어** 사용자가 무엇을
 * 승인하는지 알 수 없게 된다. 타입 확장과 소비자 변경이 따로 배포되면 나는 사고라,
 * 매핑을 한곳에 두고 **모든 사유가 문구를 갖는지 테스트로 잠근다.**
 *
 * 이 모듈은 문구를 만들지 않는다 — 키만 고르고 ko/en 본문은 `messages.ts`가 갖는다.
 */
import type { MessageKey } from "./i18n/messages";
import type { CommandProposal, ProposalReason } from "./itinerary-command-executor";

/**
 * 사유별 문구 키. `displaced`·`moved`는 장소마다 줄이 하나씩 나가므로 목록으로 따로 그린다.
 * 여기 있는 셋은 일정 전체에 대한 한 줄이다.
 */
export const IMPACT_REASON_MESSAGE: Record<ImpactReason, MessageKey> = {
  travel_time_increased: "ai.confirmTravelTime",
  transfers_increased: "ai.confirmTransfers",
  departure_slack_reduced: "ai.confirmSlack",
};

/** 장소 목록이 아니라 한 줄로 설명되는 사유 */
export type ImpactReason =
  | "travel_time_increased"
  | "transfers_increased"
  | "departure_slack_reduced";

/** 사유 전체 중 이 모듈이 문구를 대는 것 — 나머지는 화면이 장소 목록으로 그린다 */
const LIST_RENDERED: ReadonlySet<ProposalReason> = new Set<ProposalReason>([
  "date_adjusted",
  "places_displaced",
  "places_moved",
]);

export function isImpactReason(reason: ProposalReason): reason is ImpactReason {
  return !LIST_RENDERED.has(reason);
}

export type ImpactLine = {
  reason: ImpactReason;
  messageKey: MessageKey;
  /** 문구의 `{minutes}`·`{count}`에 넣을 값. 방향을 사람이 읽는 대로 양수로 준다 */
  value: number;
};

/**
 * 확인 창에 그릴 한 줄들. 사유 순서를 여기서 고정해 화면마다 달라지지 않게 한다.
 *
 * `impact`가 없으면(첫 생성) 빈 배열이다 — 없는 변화량을 지어내지 않는다.
 */
export function impactLinesOf(proposal: CommandProposal): ImpactLine[] {
  const { impact } = proposal;
  if (!impact) return [];
  const valueOf: Record<ImpactReason, number> = {
    travel_time_increased: impact.travelMinutesDelta,
    transfers_increased: impact.transferCountDelta,
    // 줄어든 양을 양수로 — 화면은 `약 40분 줄어듭니다`로 읽는다
    departure_slack_reduced: -impact.departureSlackMinutesDelta,
  };
  return proposal.reasons
    .filter(isImpactReason)
    .map((reason) => ({ reason, messageKey: IMPACT_REASON_MESSAGE[reason], value: valueOf[reason] }));
}
