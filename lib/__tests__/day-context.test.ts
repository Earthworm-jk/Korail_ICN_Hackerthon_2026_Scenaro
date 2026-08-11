import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DayStationFacilities } from "@/app/day-context";
import type { StationFacilitiesSnapshotT } from "../station-facilities";
import type { MessageKey } from "../i18n/messages";

/**
 * DAY 헤더 역 시설 (#146 2절, PR #155 리뷰 3)
 *
 * 목록 popover를 닫고 모달을 여는 **순서**는 여기서 못 잡는다 — 테스트 환경이 node라
 * DOM도 popover API도 없다. 동결 당일에 jsdom을 넣는 건 공유 도구를 건드리는 일이라
 * 그 한 건만 실측으로 확인하고 PR 본문에 남긴다. 나머지 계약은 전부 여기서 고정한다.
 */
const tr = (key: MessageKey) => key;
const stationName = (id: string) => `${id}역`;

function snapshotOf(...ids: string[]): StationFacilitiesSnapshotT {
  return {
    fetchedAt: "2026-08-01T00:00:00.000Z",
    stations: ids.map((stationId) => ({ stationId })),
  } as unknown as StationFacilitiesSnapshotT;
}

function render(snapshot: StationFacilitiesSnapshotT, stationIds: string[]) {
  return renderToStaticMarkup(createElement(DayStationFacilities, {
    snapshot, stationIds, stationName, date: "2026-08-12", tr,
  }));
}

describe("수록 여부", () => {
  // 눌러 봐야 빈 화면이면 없느니만 못하다
  it("스냅샷에 없는 역은 목록에 넣지 않는다", () => {
    const html = render(snapshotOf("ST-A"), ["ST-A", "ST-MISSING"]);
    expect(html).toContain("ST-A역");
    expect(html).not.toContain("ST-MISSING역");
  });

  it("역이 없는 날에는 배지를 두지 않는다", () => {
    expect(render(snapshotOf("ST-A"), [])).toBe("");
  });

  it("배지 수는 수록된 역만 센다", () => {
    const html = render(snapshotOf("ST-A", "ST-B"), ["ST-A", "ST-B", "ST-MISSING"]);
    expect(html).toContain('aria-label="step4.dayFacilities"');
    expect(html).toContain(">2<");
  });
});

describe("팝오버 접근성", () => {
  it("제목을 aria-labelledby로 연결한다", () => {
    const html = render(snapshotOf("ST-A"), ["ST-A"]);
    const titleId = html.match(/aria-labelledby="([^"]+)"/)?.[1];
    expect(titleId).toBeTruthy();
    expect(html).toContain(`id="${titleId}"`);
  });

  it("트리거가 팝오버를 가리킨다", () => {
    const html = render(snapshotOf("ST-A"), ["ST-A"]);
    const target = html.match(/popover[Tt]arget="([^"]+)"/)?.[1];
    expect(target).toBeTruthy();
    expect(html).toContain(`id="${target}"`);
  });

  /** 날짜가 id에 들어가야 여러 날의 팝오버가 서로를 덮어쓰지 않는다 */
  it("팝오버 id가 날짜별로 갈린다", () => {
    const one = renderToStaticMarkup(createElement(DayStationFacilities, {
      snapshot: snapshotOf("ST-A"), stationIds: ["ST-A"], stationName, date: "2026-08-12", tr,
    }));
    const two = renderToStaticMarkup(createElement(DayStationFacilities, {
      snapshot: snapshotOf("ST-A"), stationIds: ["ST-A"], stationName, date: "2026-08-13", tr,
    }));
    expect(one.match(/id="([^"]+)"/)?.[1]).not.toBe(two.match(/id="([^"]+)"/)?.[1]);
  });
});

describe("히트 영역", () => {
  /**
   * 유틸리티로 선언한다. `stage-v4.css`의 하한이 `:not([class*="min-h-"])`로 좁혀져
   * **스스로 높이를 선언한 버튼은 비켜 간다** — 그 계약이 이 클래스들의 전제다.
   * 실제 px는 여기서 못 재므로 실측으로 확인하고 PR 본문에 남긴다.
   */
  it("배지 40px, 역 버튼 44px를 유틸리티로 선언한다", () => {
    const html = render(snapshotOf("ST-A"), ["ST-A"]);
    expect(html).toMatch(/min-h-10/);
    expect(html).toMatch(/min-h-11/);
  });
});

describe("#146 — 독 카드에서 옮겨온 것들", () => {
  /**
   * 조용히 빼면 사용자는 "그 역엔 시설이 없다"로 읽는다. **확보되지 않은 것과
   * 없는 것은 다르다** — 독 카드에 있던 고지를 여기로 옮겼다.
   */
  it("수록되지 않은 역이 있으면 그 사실을 알린다", () => {
    const html = render(snapshotOf("ST-A"), ["ST-A", "ST-MISSING"]);
    expect(html).toContain("support.facilitiesMissing");
  });

  it("전부 수록됐으면 고지하지 않는다", () => {
    expect(render(snapshotOf("ST-A"), ["ST-A"])).not.toContain("support.facilitiesMissing");
  });

  it("출처와 확인일을 함께 적는다", () => {
    const html = render(snapshotOf("ST-A"), ["ST-A"]);
    expect(html).toContain("support.facilitiesSource");
    expect(html).toContain("2026-08-01");
  });

  /**
   * #155에서는 "수록된 역이 없으면 배지를 두지 않는다"였다. 그때는 눌러도 빈 화면이라
   * 그게 맞았지만, 이제 그 자리에 짐 보관 안내가 들어가므로 빈 화면이 아니다.
   */
  it("수록된 역이 없으면 짐 보관 안내를 대신 보여준다", () => {
    const html = render(snapshotOf("ST-OTHER"), ["ST-A", "ST-B"]);
    expect(html).not.toBe("");
    expect(html).toContain("support.luggageTitle");
    expect(html).toContain("support.luggageSource");
  });

  it("거치는 역이 아예 없는 날에는 여전히 두지 않는다", () => {
    expect(render(snapshotOf("ST-A"), [])).toBe("");
  });
});
