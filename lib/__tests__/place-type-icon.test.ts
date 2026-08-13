import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlaceTypeIcon } from "../../app/place-type-icon";
import { PlaceType } from "../types/schema";

describe("오픈소스 장소 유형 아이콘", () => {
  it("모든 장소 유형을 장식용 SVG로 렌더링한다", () => {
    for (const placeType of PlaceType.options) {
      const markup = renderToStaticMarkup(createElement(PlaceTypeIcon, { placeType }));
      expect(markup, placeType).toContain("<svg");
      expect(markup, placeType).toContain('aria-hidden="true"');
      expect(markup, placeType).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  it("미분류 장소도 빈칸 대신 기본 SVG를 렌더링한다", () => {
    const markup = renderToStaticMarkup(createElement(PlaceTypeIcon, {
      placeType: undefined,
    }));

    expect(markup).toContain("<svg");
    expect(markup).toContain('aria-hidden="true"');
  });

  it("일정 배지 안에서 아이콘을 밀어내는 바깥 여백을 두지 않는다", () => {
    const markup = renderToStaticMarkup(createElement(PlaceTypeIcon, {
      placeType: "heritage",
    }));

    expect(markup).toContain("size-5");
    expect(markup).not.toContain("mb-3");
  });
});
