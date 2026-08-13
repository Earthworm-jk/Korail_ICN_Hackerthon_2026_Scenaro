import { describe, expect, it } from "vitest";
import {
  flightFieldAfterFailure,
  flightFieldAfterFlightNoEdit,
  flightFieldAfterNotFound,
  flightFieldAfterSuccess,
  flightLookupIsCurrent,
  type FlightFieldState,
} from "../flight-lookup";

/**
 * 항공편 조회 상태 전이 (PR #205 리뷰 차단 2건)
 *
 * 화면 문자열이 아니라 전이 자체를 고정한다. 문자열 검사는 "그 코드가 있다"만 말하고
 * "그 상태가 옳다"는 말하지 못한다.
 */
const looked: FlightFieldState = {
  flightNo: "VZ850",
  at: "2026-08-16T10:00",
  notFound: false,
  lookupFailed: false,
  source: "live",
  status: "도착",
  terminal: "T1 탑승동",
};

describe("조회 실패 — 이전 성공의 흔적이 남지 않는다", () => {
  /**
   * 남겨 두면 "지금 조회하지 못했습니다"와 "실시간 조회 · 항공데이터"가 한 화면에 같이 떠서
   * 방금 받아온 정보처럼 읽힌다.
   */
  it("배지·운항 상태·터미널을 모두 지운다", () => {
    const next = flightFieldAfterFailure(looked);
    expect(next.lookupFailed).toBe(true);
    expect(next.source).toBeUndefined();
    expect(next.status).toBeUndefined();
    expect(next.terminal).toBeUndefined();
  });

  it("편명 없음과 겹치지 않는다 — 두 문구가 동시에 뜨지 않는다", () => {
    expect(flightFieldAfterFailure(looked).notFound).toBe(false);
    expect(flightFieldAfterNotFound(looked).lookupFailed).toBe(false);
  });

  it("사용자가 넣은 편명과 시각은 건드리지 않는다", () => {
    const next = flightFieldAfterFailure(looked);
    expect(next.flightNo).toBe("VZ850");
    expect(next.at).toBe("2026-08-16T10:00");
  });
});

describe("편명 없음 — 조회는 됐지만 그 편이 없다", () => {
  it("이전 배지를 지우고 미검색만 남긴다", () => {
    const next = flightFieldAfterNotFound(looked);
    expect(next.notFound).toBe(true);
    expect(next.source).toBeUndefined();
    expect(next.status).toBeUndefined();
    expect(next.terminal).toBeUndefined();
  });
});

describe("조회 성공 — 이전 실패 흔적을 지운다", () => {
  it("실패 뒤 다시 조회해 성공하면 실패 문구가 사라진다", () => {
    const failed = flightFieldAfterFailure(looked);
    const next = flightFieldAfterSuccess(failed, { source: "snapshot", status: undefined, terminal: "T2" });
    expect(next.lookupFailed).toBe(false);
    expect(next.notFound).toBe(false);
    expect(next.source).toBe("snapshot");
    expect(next.terminal).toBe("T2");
  });
});

describe("편명 수정 — 이전 편의 결과를 떼어 낸다", () => {
  it("문구뿐 아니라 배지·운항 상태도 지운다", () => {
    const next = flightFieldAfterFlightNoEdit(looked, "KE433");
    expect(next.flightNo).toBe("KE433");
    expect(next.source).toBeUndefined();
    expect(next.status).toBeUndefined();
    expect(next.terminal).toBeUndefined();
  });

  it("이전 실패 문구도 함께 지운다", () => {
    const next = flightFieldAfterFlightNoEdit(flightFieldAfterFailure(looked), "KE433");
    expect(next.lookupFailed).toBe(false);
    expect(next.notFound).toBe(false);
  });
});

describe("늦게 온 응답 — 새 입력을 되돌리지 않는다", () => {
  it("요청 뒤 입력이 바뀌지 않았으면 반영한다", () => {
    expect(flightLookupIsCurrent(3, 3)).toBe(true);
  });

  it("요청 뒤 입력이 바뀌었으면 버린다", () => {
    expect(flightLookupIsCurrent(3, 4)).toBe(false);
  });

  /** 조회 중 편명을 두 번 고치면 그 사이 나갔던 응답이 전부 무효다 */
  it("여러 번 바뀌어도 옛 응답은 되살아나지 않는다", () => {
    expect(flightLookupIsCurrent(3, 5)).toBe(false);
  });

  /**
   * 실제 사고 재현: VZ850 조회가 도는 동안 사용자가 KE433으로 고쳤다.
   * 순번을 안 보면 늦은 VZ850 응답이 KE433 위에 옛 배지와 시각을 덮는다.
   */
  it("조회 중 편명을 고치면 진행 중 응답이 무효가 된다", () => {
    let sequence = 0;
    const started = ++sequence;          // VZ850 조회 시작
    sequence += 1;                        // 사용자가 KE433으로 수정 -> 순번 상승
    expect(flightLookupIsCurrent(started, sequence)).toBe(false);
  });
});
