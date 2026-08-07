import { describe, expect, it } from "vitest";
import { loadRepositories } from "../repositories/json";
import { accessBufferMinutes } from "../types/schema";

describe("시드 스키마 검증 (REQ-DATA-004)", () => {
  it("모든 시드 JSON이 Zod 스키마를 통과한다 — 불일치는 기동 단계에서 실패", () => {
    const repos = loadRepositories();
    expect(repos.actors.length).toBeGreaterThan(0);
    expect(repos.places.length).toBeGreaterThan(0);
    expect(repos.stations.length).toBeGreaterThan(0);
  });

  it("장소의 참조 무결성 — nearestStationId·workIds가 실제로 존재한다", () => {
    const repos = loadRepositories();
    const stationIds = new Set(repos.stations.map((s) => s.id));
    const workIds = new Set(repos.works.map((w) => w.id));
    for (const p of repos.places) {
      expect(stationIds.has(p.nearestStationId)).toBe(true);
      // 기동 시 데이터 불일치 즉시 실패 계약 — 모든 참조가 존재해야 한다
      expect(p.workIds.every((w) => workIds.has(w)), p.id).toBe(true);
    }
    for (const a of repos.actors) {
      expect(a.workIds.every((w) => workIds.has(w)), a.id).toBe(true);
    }
  });

  it("장소의 권역은 최근접역에서 파생 가능하다 — 역마다 regionId 존재", () => {
    const repos = loadRepositories();
    for (const s of repos.stations) {
      expect(s.regionId, s.id).toBeTruthy();
    }
  });
});

describe("접근시간 버퍼 규칙 (#5)", () => {
  it("max(20분, 접근시간의 50%)", () => {
    expect(accessBufferMinutes(10)).toBe(20);
    expect(accessBufferMinutes(40)).toBe(20);
    expect(accessBufferMinutes(60)).toBe(30);
    expect(accessBufferMinutes(90)).toBe(45);
  });
});
