import { describe, expect, it } from "vitest";
import { messages } from "../i18n/messages";

/**
 * 결과 열 데이터 기준 공지·검증 문구 계약 (#83 §F)
 *
 * 시안(v0.6)의 검증 문구는 "열차·선택 장소·공항 복귀 조건을 통과했습니다"였다.
 * 그 문장이 쓰인 뒤 계약이 두 번 바뀌었다.
 *
 * - #43: 운영시간은 하드 제약이 아니다. 미확인 장소도 배치하고 경고만 단다.
 * - #84: 선택한 장소를 다 넣지 못하는 것은 오류가 아니라 정상 흐름이다.
 *
 * 그래서 "선택 장소가 통과했다"는 미배치가 있는 일정에서 거짓이 되고, 바로 아래
 * "배치하지 못한 장소" 목록과 모순된다. 엔진이 실제로 지키는 것은 검증 시간표와
 * 공항 도착 마감뿐이다(`CandidateRejection` 3종이 그 밖의 실패를 담는다).
 *
 * 이 테스트는 시안 문구가 "원상복구"라는 이름으로 되돌아오는 것을 막는다.
 */
describe("검증 문구가 보장하지 않는 것을 주장하지 않는다 (#43 · #84)", () => {
  it("선택 장소가 조건을 통과했다고 단정하지 않는다", () => {
    expect(messages.ko["step4.validation"]).not.toContain("통과");
    expect(messages.en["step4.validation"]).not.toContain("passes");
    expect(messages.ko["step4.validation"]).not.toContain("선택 장소");
  });

  it("운영시간이 제외가 아니라 경고임을 밝힌다", () => {
    expect(messages.ko["step4.validation"]).toContain("경고");
    expect(messages.en["step4.validation"]).toContain("warning");
  });

  /**
   * PR #106 리뷰 비차단. `ActivityWindowDetail`은 셋이다 — UNVERIFIED_HOURS(미확인),
   * OUTSIDE_VERIFIED_HOURS(확인된 시간 밖), CONSERVATIVE_BUFFER_MISMATCH(보수 버퍼).
   * 문구가 "확인되지 않은 장소"로만 좁아지면 뒤의 둘을 반대로 설명하게 된다.
   */
  it("경고 범위를 미확인 하나로 좁히지 않는다", () => {
    expect(messages.ko["step4.validation"]).toContain("맞지 않을 수 있는");
    expect(messages.en["step4.validation"]).toContain("may not line up");
  });

  it("넣지 못한 장소가 있을 수 있음을 밝힌다", () => {
    expect(messages.ko["step4.validation"]).toContain("넣지 못한");
    expect(messages.en["step4.validation"]).toContain("could not fit");
  });
});

describe("데이터 기준 공지 (#83 §F)", () => {
  it("스냅샷 기준임을 밝힌다", () => {
    expect(messages.ko["step4.dataNotice"]).toContain("스냅샷");
    expect(messages.en["step4.dataNotice"]).toContain("snapshot");
  });

  it("예약 전 재확인을 안내한다 — 확정 예약 정보로 읽히지 않게 한다", () => {
    expect(messages.ko["step4.dataNotice"]).toContain("다시 확인");
    expect(messages.en["step4.dataNotice"]).toContain("Re-check");
  });

  it("접근시간·대중교통 고지(#61)를 중복해 말하지 않는다", () => {
    // access.notice가 이미 좌측 후보 목록 위에 있다. 같은 말을 두 곳에서 하지 않는다.
    expect(messages.ko["step4.dataNotice"]).not.toContain("대중교통");
    expect(messages.en["step4.dataNotice"]).not.toContain("public transit");
  });
});
