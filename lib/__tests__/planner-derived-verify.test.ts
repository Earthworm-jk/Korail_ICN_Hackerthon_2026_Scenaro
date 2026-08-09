import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateItinerary } from "../engine";
import { loadRepositories } from "../repositories/json";
import {
  AXIS_BASE, AXIS_JINBU, AXIS_MANJONG,
  constraintVariants, expandedRepositories, legsSubset,
} from "../../test/planner-fixtures";

// #56 A+B 수용 기준 4: 파생 캐시(정렬 방문 키·경로 문자열·경고 수·selected_work 수)가
// 모든 상태 전이에서 원본 재계산값과 일치한다. 검증 플래그를 켜면 pruneStates가
// 전이 전건을 대조하고 불일치 시 예외를 던진다 — 이 파일은 그 경로로 전 변형을 통과시킨다.

beforeAll(() => {
  process.env.PLANNER_VERIFY_DERIVED = "1";
});

afterAll(() => {
  delete process.env.PLANNER_VERIFY_DERIVED;
});

describe("파생 캐시 무결성 (#56 A+B 수용 기준 4)", () => {
  it("실시드 3축 × 요청 변형 전건에서 파생 캐시가 원본과 일치한다", () => {
    const repos = loadRepositories();
    const axes = [
      legsSubset(repos, AXIS_BASE),
      legsSubset(repos, AXIS_JINBU),
      legsSubset(repos, AXIS_MANJONG),
    ];
    let runs = 0;
    for (const axisRepos of axes) {
      for (const { constraints } of constraintVariants(repos)) {
        const result = generateItinerary(constraints, axisRepos); // 불일치면 여기서 throw
        expect(["planned", "empty"]).toContain(result.status);
        runs += 1;
      }
    }
    expect(runs).toBe(60);
  }, 120000);

  it("30·50곳 확대 fixture에서도 파생 캐시가 원본과 일치한다", () => {
    const repos = loadRepositories();
    for (const n of [30, 50]) {
      const expanded = expandedRepositories(n);
      for (const { constraints } of constraintVariants(repos).slice(0, 6)) {
        const result = generateItinerary(constraints, expanded);
        expect(["planned", "empty"]).toContain(result.status);
      }
    }
  }, 120000);
});
