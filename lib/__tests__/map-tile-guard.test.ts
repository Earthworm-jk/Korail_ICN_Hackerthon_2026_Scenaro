import { beforeEach, describe, expect, it } from "vitest";

import { BASE_VIEWPORT } from "@/lib/map-viewport";
import { tileServesMap, tileZoomFor, tilesForView } from "@/lib/map-tiles";
import {
  RATE_LIMIT_PER_WINDOW,
  RATE_WINDOW_MS,
  callerKey,
  overRateLimit,
  resetRateLimit,
  secondsUntilReset,
} from "@/lib/map-tile-rate-limit";

/**
 * 공개 프록시 보호 (PR #164 리뷰).
 *
 * 여기서 지키는 것은 두 가지다 - **화면이 갈 수 없는 자리는 묻지 않는다**(훑을 넓이를 줄인다)와
 * **같은 자리를 무한히 긁지 못한다**(반복을 줄인다). 둘 중 하나만 있으면 다른 쪽 구멍이 남는다.
 *
 * 동시에 **정상 사용이 걸리면 안 된다.** 걸리면 배경이 빠지고 원인은 화면에 안 보인다.
 */

const request = (ip?: string) =>
  new Request("http://t/", { headers: ip === undefined ? {} : { "x-forwarded-for": ip } });

describe("좌표 범위 제한", () => {
  it("화면이 실제로 부르는 타일은 전부 통과한다 — 정상 사용을 막지 않는다", () => {
    // 기본 창부터 최대 배율까지, 창을 옮겨 가며 실제로 요청될 타일만 모은다
    for (const scale of [1, 2, 5, 20, 100, 200]) {
      const width = BASE_VIEWPORT.width / scale;
      const height = BASE_VIEWPORT.height / scale;
      for (const [fx, fy] of [[0, 0], [0.5, 0.5], [1, 1]]) {
        const view = {
          x: BASE_VIEWPORT.x + (BASE_VIEWPORT.width - width) * fx,
          y: BASE_VIEWPORT.y + (BASE_VIEWPORT.height - height) * fy,
          width,
          height,
        };
        const zoom = tileZoomFor(view, 720);
        for (const tile of tilesForView(view, zoom)) {
          expect(tileServesMap(zoom, tile.x, tile.y), `z${zoom}/${tile.x}/${tile.y}`).toBe(true);
        }
      }
    }
  });

  it("지구 반대편은 막는다", () => {
    // z7 격자(0..127)에서 남아메리카·아프리카 쪽
    expect(tileServesMap(7, 40, 70)).toBe(false);
    expect(tileServesMap(7, 64, 64)).toBe(false);
    expect(tileServesMap(7, 0, 0)).toBe(false);
  });

  it("이웃 나라도 막는다 — 우리 지도가 보여주지 않는 자리다", () => {
    const inKorea = tilesForView(BASE_VIEWPORT, 7).map((t) => `${t.x}/${t.y}`);
    // 한반도 격자에서 동쪽·서쪽으로 충분히 떨어뜨린다
    expect(inKorea.length).toBeGreaterThan(0);
    expect(tileServesMap(7, 120, 49)).toBe(false);
    expect(tileServesMap(7, 95, 49)).toBe(false);
  });

  it("줌이 올라가도 판정이 뒤집히지 않는다", () => {
    // 서울 타일은 어느 줌에서든 통과, 같은 방향 먼 좌표는 어느 줌에서든 차단
    expect(tileServesMap(12, 3501, 1593)).toBe(true);
    expect(tileServesMap(12, 4000, 1593)).toBe(false);
    expect(tileServesMap(15, 28011, 12748)).toBe(true);
    expect(tileServesMap(15, 32000, 12748)).toBe(false);
  });
});

describe("요청 상한", () => {
  beforeEach(() => resetRateLimit());

  it("한 화면 몇 번 정도로는 걸리지 않는다", () => {
    const req = request("1.1.1.1");
    for (let i = 0; i < 100; i += 1) expect(overRateLimit(req, 1_000)).toBe(false);
  });

  it("상한을 넘으면 막는다", () => {
    const req = request("1.1.1.1");
    for (let i = 0; i < RATE_LIMIT_PER_WINDOW; i += 1) expect(overRateLimit(req, 1_000)).toBe(false);
    expect(overRateLimit(req, 1_000)).toBe(true);
  });

  /** 한 명이 긁어도 다른 사람의 몫은 남는다 — 시연장에서 서로를 막지 않는다 */
  it("호출자별로 센다", () => {
    const heavy = request("1.1.1.1");
    for (let i = 0; i <= RATE_LIMIT_PER_WINDOW; i += 1) overRateLimit(heavy, 1_000);
    expect(overRateLimit(heavy, 1_000)).toBe(true);
    expect(overRateLimit(request("2.2.2.2"), 1_000)).toBe(false);
  });

  it("구간이 지나면 다시 열린다", () => {
    const req = request("1.1.1.1");
    for (let i = 0; i <= RATE_LIMIT_PER_WINDOW; i += 1) overRateLimit(req, 1_000);
    expect(overRateLimit(req, 1_000)).toBe(true);
    expect(overRateLimit(req, 1_000 + RATE_WINDOW_MS)).toBe(false);
  });

  /** 막힌 요청까지 세면 계속 두드리는 상대의 구간이 갱신돼 정상 사용자가 돌아올 자리가 없어진다 */
  it("막힌 요청은 구간을 연장하지 않는다", () => {
    const req = request("1.1.1.1");
    for (let i = 0; i <= RATE_LIMIT_PER_WINDOW; i += 1) overRateLimit(req, 1_000);
    overRateLimit(req, 30_000); // 계속 두드린다
    expect(overRateLimit(req, 1_000 + RATE_WINDOW_MS)).toBe(false);
  });

  it("전달 헤더의 첫 주소를 호출자로 본다", () => {
    expect(callerKey(request("3.3.3.3, 10.0.0.1"))).toBe("3.3.3.3");
  });

  /** 값이 없다고 무제한이면 헤더를 지우는 것이 곧 우회다 */
  it("전달 헤더가 없어도 한 덩어리로 센다", () => {
    const req = request();
    expect(callerKey(req)).toBe("unknown");
    for (let i = 0; i <= RATE_LIMIT_PER_WINDOW; i += 1) overRateLimit(req, 1_000);
    expect(overRateLimit(req, 1_000)).toBe(true);
  });

  it("남은 구간을 초로 알려준다 — Retry-After에 넣는다", () => {
    const req = request("1.1.1.1");
    overRateLimit(req, 1_000);
    expect(secondsUntilReset(req, 1_000)).toBe(RATE_WINDOW_MS / 1000);
    expect(secondsUntilReset(req, 1_000 + 30_000)).toBe(30);
  });
});
