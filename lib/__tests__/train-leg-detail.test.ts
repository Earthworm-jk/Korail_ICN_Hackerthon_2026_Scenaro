import { describe, expect, it } from "vitest";
import {
  isAirportRailLeg,
  isAirportDeparture,
  legDurationMinutes,
  legSourceKey,
  type TrainLegDetail,
} from "../../app/train-leg-modal";
import { messages } from "../i18n/messages";

/**
 * 열차 구간 팝업의 판별 규칙 (인수인계 G · PR #112 리뷰)
 *
 * 실행 지원 카드의 안내를 구간 팝업으로 옮기면서 문구가 조용히 사라지는 사고가 한 번
 * 있었다 — 옛 `support.arrivalStep1`의 탑승 위치가 빠졌다. 다음에 또 문구를 옮길 때
 * 같은 일이 생기지 않도록 판별 규칙을 여기서 고정한다.
 */

const leg = (over: Partial<TrainLegDetail> = {}): TrainLegDetail => ({
  trainNo: "00815",
  fromStationId: "station-seoul",
  toStationId: "station-gangneung",
  fromName: "서울역",
  toName: "강릉역",
  departAt: "2026-08-12T13:55:00+09:00",
  arriveAt: "2026-08-12T15:54:00+09:00",
  ...over,
});

const arexOutbound = leg({
  trainNo: "AREX-E112",
  fromStationId: "station-incheon-airport-t1",
  toStationId: "station-seoul",
  departAt: "2026-08-12T12:18:00+09:00",
  arriveAt: "2026-08-12T13:01:00+09:00",
});

const arexInbound = leg({
  trainNo: "AREX-W114",
  fromStationId: "station-seoul",
  toStationId: "station-incheon-airport-t1",
  departAt: "2026-08-14T14:10:00+09:00",
  arriveAt: "2026-08-14T14:53:00+09:00",
});

describe("공항철도 구간 판별", () => {
  it("AREX- 접두로만 공항철도를 가른다", () => {
    expect(isAirportRailLeg("AREX-E112")).toBe(true);
    expect(isAirportRailLeg("00815")).toBe(false);
    // 공식 편명이 아니라 스냅샷 내 식별자다 — 숫자 편명에 섞이지 않는다
    expect(isAirportRailLeg("00503")).toBe(false);
  });

  it("탑승 위치 안내는 공항을 떠나는 방향에서만 나온다", () => {
    expect(isAirportDeparture(arexOutbound)).toBe(true);
    // 도착 방향에서는 이미 내린 뒤라 탑승 위치가 필요 없다
    expect(isAirportDeparture(arexInbound)).toBe(false);
  });

  it("일반 열차는 공항 출발이 아니다", () => {
    expect(isAirportDeparture(leg())).toBe(false);
    // 공항역에서 출발해도 열차번호가 공항철도가 아니면 이 안내 대상이 아니다
    expect(isAirportDeparture(leg({ fromStationId: "station-incheon-airport-t1" }))).toBe(false);
  });
});

describe("소요시간 — 표시된 시각의 차이지 새 데이터가 아니다", () => {
  it("출발·도착 시각의 차를 분으로 준다", () => {
    expect(legDurationMinutes(arexOutbound)).toBe(43);
    expect(legDurationMinutes(leg())).toBe(119);
  });

  it("표기가 달라도 같은 순간이면 같은 값이다", () => {
    // 스냅샷은 +09:00, 엔진 출력은 UTC(Z) — 문자열이 아니라 시각으로 계산한다
    expect(legDurationMinutes({
      departAt: "2026-08-12T12:18:00+09:00",
      arriveAt: "2026-08-12T04:01:00.000Z",
    })).toBe(43);
  });

  it("자정을 넘겨도 음수가 되지 않는다", () => {
    expect(legDurationMinutes({
      departAt: "2026-08-12T23:30:00+09:00",
      arriveAt: "2026-08-13T00:20:00+09:00",
    })).toBe(50);
  });
});

describe("출처 표기 — 옮기되 지우지 않는다", () => {
  it("공항철도와 일반 열차의 출처가 나뉜다", () => {
    expect(legSourceKey(arexOutbound)).toBe("support.arexSource");
    expect(legSourceKey(leg())).toBe("leg.railSource");
  });

  it("두 출처 문구가 ko·en 양쪽에 살아 있다", () => {
    for (const locale of ["ko", "en"] as const) {
      expect(messages[locale]["support.arexSource"]).toBeTruthy();
      expect(messages[locale]["leg.railSource"]).toBeTruthy();
      expect(messages[locale]["leg.arexBoarding"]).toBeTruthy();
      expect(messages[locale]["leg.arexNote"]).toBeTruthy();
    }
  });

  it("탑승 위치 문구가 제1터미널을 가리킨다 — 옛 안내의 정보를 유지한다", () => {
    expect(messages.ko["leg.arexBoarding"]).toContain("제1터미널");
    expect(messages.en["leg.arexBoarding"]).toContain("Terminal 1");
  });

  it("카드로 돌아간 옛 키는 되살아나지 않는다", () => {
    for (const locale of ["ko", "en"] as const) {
      const keys = Object.keys(messages[locale]);
      expect(keys).not.toContain("support.arrivalStep1");
      expect(keys).not.toContain("support.arrivalStep2");
      expect(keys).not.toContain("support.returnStep1");
      expect(keys).not.toContain("support.returnStep2");
    }
  });
});
