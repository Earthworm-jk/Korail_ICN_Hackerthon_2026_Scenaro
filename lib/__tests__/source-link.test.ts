import { describe, expect, it } from "vitest";
import { splitSourceLink } from "../source-link";
import { loadRepositories } from "../repositories/json";

describe("출처 링크 분리", () => {
  it("URL을 떼고 설명만 남긴다", () => {
    const { label, url } = splitSourceLink(
      "한국관광공사 VISITKOREA 영진해변 24시간 개방 https://english.visitkorea.or.kr/svc/x?a=1",
    );
    expect(label).toBe("한국관광공사 VISITKOREA 영진해변 24시간 개방");
    expect(url).toBe("https://english.visitkorea.or.kr/svc/x?a=1");
  });

  it("URL이 없으면 원문 그대로 두고 링크는 없다", () => {
    const { label, url } = splitSourceLink("삼양라운드힐 공식 이용안내");
    expect(label).toBe("삼양라운드힐 공식 이용안내");
    expect(url).toBeNull();
  });

  it("문장 끝 문장부호를 URL에 붙이지 않는다", () => {
    expect(splitSourceLink("안내 https://a.kr/b.").url).toBe("https://a.kr/b");
  });

  it("시드의 모든 출처에서 URL이 화면 문구에 남지 않는다", () => {
    for (const place of loadRepositories().places) {
      const oh = place.openingHours;
      if (oh.type === "unverified") continue;
      const { label } = splitSourceLink(oh.source);
      expect(label, place.id).not.toMatch(/https?:\/\//);
    }
  });
});
