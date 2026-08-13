import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { messages } from "../i18n/messages";

/**
 * QA에서 나온 P1 결함 3건의 재발 방지 (#196)
 *
 * 셋 다 "사용자가 지금 상태를 읽을 수 없다"는 같은 성격이다. 화면 배선이라 순수 함수로
 * 옮길 수 없는 부분은 원본에서 확인한다 — 옮겨 적은 규칙이 화면과 따로 노는 것을 막는
 * overselection-e2e의 진입점 검사와 같은 이유다.
 */
const wizard = readFileSync(
  fileURLToPath(new URL("../../app/planner-wizard.tsx", import.meta.url)),
  "utf8",
);
const map = readFileSync(
  fileURLToPath(new URL("../../app/korea-map.tsx", import.meta.url)),
  "utf8",
);

describe("항공편 조회 — 진행과 실패를 화면이 말한다", () => {
  it("조회 중에는 버튼이 잠긴다 — 연타가 서버 액션을 여러 번 보내지 않는다", () => {
    expect(wizard).toContain("disabled={lookupPending !== null || !field.flightNo.trim()}");
  });

  it("조회 중에는 버튼 문구가 바뀐다 — 눌렸는지 알 수 있어야 한다", () => {
    expect(wizard).toContain('tr(lookupPending?.direction === direction ? "step1.lookupPending" : "step1.lookup")');
  });

  /** 부동 프로미스로 두면 서버 액션 실패가 삼켜져 화면이 침묵한다 */
  it("조회 실패를 삼키지 않는다", () => {
    expect(wizard).toContain('tr("step1.lookupFailed")');
  });

  /**
   * 전이 자체는 flight-lookup.test.ts가 본다. 여기서는 화면이 그 함수를 쓰는지만 확인한다 —
   * 규칙을 옮겨 적으면 화면과 따로 논다 (PR #205 리뷰).
   */
  it("상태 전이를 화면에 다시 적지 않고 순수 함수에 맡긴다", () => {
    expect(wizard).toContain("flightFieldAfterSuccess");
    expect(wizard).toContain("flightFieldAfterNotFound");
    expect(wizard).toContain("flightFieldAfterFailure");
    expect(wizard).toContain("flightFieldAfterFlightNoEdit");
  });

  it("늦게 온 응답을 순번으로 버린다", () => {
    expect(wizard).toContain("acceptsLookupResponse(lookupRef.current, sequence)");
  });

  /**
   * 진행 표시를 끄는 것은 자기 요청뿐이다. 전이 자체는 flight-lookup.test.ts가 본다.
   */
  it("진행 표시 종료를 조율 함수에 맡긴다", () => {
    expect(wizard).toContain("settleLookup(lookupRef.current, sequence)");
    expect(wizard).toContain("startLookup(lookupRef.current, direction)");
  });

  /** 성공 응답의 시각 반영이 자기 순번을 올리면 버튼이 굳는다 (재리뷰) */
  it("시각 반영 자체는 순번을 올리지 않는다 — 무효화는 사용자 편집 경로에만", () => {
    expect(wizard).toContain("const setArrivalAtInput = useCallback((at: string) => {\n    setArrival(");
    expect(wizard).toContain("const setDepartureAtInput = useCallback((at: string) => {\n    setDeparture(");
    expect(wizard).toContain("invalidateFlightLookup();");
  });

  it("편명 없음과 조회 실패는 다른 문구다 — 사용자가 할 일이 다르다", () => {
    for (const locale of ["ko", "en"] as const) {
      expect(messages[locale]["step1.notFound"]).not.toBe(messages[locale]["step1.lookupFailed"]);
    }
  });

  it("새 문구가 ko·en 모두 있다", () => {
    for (const key of ["step1.lookupPending", "step1.lookupFailed"] as const) {
      expect(messages.ko[key]).toBeTruthy();
      expect(messages.en[key]).toBeTruthy();
    }
  });
});

describe("모바일 지도 — 핀치가 페이지를 확대하지 않는다", () => {
  /** 주석이 아니라 실제 클래스 문자열을 본다 */
  const svgClassName = map.match(/className=\{`block w-full[^`]*`\}/)?.[0] ?? "";

  it("지도가 터치 제스처를 자기 것으로 선언한다", () => {
    expect(svgClassName).toContain("touch-pan-y");
  });

  /**
   * `touch-none`으로 전부 막으면 지도가 화면을 채웠을 때 페이지를 내릴 수 없어 갇힌다.
   * 세로 스크롤은 반드시 남긴다.
   */
  it("세로 스크롤까지 막지는 않는다", () => {
    expect(svgClassName).not.toContain("touch-none");
  });

  it("줌 버튼이 모바일에서 44px다 — 확대 수단이 실제로 눌려야 한다", () => {
    expect(map).toContain("size-11 lg:size-7");
  });

  /** 1024px 이상은 PR #138에서 맞춘 치수를 보존한다 (#160 파일 소유권 경계) */
  it("데스크톱 치수는 그대로 둔다", () => {
    expect(map).toContain("lg:size-7");
  });
});

describe("권역 창 — 시각과 분량이 같은 기준을 쓴다", () => {
  it("화면이 시작 시각 하나가 아니라 구간을 그린다", () => {
    expect(wizard).toContain("{fmtTime(presentation.startAt)}-{fmtTime(presentation.endAt)}");
  });

  it("원본 경계를 그대로 쓰지 않는다", () => {
    expect(wizard).not.toContain("{fmtTime(window.startAt)}");
  });
});
