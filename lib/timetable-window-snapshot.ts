import "server-only";

/**
 * 열차 스냅샷이 수록한 KST 날짜 범위 (#160 · QA 실측)
 *
 * 화면이 이 범위 밖 날짜를 고르지 못하게 막는 근거다. 범위 밖을 고르면 선택한 장소가
 * 전부 `TRAIN_UNAVAILABLE`로 떨어지는데, 화면은 "이용 가능한 KTX가 없습니다"만 말하고
 * "그 날짜는 수록 범위 밖"이라고 알려주지 않아 서비스가 고장난 것으로 읽힌다.
 *
 * 값을 화면에 박아 두지 않고 스냅샷에서 파생한다 — 기본 날짜를 하드코딩해 둔 탓에
 * 스냅샷을 갱신할 때마다 어긋났던 문제를 되풀이하지 않기 위해서다.
 */
import { loadRepositories } from "./repositories/json";
import type { TimetableWindow } from "./timetable-window";

/** 스냅샷 시각은 항상 `+09:00` 표기라 앞 10자가 곧 KST 날짜다 */
function kstDateOf(iso: string): string {
  return iso.slice(0, 10);
}

export function loadTimetableWindow(): TimetableWindow {
  const dates = loadRepositories().trainLegs.map((leg) => kstDateOf(leg.departAt));
  if (dates.length === 0) {
    throw new Error("train snapshot is empty — cannot derive the timetable window");
  }
  return {
    firstDate: dates.reduce((a, b) => (a < b ? a : b)),
    lastDate: dates.reduce((a, b) => (a > b ? a : b)),
  };
}
