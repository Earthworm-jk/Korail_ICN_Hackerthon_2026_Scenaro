/**
 * 열차 스냅샷 수록 범위와 1단계 날짜 검사 (#160 · QA 실측 · PR #202 리뷰)
 *
 * 순수 모듈이다. 스냅샷을 읽는 로더는 `timetable-window-snapshot.ts`(server-only)에 있고,
 * 화면은 그 값을 props로 받아 여기 규칙으로 판정한다.
 *
 * `<input type="date">`의 `min`/`max`는 달력을 좁히고 constraint validity만 세울 뿐,
 * **직접 입력한 범위 밖 값이 상태에 들어오는 것을 막지 못한다.** 1단계 "다음"은 form submit이
 * 아니라 onClick이라 그대로 2단계로 넘어갈 수 있고, 그러면 수록 범위 밖 일정이 만들어져
 * 선택 장소가 전부 `TRAIN_UNAVAILABLE`로 떨어진다 (PR #202 리뷰). 그래서 전이 자체를 막는다.
 */
import type { MessageKey } from "./i18n/messages";

export type TimetableWindow = {
  /** 수록 첫날 (YYYY-MM-DD, KST) */
  firstDate: string;
  /** 수록 마지막날 (YYYY-MM-DD, KST) */
  lastDate: string;
};

/** datetime-local(`2026-08-16T10:00`)이든 날짜든 앞 10자가 KST 날짜다 */
function dateOf(value: string): string {
  return value.slice(0, 10);
}

export function isWithinTimetableWindow(value: string, window: TimetableWindow): boolean {
  const date = dateOf(value);
  return date >= window.firstDate && date <= window.lastDate;
}

export type Step1Times = {
  arrivalAt: string;
  departureAt: string;
  airportReadyAt: string;
  airportArrivalDeadline: string;
};

/**
 * 1단계에서 다음 단계로 넘어갈 수 있는지 — 필수값·입출국 순서·공항 경계·수록 범위.
 *
 * 화면 안에 조건을 늘어놓으면 "달력은 막았는데 직접 입력은 통과한다" 같은 구멍을 테스트로
 * 고정할 수 없다. 규칙을 한곳에 모아 그대로 검사한다 (PR #30 리뷰 ③ + #14 차단 2).
 */
export function step1ErrorOf(times: Step1Times, window: TimetableWindow): MessageKey | null {
  const { arrivalAt, departureAt, airportReadyAt, airportArrivalDeadline } = times;
  if (!arrivalAt || !departureAt || !airportReadyAt || !airportArrivalDeadline) {
    return "step1.errRequired";
  }
  const ms = (at: string) => Date.parse(`${at}:00+09:00`);
  if (ms(departureAt) <= ms(arrivalAt)) return "step1.errOrder";
  if (ms(airportReadyAt) < ms(arrivalAt)) return "step1.errReadyRange";
  if (ms(airportArrivalDeadline) > ms(departureAt) || ms(airportArrivalDeadline) <= ms(airportReadyAt)) {
    return "step1.errDeadlineRange";
  }
  // 달력을 좁혀도 직접 입력이 통과하므로 여기서 결정적으로 막는다
  const outside = [arrivalAt, departureAt, airportReadyAt, airportArrivalDeadline]
    .some((value) => !isWithinTimetableWindow(value, window));
  return outside ? "step1.errOutsideWindow" : null;
}
