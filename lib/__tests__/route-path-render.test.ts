import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
// vitest에는 `@/` 별칭이 없다 (vitest.config.ts는 server-only만 매핑한다)
import { RoutePath } from "../../app/korea-map";

/**
 * 동선 구간의 실제 렌더 결과 (#118 P0-2, PR #122 리뷰 필수 검증).
 *
 * 리뷰에서 브라우저 실검증을 요청받았는데, SMIL 애니메이션과 `prefers-reduced-motion`은
 * 우리 도구로 화면 캡처가 어렵다. 대신 **컴포넌트가 실제로 내놓는 마크업**을 여기서 고정한다.
 * 캡처는 한 번 보고 사라지지만 이 회귀는 남는다.
 *
 * 확인하는 계약 네 가지:
 *   1. 철도는 실선, 폴백 곡선은 점선
 *   2. 애니메이션이 끝나도 점선 무늬가 남는다 (그려 넣기와 점선이 다른 축이다)
 *   3. mask 영역이 좌표계 전체를 덮어 구간 시작·끝에서 획이 잘리지 않는다
 *   4. 동작 줄이기에서는 애니메이션 속성이 붙지 않고, 점선 무늬는 그대로 남는다
 */
const RAIL_D = "M150,270L160,275L170,280";
const CURVE_D = "M150,270C155,272,160,274,170,280";

function render(props: {
  d: string;
  kind: "rail" | "curve";
  animate: boolean;
  unit?: number;
  maskId?: string;
}) {
  return renderToStaticMarkup(
    createElement("svg", null, createElement(RoutePath, {
      d: props.d,
      kind: props.kind,
      unit: props.unit ?? 1,
      animate: props.animate,
      maskId: props.maskId ?? "test-mask",
    })),
  );
}

describe("동선 구간 렌더", () => {
  describe("철도 — 실선", () => {
    it("점선 무늬를 쓰지 않는다", () => {
      const markup = render({ d: RAIL_D, kind: "rail", animate: false });
      expect(markup).not.toContain("stroke-dasharray");
      expect(markup).not.toContain("<animate");
      expect(markup).not.toContain("<mask");
    });

    it("그려 넣을 때만 길이 정규화와 애니메이션이 붙는다", () => {
      const markup = render({ d: RAIL_D, kind: "rail", animate: true });
      expect(markup).toContain('pathLength="1"');
      expect(markup).toContain('stroke-dasharray="1"');
      expect(markup).toContain('stroke-dashoffset="1"');
      expect(markup).toContain("<animate");
      expect(markup).toContain('attributeName="stroke-dashoffset"');
      // 실선을 드러내는 데는 mask가 필요 없다
      expect(markup).not.toContain("<mask");
    });
  });

  describe("폴백 곡선 — 점선", () => {
    it("동작 줄이기에서도 점선 무늬는 남는다 — 점선은 애니메이션이 아니라 표현이다", () => {
      const markup = render({ d: CURVE_D, kind: "curve", animate: false });
      // 길이 정규화용 "1"이 아니라 무늬용 두 값
      expect(markup).toContain('stroke-dasharray="4 4"');
      expect(markup).not.toContain("<animate");
      expect(markup).not.toContain("<mask");
      expect(markup).not.toContain("stroke-dashoffset");
    });

    it("그려 넣기는 mask로 한다 — 점선 무늬는 그대로 둔다", () => {
      const markup = render({ d: CURVE_D, kind: "curve", animate: true });

      // 보이는 선은 점선 무늬를 유지한다
      expect(markup).toContain('stroke-dasharray="4 4"');
      // 드러내기는 mask 안에서만 일어난다
      expect(markup).toContain("<mask");
      expect(markup).toContain('mask="url(#test-mask)"');
      expect(markup).toContain('attributeName="stroke-dashoffset"');
    });

    it("점선 간격은 배율과 무관하게 화면에서 일정하다", () => {
      const markup = render({ d: CURVE_D, kind: "curve", animate: false, unit: 0.5 });
      expect(markup).toContain('stroke-dasharray="2 2"');
    });

    /**
     * mask 기본 영역은 대상의 bounding box 기준이라, 거의 직선인 구간에서는 상자가 얇아
     * 굵은 mask 획이 잘린다. 좌표계 전체를 덮는지 확인한다 (리뷰 필수 2번).
     */
    it("mask 영역이 좌표계 전체를 덮는다 — 시작·끝에서 획이 잘리지 않는다", () => {
      const markup = render({ d: CURVE_D, kind: "curve", animate: true });
      expect(markup).toContain('maskUnits="userSpaceOnUse"');
      expect(markup).toMatch(/<mask[^>]*x="-20"/);
      expect(markup).toMatch(/<mask[^>]*y="-20"/);
      expect(markup).toMatch(/<mask[^>]*width="440"/);
      expect(markup).toMatch(/<mask[^>]*height="510"/);
    });

    it("mask 획은 보이는 선보다 굵다 — 가장자리가 깎이지 않는다", () => {
      const markup = render({ d: CURVE_D, kind: "curve", animate: true, unit: 1 });
      expect(markup).toContain('stroke-width="6"'); // mask
      expect(markup).toContain('stroke-width="3"'); // 보이는 선
    });
  });

  it("mask id가 다르면 서로 다른 mask를 가리킨다 — 한 화면의 지도 둘이 섞이지 않는다", () => {
    const first = render({ d: CURVE_D, kind: "curve", animate: true, maskId: "map-a-route-0" });
    const second = render({ d: CURVE_D, kind: "curve", animate: true, maskId: "map-b-route-0" });

    expect(first).toContain('mask="url(#map-a-route-0)"');
    expect(second).toContain('mask="url(#map-b-route-0)"');
    expect(first).not.toContain("map-b-route-0");
    expect(second).not.toContain("map-a-route-0");
  });
});
