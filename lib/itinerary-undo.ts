/**
 * 명령 직전 상태의 되돌리기 지점 (#109 · #145)
 *
 * 원래 날짜 버튼을 다시 누르는 것은 실행 취소가 아니다 — 소프트 선호와 전체 재계산 탓에
 * 역방향 명령이 원래 일정과 같은 결과를 보장하지 않는다. **직전 상태를 통째로** 들고 있다가
 * 복원한다.
 *
 * 스냅샷 모양을 화면 밖에 두는 이유는 하나다. **빠뜨린 필드는 조용히 안 돌아온다.**
 * 저장 상태를 빠뜨렸을 때 이미 저장된 일정을 바꿨다 취소해도 `dirty`로 남는 것을
 * PR #150 리뷰에서 잡았다. 여기 모아 두면 무엇을 복원하는지 한눈에 보이고 테스트로 잠근다.
 */
import type { ItineraryResult } from "./engine/types";
import type { ItineraryDiff } from "./itinerary-diff";

export type UndoPoint<Alt = unknown, Save = string> = {
  /** 선택 장소와 방문일 선호 — 요청을 만드는 입력 */
  selectedPlaceIds: Set<string>;
  preferredVisitDates: Record<string, string>;
  /** 화면에 있던 결과와 선택 대안 */
  result: ItineraryResult;
  selectedAlt: Alt;
  /** 변경 표시와 재계산 sequence 일관성 */
  diff: ItineraryDiff | null;
  settledSelectionKey: string | null;
  /** 저장 상태 — 되돌렸는데 미저장 변경으로 남으면 안 된다 */
  saveStatus: Save;
  /** 그 일정 기준으로 조회했던 테마 체험 표시 */
  themeExperience: unknown;
};

/** 스냅샷이 담아야 하는 키 — 하나라도 빠지면 그 상태는 복원되지 않는다 */
export const UNDO_POINT_KEYS = [
  "selectedPlaceIds",
  "preferredVisitDates",
  "result",
  "selectedAlt",
  "diff",
  "settledSelectionKey",
  "saveStatus",
  "themeExperience",
] as const satisfies readonly (keyof UndoPoint)[];

/**
 * 되돌리기 지점을 만든다. 결과가 없으면(아직 일정이 없으면) 되돌릴 것도 없다.
 *
 * 값은 **복사해서** 담는다 — `Set`과 객체를 그대로 들고 있으면 이후 편집이 스냅샷까지
 * 바꿔 되돌리기가 현재 상태를 복원하게 된다.
 */
export function undoPointOf<Alt, Save>(state: {
  selectedPlaceIds: ReadonlySet<string>;
  preferredVisitDates: Record<string, string>;
  result: ItineraryResult | null;
  selectedAlt: Alt;
  diff: ItineraryDiff | null;
  settledSelectionKey: string | null;
  saveStatus: Save;
  themeExperience: unknown;
}): UndoPoint<Alt, Save> | null {
  if (!state.result) return null;
  return {
    selectedPlaceIds: new Set(state.selectedPlaceIds),
    preferredVisitDates: { ...state.preferredVisitDates },
    result: state.result,
    selectedAlt: state.selectedAlt,
    diff: state.diff,
    settledSelectionKey: state.settledSelectionKey,
    saveStatus: state.saveStatus,
    themeExperience: state.themeExperience,
  };
}
