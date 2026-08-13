import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isWithinTimetableWindow, step1ErrorOf, type TimetableWindow } from "../timetable-window";

/**
 * 1단계 전이 검사 (PR #202 리뷰 차단)
 *
 * `<input type="date">`의 `min`/`max`는 달력을 좁히고 constraint validity만 세운다.
 * 직접 입력한 범위 밖 값은 그대로 상태에 들어오고, 1단계 "다음"은 form submit이 아니라
 * onClick이라 그 값으로 2단계에 갈 수 있었다. 그러면 이 변경이 막으려던
 * `TRAIN_UNAVAILABLE` 경로가 다시 열린다. 전이 자체를 막는 규칙을 고정한다.
 */
const WINDOW: TimetableWindow = { firstDate: "2026-08-12", lastDate: "2026-08-18" };

const VALID = {
  arrivalAt: "2026-08-16T10:00",
  departureAt: "2026-08-18T18:00",
  airportReadyAt: "2026-08-16T12:00",
  airportArrivalDeadline: "2026-08-18T16:00",
};

describe("수록 범위 밖 직접 입력", () => {
  it("범위 안이면 통과한다", () => {
    expect(step1ErrorOf(VALID, WINDOW)).toBeNull();
  });

  it("경계 날짜는 범위 안이다 — 첫날·마지막날을 배제하지 않는다", () => {
    expect(step1ErrorOf({
      arrivalAt: "2026-08-12T10:00",
      departureAt: "2026-08-18T18:00",
      airportReadyAt: "2026-08-12T12:00",
      airportArrivalDeadline: "2026-08-18T16:00",
    }, WINDOW)).toBeNull();
  });

  /** 달력에서 못 고르는 값을 키보드로 넣은 상황 — 리뷰가 짚은 바로 그 경로 */
  for (const field of ["arrivalAt", "departureAt", "airportReadyAt", "airportArrivalDeadline"] as const) {
    it(`${field}만 범위 밖이어도 막는다`, () => {
      const shifted = field === "arrivalAt" || field === "airportReadyAt"
        ? { ...VALID, arrivalAt: "2026-09-01T10:00", airportReadyAt: "2026-09-01T12:00",
            departureAt: "2026-09-03T18:00", airportArrivalDeadline: "2026-09-03T16:00" }
        : { ...VALID, departureAt: "2026-09-03T18:00", airportArrivalDeadline: "2026-09-03T16:00" };
      expect(step1ErrorOf(shifted, WINDOW)).toBe("step1.errOutsideWindow");
    });
  }

  it("범위보다 이른 날짜도 막는다", () => {
    expect(step1ErrorOf({
      arrivalAt: "2026-08-01T10:00",
      departureAt: "2026-08-03T18:00",
      airportReadyAt: "2026-08-01T12:00",
      airportArrivalDeadline: "2026-08-03T16:00",
    }, WINDOW)).toBe("step1.errOutsideWindow");
  });

  it("범위 판정은 날짜 단위다 — 같은 날의 시각은 영향이 없다", () => {
    expect(isWithinTimetableWindow("2026-08-18T23:59", WINDOW)).toBe(true);
    expect(isWithinTimetableWindow("2026-08-19T00:00", WINDOW)).toBe(false);
  });
});

describe("기존 1단계 검사는 그대로다", () => {
  it("필수값이 비면 막는다", () => {
    expect(step1ErrorOf({ ...VALID, arrivalAt: "" }, WINDOW)).toBe("step1.errRequired");
  });

  it("출국이 입국보다 이르면 막는다", () => {
    expect(step1ErrorOf({ ...VALID, departureAt: "2026-08-15T18:00" }, WINDOW)).toBe("step1.errOrder");
  });

  it("공항 출발이 입국보다 이르면 막는다", () => {
    expect(step1ErrorOf({ ...VALID, airportReadyAt: "2026-08-16T09:00" }, WINDOW)).toBe("step1.errReadyRange");
  });

  it("도착 마감이 출국보다 늦으면 막는다", () => {
    expect(step1ErrorOf({ ...VALID, airportArrivalDeadline: "2026-08-18T19:00" }, WINDOW))
      .toBe("step1.errDeadlineRange");
  });

  /** 순서 오류가 범위 오류보다 먼저 나온다 — 기존 문구를 범위 문구가 덮지 않는다 */
  it("순서와 범위가 함께 틀리면 순서를 먼저 알린다", () => {
    expect(step1ErrorOf({
      arrivalAt: "2026-09-03T10:00",
      departureAt: "2026-09-01T18:00",
      airportReadyAt: "2026-09-03T12:00",
      airportArrivalDeadline: "2026-09-01T16:00",
    }, WINDOW)).toBe("step1.errOrder");
  });
});

/**
 * 규칙을 옮겨 적으면 화면과 따로 논다. 화면이 이 함수를 실제로 쓰는지 원본에서 확인한다
 * (overselection-e2e의 진입점 검사와 같은 이유).
 */
describe("화면이 같은 함수를 쓴다", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../../app/planner-wizard.tsx", import.meta.url)),
    "utf8",
  );

  it("planner-wizard가 step1ErrorOf로 판정한다", () => {
    expect(source).toContain("step1ErrorOf({");
  });

  it("판정 조건을 화면에 다시 늘어놓지 않는다", () => {
    expect(source).not.toContain('"step1.errRequired"');
    expect(source).not.toContain('"step1.errOrder"');
  });
});
