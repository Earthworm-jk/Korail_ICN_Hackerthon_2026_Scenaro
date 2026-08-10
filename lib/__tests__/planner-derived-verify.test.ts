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

  // #139: 선호 일치 수도 파생 캐시에 들어갔다. 증분값과 원본 재계산이 갈라지면
  // beam이 잘못된 상태를 남기고 선호 계약이 조용히 깨진다 — 같은 플래그로 함께 잠근다.
  it("방문일 선호가 붙어도 파생 캐시가 원본과 일치한다 (#139)", () => {
    const repos = loadRepositories();
    const preferences: Array<Record<string, string>> = [
      { "place-gwanghwamun-gate": "2026-08-14" },
      { "place-seoullo-7017": "2026-08-13", "place-sowol-ro": "2026-08-14" },
    ];
    for (const preferredVisitDates of preferences) {
      for (const { constraints } of constraintVariants(repos).slice(0, 6)) {
        // 변형에 따라 선호 장소가 후보에서 빠지거나 기간 밖이면 엔진이 거부한다 — 그건 계약이다
        let result;
        try {
          result = generateItinerary({ ...constraints, preferredVisitDates }, repos);
        } catch (error) {
          expect(error).toBeInstanceOf(RangeError);
          continue;
        }
        expect(["planned", "empty"]).toContain(result.status);
      }
    }
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
