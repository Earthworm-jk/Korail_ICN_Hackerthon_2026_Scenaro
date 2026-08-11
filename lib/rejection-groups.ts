/**
 * 미배치 사유 묶기 (#84 §2 · #171)
 *
 * 사유는 3-4종인데 장소 수만큼 줄이 나온다. 같은 문장이 11번 반복되면 읽히지 않고, 카탈로그가
 * 30-50곳으로 늘면(#72) 더 나빠진다. 사용자가 읽어야 하는 것은 **몇 가지 이유로 몇 곳이
 * 빠졌는가**이지 같은 문장의 반복이 아니다.
 *
 * ## 순서는 "지금 무엇을 할 수 있는가"로 정한다
 *
 * 개수 많은 순으로 두면 사용자가 손댈 수 있는 항목이 아래로 밀릴 수 있다. 고칠 수 있는 것부터
 * 보여준다 — 선택을 줄이면 되는 것이 먼저, 이 여행에서는 갈 수 없는 것이 마지막이다.
 */
import type { CandidateRejection } from "./engine/types";

/** 화면에 나오는 순서. 앞일수록 사용자가 바로 할 수 있는 일이 있다 */
const DISPLAY_ORDER: CandidateRejection["code"][] = [
  "NOT_IN_BEST_SUBSET", // 선택을 줄이면 들어온다
  "DAILY_CAPACITY_EXCEEDED", // 날짜를 늘리거나 선택을 줄이면 된다
  "DEPARTURE_DEADLINE_EXCEEDED", // 항공·기간 조건을 바꿔야 한다
  "TRAIN_UNAVAILABLE", // 이 여행 조건에서는 갈 방법이 없다
];

export type RejectionGroup = {
  code: CandidateRejection["code"];
  placeIds: string[];
};

/**
 * 사유별로 묶는다. 같은 장소가 여러 사유로 들어와도 **한 번만** 센다 — 목록이 곧 개수이므로
 * 중복이 있으면 "11곳"이라고 적고 12줄을 그리게 된다.
 */
export function groupRejections(rejections: readonly CandidateRejection[]): RejectionGroup[] {
  const byCode = new Map<CandidateRejection["code"], string[]>();
  const seen = new Set<string>();

  for (const code of DISPLAY_ORDER) {
    for (const rejection of rejections) {
      if (rejection.code !== code) continue;
      if (seen.has(rejection.placeId)) continue;
      seen.add(rejection.placeId);
      const ids = byCode.get(code);
      if (ids) ids.push(rejection.placeId);
      else byCode.set(code, [rejection.placeId]);
    }
  }

  return DISPLAY_ORDER.flatMap((code) => {
    const placeIds = byCode.get(code);
    return placeIds ? [{ code, placeIds }] : [];
  });
}
