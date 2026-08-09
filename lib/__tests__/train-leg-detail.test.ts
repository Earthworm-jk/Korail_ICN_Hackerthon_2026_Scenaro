import { describe, expect, it } from "vitest";
import {
  isAirportRailLeg,
  legDurationMinutes,
  legSourceKey,
  type TrainLegDetail,
} from "../../app/train-leg-modal";
import { messages } from "../i18n/messages";

/**
 * 열차 구간 팝업의 판별 규칙 (인수인계 G)
 *
 * 실행 지원 카드의 안내를 구간 팝업으로 옮기면서, 무엇을 옮기고 무엇을 지웠는지가
 * 코드만 봐서는 드러나지 않는다. 여기서 고정한다.
 *
 * **지운 것**: 공항 진입·귀국의 3단계 안내(`support.arrivalStep1-3`,
 * `support.returnStep1-3`)는 옮기지 않고 **의도적으로 제거**했다. 탑승 위치·상세 단계
 * 설명은 결과 화면에 필요한 정보가 아니라는 팀 결정이다(요구사항 3 · PR #112 리뷰 정정).
 * 서울역 환승 동선만 #101에서 따로 다룬다.
 *
 * **옮긴 것**: 직통 안내 한 줄과 출처. 소요시간은 표시된 시각에서 계산한다.
 */

const leg = (over: Partial<TrainLegDetail> = {}): TrainLegDetail => ({
  trainNo: "00815",
  fromName: "서울역",
  toName: "강릉역",
  departAt: "2026-08-12T13:55:00+09:00",
  arriveAt: "2026-08-12T15:54:00+09:00",
  ...over,
});

const arex = leg({
  trainNo: "AREX-E112",
  fromName: "인천공항1터미널역",
  toName: "서울역",
  departAt: "2026-08-12T12:18:00+09:00",
  arriveAt: "2026-08-12T13:01:00+09:00",
});

describe("공항철도 구간 판별", () => {
  it("AREX- 접두로만 공항철도를 가른다", () => {
    expect(isAirportRailLeg("AREX-E112")).toBe(true);
    expect(isAirportRailLeg("AREX-W114")).toBe(true);
    // 공식 편명이 아니라 스냅샷 내 식별자다 — 숫자 편명에 섞이지 않는다
    expect(isAirportRailLeg("00815")).toBe(false);
    expect(isAirportRailLeg("00503")).toBe(false);
  });
});

describe("소요시간 — 표시된 시각의 차이지 새 데이터가 아니다", () => {
  it("출발·도착 시각의 차를 분으로 준다", () => {
    expect(legDurationMinutes(arex.departAt, arex.arriveAt)).toBe(43);
    expect(legDurationMinutes(leg().departAt, leg().arriveAt)).toBe(119);
  });

  it("표기가 달라도 같은 순간이면 같은 값이다", () => {
    // 스냅샷은 +09:00, 엔진 출력은 UTC(Z) — 문자열이 아니라 시각으로 계산한다
    expect(legDurationMinutes(
      "2026-08-12T12:18:00+09:00",
      "2026-08-12T04:01:00.000Z",
    )).toBe(43);
  });

  it("자정을 넘겨도 음수가 되지 않는다", () => {
    expect(legDurationMinutes(
      "2026-08-12T23:30:00+09:00",
      "2026-08-13T00:20:00+09:00",
    )).toBe(50);
  });
});

describe("출처 표기 — 옮기되 지우지 않는다", () => {
  it("공항철도와 일반 열차의 출처가 나뉜다", () => {
    expect(legSourceKey(arex)).toBe("support.arexSource");
    expect(legSourceKey(leg())).toBe("leg.railSource");
  });

  it("팝업이 쓰는 문구가 ko·en 양쪽에 살아 있다", () => {
    for (const locale of ["ko", "en"] as const) {
      expect(messages[locale]["support.arexSource"]).toBeTruthy();
      expect(messages[locale]["leg.railSource"]).toBeTruthy();
      expect(messages[locale]["leg.arexNote"]).toBeTruthy();
    }
  });
});

describe("의도적으로 제거한 안내가 되살아나지 않는다", () => {
  it("공항 진입·귀국 3단계 안내 키가 없다", () => {
    // 되돌리려는 시도가 있으면 여기서 걸린다. 지운 이유는 이 파일 상단 주석에 있다.
    for (const locale of ["ko", "en"] as const) {
      const keys = Object.keys(messages[locale]);
      for (const removed of [
        "support.arrivalTitle", "support.arrivalStep1", "support.arrivalStep2",
        "support.arrivalStep3", "support.returnTitle", "support.returnStep1",
        "support.returnStep2", "support.returnStep3",
      ]) {
        expect(keys, removed).not.toContain(removed);
      }
    }
  });
});
