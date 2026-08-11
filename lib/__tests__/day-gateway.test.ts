import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DayGatewayInfo } from "@/app/day-gateway";
import type { AirportLeg } from "../itinerary-rows";
import type { MessageKey } from "../i18n/messages";

/**
 * DAY 헤더 공항 진입 조회 (#146)
 *
 * **선택기가 아니다.** 공항철도↔버스를 고르는 것은 독의 `gateway` 카드가 맡는다.
 * 같은 상태를 고치는 컨트롤이 둘이면 어느 쪽이 참인지 알 수 없다.
 */
const copy: Partial<Record<MessageKey, string>> = {
  "step4.dayGateway": "이 날 공항 진입 구간 {n}건",
  "step4.gatewayToAirport": "공항으로",
  "step4.gatewayFromAirport": "공항에서",
  "step4.gatewayRail": "공항철도",
  "step4.gatewayBus": "공항버스",
  "step4.gatewayPickerHint": "이동 수단 선택은 아래 공항 진입 패널에서 바꿉니다.",
  "gateway.dockTitle": "공항 진입",
};
const tr = (key: MessageKey) => copy[key] ?? key;

const leg = (over: Partial<AirportLeg> = {}): AirportLeg => ({
  kind: "rail", serviceName: { ko: "AREX-E112", en: "AREX-E112" },
  fromStationId: "ST-AIRPORT", toStationId: "ST-SEOUL",
  departAt: "2026-08-12T12:18:00.000Z", arriveAt: "2026-08-12T13:01:00.000Z",
  direction: "from_airport", ...over,
});

const render = (legs: AirportLeg[], locale: "ko" | "en" = "ko") =>
  renderToStaticMarkup(createElement(DayGatewayInfo, {
    legs, stationName: (id: string) => `${id}역`, date: "2026-08-12", locale,
    formatTime: (iso: string) => iso.slice(11, 16), tr,
  }));

describe("표시 조건", () => {
  /** 왕복이면 첫날·마지막날에만 나온다 — 없는 날에 빈 아이콘을 두지 않는다 */
  it("공항 구간이 없는 날에는 아이콘을 두지 않는다", () => {
    expect(render([])).toBe("");
  });

  it("구간 수를 배지와 이름에 함께 적는다", () => {
    const html = render([leg(), leg({ direction: "to_airport", departAt: "2026-08-12T14:50:00.000Z" })]);
    expect(html).toContain('aria-label="이 날 공항 진입 구간 2건"');
    expect(html).toContain(">2<");
  });
});

describe("내용", () => {
  it("방향과 구간, 시각, 수단을 말한다", () => {
    const html = render([leg()]);
    expect(html).toContain("공항에서");
    expect(html).toContain("ST-AIRPORT역");
    expect(html).toContain("ST-SEOUL역");
    expect(html).toContain("12:18");
    expect(html).toContain("공항철도");
    expect(html).toContain("AREX-E112");
  });

  it("버스 구간은 버스로 적는다", () => {
    expect(render([leg({ kind: "bus", serviceName: { ko: "공항버스 6001", en: "Airport bus 6001" } })])).toContain("공항버스");
  });

  /** 고르는 곳이 여기가 아님을 밝히지 않으면 왜 못 바꾸는지 찾게 된다 */
  it("선택은 다른 곳에서 한다고 알린다", () => {
    expect(render([leg()])).toContain("이동 수단 선택은 아래 공항 진입 패널에서 바꿉니다");
  });

  it("팝오버 제목을 aria-labelledby로 연결한다", () => {
    const html = render([leg()]);
    const titleId = html.match(/aria-labelledby="([^"]+)"/)?.[1];
    expect(titleId).toBeTruthy();
    expect(html).toContain(`id="${titleId}"`);
  });
});

describe("PR #159 리뷰 — 언어와 방향", () => {
  /**
   * 역 이름은 이미 locale을 따른다. 노선명만 한국어로 굳으면 **한 팝오버 안에서
   * 언어가 섞인다** — 외국인 사용자 대상 서비스에서 특히 나쁘다.
   */
  it("영문 화면에서는 버스 노선명도 영문이다", () => {
    const bus = leg({ kind: "bus", serviceName: { ko: "공항버스 6001", en: "Airport bus 6001" } });
    expect(render([bus], "en")).toContain("Airport bus 6001");
    expect(render([bus], "en")).not.toContain("공항버스 6001");
  });

  it("한글 화면에서는 한글 노선명을 쓴다", () => {
    const bus = leg({ kind: "bus", serviceName: { ko: "공항버스 6001", en: "Airport bus 6001" } });
    expect(render([bus], "ko")).toContain("공항버스 6001");
  });
});
