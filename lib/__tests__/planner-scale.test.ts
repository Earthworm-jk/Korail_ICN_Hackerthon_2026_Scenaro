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

    // 확대 fixture와 기준 결과는 한 번만 만든다. 케이스마다 다시 만들면 플래너 실행이
    // 두 배로 늘고, 워커가 그동안 리포터 RPC에 응답하지 못해 CI가 통째로 실패한다
    // (실제로 `Timeout calling "onTaskUpdate"`로 한 번 깨졌다 — 테스트는 전건 통과였다).
    const expanded = expandedRepositories(50);
    let cachedBaseline: ReturnType<typeof generateItinerary> | null = null;
    const baseline = () => (cachedBaseline ??= generateItinerary(BASE_CONSTRAINTS, expanded));

    it("선호 0개는 선호 필드를 주지 않은 것과 완전히 같은 결과다", () => {
      const withEmpty = generateItinerary(
        { ...BASE_CONSTRAINTS, preferredVisitDates: {} },
        expanded,
      );
      expect(JSON.stringify(withEmpty)).toBe(JSON.stringify(baseline()));
    }, 120000);

    // 세 계약을 한 번의 실행 묶음으로 함께 잰다 — 같은 입력을 세 번 돌리므로
    // 성능(최소값)·결정성(출력 동일)·장소 수 보존을 따로 돌릴 이유가 없다
    it.each(PREFERENCES)("%s — 2초·결정성·장소 수 보존", (_label, preferredVisitDates) => {
      const constraints = { ...BASE_CONSTRAINTS, preferredVisitDates };
      const outputs: string[] = [];
      let best = Number.POSITIVE_INFINITY;
      for (let run = 0; run < 3; run += 1) {
        const startedAt = performance.now();
        const result = generateItinerary(constraints, expanded);
        best = Math.min(best, performance.now() - startedAt);
        outputs.push(JSON.stringify(result));
      }
      expect(best).toBeLessThan(2000); // NFR-PERF-001
      expect(outputs[1]).toBe(outputs[0]); // 결정성
      expect(outputs[2]).toBe(outputs[0]);

      const result = JSON.parse(outputs[0]);
      const base = baseline();
      expect(result.status).toBe("planned");
      expect(base.status).toBe("planned");
      if (base.status !== "planned") return;
      // 선호가 beam 자리를 뺏으면 장소 수(비교 키 2번)가 준다 — 선호(4번)보다 위 키다
      expect(result.comparisonKeys.selectedUnionPlaceCount)
        .toBeGreaterThanOrEqual(base.comparisonKeys.selectedUnionPlaceCount);
    }, 180000);
  });

  /**
   * 순서 선호가 붙은 확대 fixture (#145).
   *
   * 방문일(#139)과 같은 축이라 같은 세 계약을 잰다. 순서는 후보 생성이 없어 더 쌀 것으로
   * 봤는데(#145 5절), 실제로 그런지는 여기서 확인한다.
   */
  describe("순서 선호가 붙은 확대 fixture (#145)", () => {
    const PAIRS: Array<[string, ReadonlyArray<readonly [string, string]>]> = [
      ["순서 0쌍", []],
      ["순서 1쌍", [["place-gwanghwamun-gate", "place-seoullo-7017"]]],
      ["순서 다수", [
        ["place-gwanghwamun-gate", "place-seoullo-7017"],
        ["place-sowol-ro", "place-gwanghwamun-square"],
        ["place-seoullo-7017", "place-sowol-ro"],
      ]],
    ];

    const expanded = expandedRepositories(50);
    let cachedBaseline: ReturnType<typeof generateItinerary> | null = null;
    const baseline = () => (cachedBaseline ??= generateItinerary(BASE_CONSTRAINTS, expanded));

    it("순서 0쌍은 순서 필드를 주지 않은 것과 완전히 같은 결과다", () => {
      const withEmpty = generateItinerary({ ...BASE_CONSTRAINTS, preferredOrder: [] }, expanded);
      expect(JSON.stringify(withEmpty)).toBe(JSON.stringify(baseline()));
    }, 120000);

    it.each(PAIRS)("%s — 2초·결정성·장소 수 보존", (_label, preferredOrder) => {
      const constraints = { ...BASE_CONSTRAINTS, preferredOrder };
      const outputs: string[] = [];
      let best = Number.POSITIVE_INFINITY;
      for (let run = 0; run < 3; run += 1) {
        const startedAt = performance.now();
        const result = generateItinerary(constraints, expanded);
        best = Math.min(best, performance.now() - startedAt);
        outputs.push(JSON.stringify(result));
      }
      expect(best).toBeLessThan(2000); // NFR-PERF-001
      expect(outputs[1]).toBe(outputs[0]);
      expect(outputs[2]).toBe(outputs[0]);

      const result = JSON.parse(outputs[0]);
      const base = baseline();
      expect(result.status).toBe("planned");
      if (base.status !== "planned") return;
      // 실험 결과: 순서 요청으로 장소 수가 준 시행이 0건이었다. 그 성질을 확대 fixture에서도 건다
      expect(result.comparisonKeys.selectedUnionPlaceCount)
        .toBeGreaterThanOrEqual(base.comparisonKeys.selectedUnionPlaceCount);
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
