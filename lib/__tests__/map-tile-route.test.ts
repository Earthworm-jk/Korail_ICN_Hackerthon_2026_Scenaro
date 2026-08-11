import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 배경 타일 프록시의 동작 회귀 (#118 · PR #158 리뷰 3번).
 *
 * 어댑터 URL만 검사하면 이 PR의 핵심 계약이 깨져도 CI가 통과한다. 실제로 지켜야 하는 것은
 * **무엇을 부르지 않는가**와 **무엇을 저장하지 않는가**다 — 범위 밖 좌표는 공급자를 아예
 * 부르지 않고, 캐시가 맞으면 부르지 않으며, PNG가 아닌 응답은 저장하지 않는다.
 */

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const XML = Buffer.from("<ExceptionReport>등록되지 않은 인증키입니다.</ExceptionReport>");

type Mocks = { readTile: ReturnType<typeof vi.fn>; writeTile: ReturnType<typeof vi.fn> };

async function loadRoute(options: {
  cacheEnabled?: boolean;
  keyed?: boolean;
  cached?: Buffer | null;
} = {}) {
  const { cacheEnabled = false, keyed = true, cached = null } = options;
  vi.resetModules();

  const readTile = vi.fn(async () => cached);
  const writeTile = vi.fn(async () => {});
  vi.doMock("@/lib/map-tile-cache", () => ({ readTile, writeTile }));
  vi.doMock("@/lib/map-tile-source", () => ({
    TILE_CACHE_ENABLED: cacheEnabled,
    vworldReferer: () => "http://localhost:3000/",
    activeTileSource: () => ({
      id: "test:Base:zyx",
      attribution: "테스트",
      axisOrder: "zyx" as const,
      urlOf: (z: number, x: number, y: number) =>
        keyed ? `https://example.invalid/${z}/${y}/${x}.png` : null,
    }),
  }));

  const { GET } = await import("../../app/api/map-tiles/[zoom]/[x]/[y]/route");
  return { GET, mocks: { readTile, writeTile } as Mocks };
}

const params = (zoom: string, x: string, y: string) => ({ params: Promise.resolve({ zoom, x, y }) });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

function upstream(body: Buffer, ok = true) {
  return { ok, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) };
}

describe("배경 타일 프록시", () => {
  describe("공급자를 부르지 않는 경우", () => {
    it("줌이 범위 밖이면 204이고 요청조차 하지 않는다", async () => {
      const { GET } = await loadRoute();
      const res = await GET(new Request("http://t/"), params("2", "1", "1"));
      expect(res.status).toBe(204);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("좌표가 그 줌의 격자 밖이면 204다 — 없는 타일을 묻지 않는다", async () => {
      const { GET } = await loadRoute();
      // z=10이면 격자는 0..1023
      const res = await GET(new Request("http://t/"), params("10", "1024", "5"));
      expect(res.status).toBe(204);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("숫자가 아닌 좌표는 204다", async () => {
      const { GET } = await loadRoute();
      const res = await GET(new Request("http://t/"), params("10", "abc", "5"));
      expect(res.status).toBe(204);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("키가 없으면 204다 — 배경 없이 그린다", async () => {
      const { GET } = await loadRoute({ keyed: false });
      const res = await GET(new Request("http://t/"), params("10", "5", "5"));
      expect(res.status).toBe(204);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("캐시가 맞으면 공급자를 부르지 않는다", async () => {
      const { GET, mocks } = await loadRoute({ cacheEnabled: true, cached: PNG });
      const res = await GET(new Request("http://t/"), params("10", "5", "5"));
      expect(res.status).toBe(200);
      expect(res.headers.get("X-Tile-Cache")).toBe("hit");
      expect(mocks.readTile).toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("공급자 응답 처리", () => {
    it("PNG면 그대로 돌려준다", async () => {
      fetchMock.mockResolvedValue(upstream(PNG));
      const { GET } = await loadRoute();
      const res = await GET(new Request("http://t/"), params("10", "5", "5"));
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("image/png");
    });

    /** 공급자가 오류도 HTTP 200에 XML로 준다 — 실제로 확인한 동작이다 */
    it("200이지만 PNG가 아니면 204이고 저장하지 않는다", async () => {
      fetchMock.mockResolvedValue(upstream(XML));
      const { GET, mocks } = await loadRoute({ cacheEnabled: true });
      const res = await GET(new Request("http://t/"), params("10", "5", "5"));
      expect(res.status).toBe(204);
      expect(mocks.writeTile).not.toHaveBeenCalled();
    });

    it("공급자가 실패 상태면 204다", async () => {
      fetchMock.mockResolvedValue(upstream(PNG, false));
      const { GET } = await loadRoute();
      const res = await GET(new Request("http://t/"), params("10", "5", "5"));
      expect(res.status).toBe(204);
    });

    it("네트워크 오류·타임아웃이면 204다 — 던지지 않는다", async () => {
      fetchMock.mockRejectedValue(new Error("timeout"));
      const { GET } = await loadRoute();
      const res = await GET(new Request("http://t/"), params("10", "5", "5"));
      expect(res.status).toBe(204);
    });

    it("등록 도메인을 Referer로 보낸다", async () => {
      fetchMock.mockResolvedValue(upstream(PNG));
      const { GET } = await loadRoute();
      await GET(new Request("http://t/"), params("10", "5", "5"));
      const [, init] = fetchMock.mock.calls[0];
      expect(init.headers.Referer).toBe("http://localhost:3000/");
      expect(init.cache).toBe("no-store");
    });
  });

  describe("캐시 스위치", () => {
    it("꺼져 있으면 읽지도 쓰지도 않고 no-store로 답한다", async () => {
      fetchMock.mockResolvedValue(upstream(PNG));
      const { GET, mocks } = await loadRoute({ cacheEnabled: false });
      const res = await GET(new Request("http://t/"), params("10", "5", "5"));
      expect(mocks.readTile).not.toHaveBeenCalled();
      expect(mocks.writeTile).not.toHaveBeenCalled();
      expect(res.headers.get("Cache-Control")).toBe("no-store");
    });

    it("켜져 있으면 받은 PNG를 저장한다", async () => {
      fetchMock.mockResolvedValue(upstream(PNG));
      const { GET, mocks } = await loadRoute({ cacheEnabled: true });
      await GET(new Request("http://t/"), params("10", "5", "5"));
      expect(mocks.writeTile).toHaveBeenCalled();
    });
  });
});
