import { describe, expect, it } from "vitest";
import { routeSaveIntent, routeTripsIntent, type StorageMode } from "../save-routing";

/**
 * 저장 경로 판단 (PR #123 리뷰 3)
 *
 * 리뷰가 지적한 경쟁 상태를 여기서 고정한다 — `?cloud=1`로 계정 상태를 조회하는 동안
 * 저장을 누르면, 확인이 끝나기 전에는 **어느 쪽으로도 보내지 않는다.**
 */
describe("계정 상태 확인 중에는 저장 위치를 정하지 않는다", () => {
  it("loading이면 인증 여부와 무관하게 큐에 담는다 — 로컬로 새지 않는다", () => {
    for (const authenticated of [true, false]) {
      expect(routeSaveIntent("loading", authenticated)).toBe("queue");
      expect(routeTripsIntent("loading", authenticated)).toBe("queue");
    }
  });

  it("loading은 local과 다른 상태다 — 같은 값으로 뭉치면 경쟁이 되돌아온다", () => {
    expect(routeSaveIntent("loading", false)).not.toBe(routeSaveIntent("local", false));
  });
});

describe("mode가 확정된 뒤", () => {
  it("로컬 모드는 인증 없이 바로 저장한다 — 대표 데모에 로그인 UI가 없다", () => {
    expect(routeSaveIntent("local", false)).toBe("local");
    expect(routeTripsIntent("local", false)).toBe("local");
  });

  it("클라우드 모드는 인증돼 있으면 계정에 저장한다", () => {
    expect(routeSaveIntent("supabase", true)).toBe("cloud");
    expect(routeTripsIntent("supabase", true)).toBe("cloud");
  });

  it("클라우드 모드인데 인증이 없으면 lazy login이다", () => {
    expect(routeSaveIntent("supabase", false)).toBe("login");
    expect(routeTripsIntent("supabase", false)).toBe("login");
  });

  it("어떤 조합에서도 판단이 비지 않는다", () => {
    const modes: StorageMode[] = ["loading", "local", "supabase"];
    for (const mode of modes) {
      for (const authenticated of [true, false]) {
        expect(["queue", "local", "cloud", "login"]).toContain(routeSaveIntent(mode, authenticated));
      }
    }
  });
});
