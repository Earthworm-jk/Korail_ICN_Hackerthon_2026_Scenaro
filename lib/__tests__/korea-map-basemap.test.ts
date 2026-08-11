import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { KoreaMapPanel } from "@/app/korea-map";
import { messages } from "@/lib/i18n/messages";
import { tileZoomFor, tilesForView } from "@/lib/map-tiles";
import { BASE_VIEWPORT } from "@/lib/map-viewport";
import type { MessageKey } from "@/lib/i18n/messages";

/**
 * 배경 타일 레이어의 화면 계약 (#118 · #162).
 *
 * 여기서 지키는 것은 "배경이 예쁜가"가 아니라 **없어도 되는 계층인가**다. 배경은 성공하면
 * 더해지는 것이고, 실패해도 정적 지도가 그대로 남아야 한다. 그 계약이 코드에서 깨지면
 * 화면에는 "배경이 안 뜬다"로만 보이고 원인은 드러나지 않는다.
 */

const tr = (key: MessageKey) => messages.ko[key] ?? key;

const PLACES = [
  { id: "place-a", name: "영진해변", latitude: 37.8687, longitude: 128.8371, stationId: "station-gangneung", selected: true },
  { id: "place-b", name: "문화공감수정", latitude: 35.1264, longitude: 129.0432, stationId: "station-busan", selected: true },
];

function render(overrides: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(
    createElement(KoreaMapPanel, {
      kind: "places" as const,
      places: PLACES,
      stations: [],
      tr,
      ...overrides,
    }),
  );
}

describe("배경 타일 레이어", () => {
  it("기본 창을 덮는 타일을 프록시 경로로 요청한다", () => {
    const html = render();
    const zoom = tileZoomFor(BASE_VIEWPORT, 720);
    const tiles = tilesForView(BASE_VIEWPORT, zoom);

    expect(tiles.length).toBeGreaterThan(0);
    for (const tile of tiles) {
      expect(html).toContain(`/api/map-tiles/${zoom}/${tile.x}/${tile.y}`);
    }
  });

  /** 공급자를 직접 부르면 키가 클라이언트 번들에 들어간다 — 프록시를 두는 이유다 */
  it("공급자 주소를 화면이 직접 들고 있지 않다", () => {
    const html = render();
    expect(html).not.toContain("stadiamaps.com");
    expect(html).not.toContain("api_key");
    expect(html).not.toContain("vworld");
  });

  /**
   * 배경이 실패해도 정적 지도가 남는다는 계약. 타일은 폴리곤 **위에** 덮어 그리므로
   * `<image>`가 아무것도 못 받으면 밑의 폴리곤이 그대로 보인다 - 실패 처리 코드가 따로 없다.
   */
  it("한반도 폴리곤을 타일보다 먼저 그린다 — 실패하면 그것이 남는다", () => {
    const html = render();
    const outline = html.indexOf("fill-sc-blue-soft");
    const firstTile = html.indexOf("/api/map-tiles/");
    expect(outline).toBeGreaterThanOrEqual(0);
    expect(firstTile).toBeGreaterThan(outline);
  });

  it("배경 레이어는 보조 정보라 스크린리더에서 감춘다", () => {
    expect(render()).toContain('data-basemap="tiles"');
    expect(render()).toMatch(/aria-hidden="true"[^>]*data-basemap="tiles"|data-basemap="tiles"[^>]*aria-hidden="true"/);
  });

  /**
   * 출처 표기는 이용 조건이지만, 한 장도 못 받은 화면에 공급자 이름을 적으면 쓰지도 않은
   * 자료를 출처로 적는 것이 된다. 서버 렌더에는 아직 뜬 타일이 없다.
   */
  it("타일이 뜨기 전에는 배경 출처를 적지 않는다", () => {
    const html = render();
    expect(html).toContain(tr("map.source"));
    expect(html).not.toContain("Stadia Maps");
  });

  it("배경 출처 문구에 필수 표기 셋이 모두 있다", () => {
    for (const locale of ["ko", "en"] as const) {
      const text = messages[locale]["map.sourceBasemap"];
      for (const required of ["Stadia Maps", "OpenMapTiles", "OpenStreetMap"]) {
        expect(text).toContain(required);
      }
    }
  });

  it("좌표가 하나도 없으면 지도를 그리지 않으므로 타일도 부르지 않는다", () => {
    const html = render({ places: [] });
    expect(html).not.toContain("/api/map-tiles/");
  });
});
