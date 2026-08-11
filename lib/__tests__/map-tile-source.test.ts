import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * 배경 타일 공급자 어댑터 (#118 지도 배경).
 *
 * 좌표 계산은 표준 `z/x/y`로만 말하고, URL에 넣는 순서는 이 어댑터가 정한다. VWorld WMTS가
 * `z/y/x`인지 `z/x/y`인지는 키가 살아난 뒤 타일 한 장으로 판별하므로, **순서를 바꿔도
 * 좌표 계약이 흔들리지 않는다**는 것을 여기서 고정한다.
 */

async function load(
  key: string | undefined,
  referer?: string,
  stadiaKey?: string,
  stadiaReferer?: string,
) {
  vi.resetModules();
  vi.doMock("../env", () => ({
    env: {
      VWORLD_API_KEY: key,
      VWORLD_REFERER: referer,
      STADIA_API_KEY: stadiaKey,
      STADIA_REFERER: stadiaReferer,
    },
  }));
  return await import("../map-tile-source");
}

afterEach(() => {
  vi.doUnmock("../env");
  vi.resetModules();
});

describe("배경 타일 공급자", () => {
  it("키가 없으면 URL이 null이다 — 배경 없이 그린다", async () => {
    const { vworldSource } = await load(undefined);
    expect(vworldSource("zyx").urlOf(12, 3492, 1592)).toBeNull();
  });

  it("zyx는 행이 열보다 앞이다 — OGC WMTS 표준 순서", async () => {
    const { vworldSource } = await load("TESTKEY");
    const url = vworldSource("zyx").urlOf(12, 3492, 1592);
    expect(url).toContain("/12/1592/3492.png");
  });

  it("zxy는 열이 행보다 앞이다 — 흔한 슬리피 타일 순서", async () => {
    const { vworldSource } = await load("TESTKEY");
    const url = vworldSource("zxy").urlOf(12, 3492, 1592);
    expect(url).toContain("/12/3492/1592.png");
  });

  it("순서만 다르고 나머지 URL은 같다 — 판별되면 이 값 하나만 바꾼다", async () => {
    const { vworldSource } = await load("TESTKEY");
    const zyx = vworldSource("zyx").urlOf(9, 5, 7) ?? "";
    const zxy = vworldSource("zxy").urlOf(9, 5, 7) ?? "";
    expect(zyx.replace("/9/7/5.png", "")).toBe(zxy.replace("/9/5/7.png", ""));
  });

  it("키를 URL 인코딩해 넣는다 — 특수문자가 경로를 깨지 않게", async () => {
    const { vworldSource } = await load("a b/c");
    const url = vworldSource("zyx").urlOf(9, 5, 7) ?? "";
    expect(url).toContain(encodeURIComponent("a b/c"));
    expect(url).not.toContain("a b/c");
  });

  /**
   * PR #158 리뷰 1번 — id가 고정이면 순서를 바꿔도 캐시가 안 갈려서 옛 타일이 그대로 맞는다.
   * 배경이 어긋난 채 굳고, 원인은 화면에 안 보인다.
   */
  describe("캐시 분리", () => {
    it("축 순서가 다르면 id가 다르다", async () => {
      const { vworldSource } = await load("TESTKEY");
      expect(vworldSource("zyx").id).not.toBe(vworldSource("zxy").id);
    });

    it("id에 레이어와 축 순서가 함께 들어간다", async () => {
      const { vworldSource } = await load("TESTKEY");
      expect(vworldSource("zyx").id).toContain("zyx");
      expect(vworldSource("zyx").id).toContain("Base");
    });

    it("같은 설정이면 id가 같다 — 쓸데없이 캐시를 버리지 않는다", async () => {
      const { vworldSource } = await load("TESTKEY");
      expect(vworldSource("zyx").id).toBe(vworldSource("zyx").id);
    });
  });

  describe("등록 도메인 Referer", () => {
    it("환경변수가 없으면 개발 기본값이다", async () => {
      const mod = await load("TESTKEY");
      expect(mod.vworldReferer()).toBe(mod.DEV_VWORLD_REFERER);
    });

    it("환경변수가 있으면 그 값을 쓴다 — 배포 도메인", async () => {
      const { vworldReferer } = await load("TESTKEY", "https://scenaro.example/");
      expect(vworldReferer()).toBe("https://scenaro.example/");
    });
  });

  /**
   * Stadia로 갈아탄 것이 #162 결론이다. VWorld 어댑터는 남기되 **활성 공급자는 Stadia**이고,
   * 두 어댑터가 좌표 계약을 공유한다는 것을 여기서 고정한다.
   */
  describe("Stadia (활성 공급자)", () => {
    it("활성 공급자가 Stadia다", async () => {
      const { activeTileSource } = await load(undefined);
      expect(activeTileSource().id).toContain("stadia");
      expect(activeTileSource().id).toContain("alidade_smooth");
    });

    it("키가 없어도 URL이 있다 — localhost 뒷문으로 통한다(로컬 개발)", async () => {
      const { stadiaSource } = await load(undefined);
      expect(stadiaSource("zxy").urlOf(7, 109, 49)).toContain("/alidade_smooth/7/109/49.png");
    });

    /**
     * PR #164 리뷰 2번 — 브라우저가 아니라 우리 프록시가 부르므로 Stadia 기준 서버 앱이고,
     * 서버 앱의 인증은 도메인 검사가 아니라 API 키다. 쿼리스트링은 서버 로그·중간 캐시에
     * 그대로 남으므로 헤더로 보낸다.
     */
    it("키는 URL이 아니라 Authorization 헤더로 간다", async () => {
      const { stadiaSource } = await load(undefined, undefined, "SECRET");
      const source = stadiaSource("zxy");
      expect(source.headers.Authorization).toBe("Stadia-Auth SECRET");
      expect(source.urlOf(7, 109, 49)).not.toContain("SECRET");
      expect(source.urlOf(7, 109, 49)).not.toContain("api_key");
    });

    it("키가 있으면 Referer를 보내지 않는다 — 배포가 localhost인 척할 자리를 없앤다", async () => {
      const { stadiaSource } = await load(undefined, undefined, "SECRET", "http://localhost:3000/");
      expect(stadiaSource("zxy").headers.Referer).toBeUndefined();
    });

    it("키가 없으면 Referer 뒷문만 쓴다 — 인증 둘을 같이 보내지 않는다", async () => {
      const { stadiaSource } = await load(undefined);
      const source = stadiaSource("zxy");
      expect(source.headers.Authorization).toBeUndefined();
      expect(source.headers.Referer).toBeDefined();
    });

    it("슬리피 순서 zxy가 기본이다 — VWorld의 zyx와 반대다", async () => {
      const { stadiaSource, vworldSource } = await load("TESTKEY");
      expect(stadiaSource().urlOf(7, 109, 49)).toContain("/7/109/49.png");
      expect(vworldSource().urlOf(7, 109, 49)).toContain("/7/49/109.png");
    });

    it("축 순서가 다르면 id가 다르다 — 캐시가 갈린다", async () => {
      const { stadiaSource } = await load(undefined);
      expect(stadiaSource("zxy").id).not.toBe(stadiaSource("zyx").id);
    });

    it("공급자가 다르면 id가 다르다 — 갈아타도 옛 타일을 맞히지 않는다", async () => {
      const { stadiaSource, vworldSource } = await load("TESTKEY");
      expect(stadiaSource("zxy").id).not.toBe(vworldSource("zxy").id);
    });

    it("출처 표기를 들고 다닌다 — 화면에 반드시 붙여야 하는 이용 조건이다", async () => {
      const { activeTileSource } = await load(undefined);
      const attribution = activeTileSource().attribution;
      for (const required of ["Stadia Maps", "OpenMapTiles", "OpenStreetMap"]) {
        expect(attribution).toContain(required);
      }
    });

    describe("인증 헤더는 어댑터가 들고 다닌다", () => {
      it("키 없는 로컬은 개발 기본 Referer다", async () => {
        const mod = await load(undefined);
        expect(mod.activeTileSource().headers.Referer).toBe(mod.DEV_STADIA_REFERER);
      });

      it("VWorld는 여전히 Referer 검사다 — 공급자마다 방식이 다르다", async () => {
        const { stadiaSource, vworldSource } = await load("K", "https://vworld.example/", "SECRET");
        expect(vworldSource().headers.Referer).toBe("https://vworld.example/");
        expect(stadiaSource().headers.Authorization).toBe("Stadia-Auth SECRET");
      });
    });
  });

  it("VWorld 출처 표기도 그대로 남아 있다", async () => {
    const { vworldSource } = await load("TESTKEY");
    expect(vworldSource().attribution).toBe("공간정보 오픈플랫폼(VWorld)");
  });
});
