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
 * 장소마다 줄이 하나씩 나가는 사유 — 화면이 `displaced`·`moved` 목록으로 그린다.
 *
 * **이 타입과 아래 `IMPACT_REASON_MESSAGE`가 `ProposalReason`을 남김없이 가른다.**
 * 새 사유를 추가하면 둘 중 하나에 분류하기 전까지 컴파일이 실패한다 (PR #148 리뷰 3번).
 */
type ListRenderedReason = "date_adjusted" | "order_adjusted" | "places_displaced" | "places_moved";

/** 장소 목록이 아니라 일정 전체에 대한 한 줄로 설명되는 사유 */
export type ImpactReason = Exclude<ProposalReason, ListRenderedReason>;

/**
 * 사유별 문구 키.
 *
 * `satisfies Record<ImpactReason, MessageKey>`라 **`ImpactReason`에 값이 하나라도
 * 늘면 여기서 컴파일이 깨진다.** 앞선 판(런타임 `Set`으로 좁히는 타입 가드)은
 * 새 사유를 추가해도 컴파일러가 가드를 믿어 `undefined` 문구 키가 그대로 나갔다.
 */
export const IMPACT_REASON_MESSAGE = {
  travel_time_increased: "ai.confirmTravelTime",
  transfers_increased: "ai.confirmTransfers",
  departure_slack_reduced: "ai.confirmSlack",
} satisfies Record<ImpactReason, MessageKey>;

/** 목록 렌더링 쪽도 같은 방식으로 잠근다 — 여기 빠지면 자동으로 `ImpactReason`이 된다 */
const LIST_RENDERED = {
  date_adjusted: true,
  // 순서 조정도 확인 창에서 한 줄로 적는다 — 숫자 델타가 아니라 사실 서술이다 (#145)
  order_adjusted: true,
  places_displaced: true,
  places_moved: true,
} satisfies Record<ListRenderedReason, true>;

export function isImpactReason(reason: ProposalReason): reason is ImpactReason {
  return !(reason in LIST_RENDERED);
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
