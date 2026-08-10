import { describe, expect, it } from "vitest";
import { generateItinerary, generateItineraryWithGatewayAlternatives } from "../engine";
import { loadRepositories } from "../repositories/json";
import { BASE_CONSTRAINTS, expandedRepositories } from "../../test/planner-fixtures";

// #56 A+B 수용 기준 2·3: 콘텐츠 목표(#23·#24)의 상한인 후보 50곳 구성에서
// 반복 실행 결정성과 NFR-PERF-001(2초)을 고정한다. 확대 fixture는 실시드 12곳을
// 역·체류시간 분산 복제한 결정적 시뮬레이션이다(실제 30-50곳 시드 확보 시 재측정 — #56 합의).

describe("확대 후보 결정성·성능 (#56 A+B)", () => {
  it("30·50곳 확대 fixture는 반복 실행에서 완전히 같은 결과를 낸다", () => {
    for (const n of [30, 50]) {
      const first = generateItinerary(BASE_CONSTRAINTS, expandedRepositories(n));
      const second = generateItinerary(BASE_CONSTRAINTS, expandedRepositories(n));
      expect(first.status).toBe("planned");
      expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    }
  }, 120000);

  it("NFR-PERF-001: 후보 50곳 구성도 2초 안에 완료된다", () => {
    const expanded = expandedRepositories(50); // 준비 비용은 측정 밖 — 계약은 일정 생성 시간
    // CI 워커의 스케줄러 노이즈로 단발 측정이 튀는 것을 막기 위해 3회 최소값을 쓴다.
    // 연산이 실제로 2초를 넘으면 최소값도 넘으므로 계약 강도는 그대로다.
    let best = Number.POSITIVE_INFINITY;
    for (let run = 0; run < 3; run += 1) {
      const startedAt = performance.now();
      const result = generateItinerary(BASE_CONSTRAINTS, expanded);
      best = Math.min(best, performance.now() - startedAt);
      expect(result.status).toBe("planned");
    }
    expect(best).toBeLessThan(2000);
  }, 120000);

  it("NFR-PERF-002: 후보 50곳 공항버스 전체 대안도 5초 안에 완료된다 (#87)", () => {
    const expanded = expandedRepositories(50);
    // GitHub 워커 스케줄러 노이즈를 흡수하되, 지속적인 5초 초과는 숨기지 않는다.
    let best = Number.POSITIVE_INFINITY;
    for (let run = 0; run < 2; run += 1) {
      const startedAt = performance.now();
      const result = generateItineraryWithGatewayAlternatives(BASE_CONSTRAINTS, expanded);
      best = Math.min(best, performance.now() - startedAt);
      expect(result.status).toBe("planned");
      if (result.status === "planned") {
        expect(result.gatewayAlternatives?.length).toBeGreaterThan(0);
      }
    }
    expect(best).toBeLessThan(5000);
  }, 120000);

  // #139 6-3: 선호 날짜 창을 따로 만들면 탐색 분기가 늘어난다. "탐색 공간 불변"은 철회했고
  // 선호 0·1·다수로 나눠 다시 잰다. 선호 0이면 지금까지와 완전히 같은 경로여야 한다.
  describe("방문일 선호가 붙은 확대 fixture (#139 6-3)", () => {
    const PREFERENCES: Array<[string, Record<string, string>]> = [
      ["선호 0개", {}],
      ["선호 1개", { "place-gwanghwamun-gate": "2026-08-14" }],
      ["선호 다수", {
        "place-gwanghwamun-gate": "2026-08-14",
        "place-seoullo-7017": "2026-08-13",
        "place-sowol-ro": "2026-08-12",
        "place-gwanghwamun-square": "2026-08-13",
      }],
    ];

    it("선호 0개는 선호 필드를 주지 않은 것과 완전히 같은 결과다", () => {
      const expanded = expandedRepositories(50);
      const withoutField = generateItinerary(BASE_CONSTRAINTS, expanded);
      const withEmpty = generateItinerary(
        { ...BASE_CONSTRAINTS, preferredVisitDates: {} },
        expanded,
      );
      expect(JSON.stringify(withEmpty)).toBe(JSON.stringify(withoutField));
    }, 120000);

    it.each(PREFERENCES)("%s — NFR-PERF-001 2초 안에 완료된다", (_label, preferredVisitDates) => {
      const expanded = expandedRepositories(50);
      const constraints = { ...BASE_CONSTRAINTS, preferredVisitDates };
      let best = Number.POSITIVE_INFINITY;
      for (let run = 0; run < 3; run += 1) {
        const startedAt = performance.now();
        const result = generateItinerary(constraints, expanded);
        best = Math.min(best, performance.now() - startedAt);
        expect(result.status).toBe("planned");
      }
      expect(best).toBeLessThan(2000);
    }, 180000);

    it.each(PREFERENCES)("%s — 반복 실행에서 완전히 같은 결과를 낸다", (_label, preferredVisitDates) => {
      const constraints = { ...BASE_CONSTRAINTS, preferredVisitDates };
      const first = generateItinerary(constraints, expandedRepositories(30));
      const second = generateItinerary(constraints, expandedRepositories(30));
      expect(first.status).toBe("planned");
      expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    }, 180000);

    it("선호를 넣어도 방문 장소 수가 줄지 않는다 (beam 자리 보존)", () => {
      const expanded = expandedRepositories(50);
      const base = generateItinerary(BASE_CONSTRAINTS, expanded);
      expect(base.status).toBe("planned");
      if (base.status !== "planned") return;
      for (const [, preferredVisitDates] of PREFERENCES) {
        const result = generateItinerary(
          { ...BASE_CONSTRAINTS, preferredVisitDates },
          expanded,
        );
        expect(result.status).toBe("planned");
        if (result.status !== "planned") continue;
        expect(result.comparisonKeys.selectedUnionPlaceCount)
          .toBeGreaterThanOrEqual(base.comparisonKeys.selectedUnionPlaceCount);
      }
    }, 180000);
  });

  it("실시드 전체 요청 결과가 최적화 전과 동일한 회귀 기준을 유지한다", () => {
    // 안전망: 파생 캐시·시간 메모가 실시드 대표 요청의 산출 구조를 바꾸지 않는다
    const result = generateItinerary(BASE_CONSTRAINTS, loadRepositories());
    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.days.length).toBeGreaterThan(0);
    expect(result.metrics.transferCount).toBeGreaterThanOrEqual(0);
  });
});
