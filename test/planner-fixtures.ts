import { loadRepositories, type Repositories } from "../lib/repositories/json";
import type { TripConstraints } from "../lib/engine/types";

// #56 A+B 최적화 수용 기준용 공용 fixture — 난수·현재 시각 없이 전부 결정적이다.

export const BASE_CONSTRAINTS: TripConstraints = {
  arrivalAt: "2026-08-12T10:00:00+09:00",
  departureAt: "2026-08-14T18:00:00+09:00",
  airportReadyAt: "2026-08-12T12:00:00+09:00",
  airportArrivalDeadline: "2026-08-14T16:00:00+09:00",
  selectedActorIds: ["actor-kim-go-eun"],
  selectedWorkIds: [],
  excludedPlaceIds: [],
  maxPlacesPerDay: 3,
  dailySlackMinutes: 60,
};

/** 실시드 12곳을 역·체류시간을 흩어 결정적으로 복제해 후보를 n곳으로 확대한다 (#56 프로파일링과 동일 방식) */
export function expandedRepositories(targetPlaceCount: number): Repositories {
  const repos = loadRepositories();
  const stations = ["station-gangneung", "station-jinbu", "station-manjong", "station-seoul"];
  const places = [...repos.places];
  let index = 0;
  while (places.length < targetPlaceCount) {
    const base = repos.places[index % repos.places.length];
    places.push({
      ...base,
      id: `${base.id}-x${index}`,
      nearestStationId: stations[index % stations.length],
      stayMinutes: 30 + (index % 4) * 15,
      accessEstimate: { ...base.accessEstimate, minutes: 10 + (index % 5) * 5 },
    });
    index += 1;
  }
  return { ...repos, places };
}

/** 열차 스냅샷 축소본 — 진부·만종 확장 전 단계를 재현한다 (역 id 기준 필터, 결정적) */
export function legsSubset(repos: Repositories, keepStations: Set<string>): Repositories {
  return {
    ...repos,
    trainLegs: repos.trainLegs.filter(
      (leg) => keepStations.has(leg.fromStationId) && keepStations.has(leg.toStationId),
    ),
  };
}

export const AXIS_BASE = new Set([
  "station-incheon-airport-t1", "station-seoul", "station-gangneung",
]);
export const AXIS_JINBU = new Set([...AXIS_BASE, "station-jinbu"]);
export const AXIS_MANJONG = new Set([...AXIS_JINBU, "station-manjong"]);

/** 수용 기준 1의 요청 변형 — (스냅샷 축 3종) × (조건 변형) + 확대 fixture 변형 */
export function constraintVariants(repos: Repositories): Array<{ name: string; constraints: TripConstraints }> {
  const variants: Array<{ name: string; constraints: TripConstraints }> = [
    { name: "base", constraints: { ...BASE_CONSTRAINTS } },
    { name: "max1", constraints: { ...BASE_CONSTRAINTS, maxPlacesPerDay: 1 } },
    { name: "max2", constraints: { ...BASE_CONSTRAINTS, maxPlacesPerDay: 2 } },
    { name: "slack0", constraints: { ...BASE_CONSTRAINTS, dailySlackMinutes: 0 } },
    { name: "slack120", constraints: { ...BASE_CONSTRAINTS, dailySlackMinutes: 120 } },
    {
      name: "tight-deadline",
      constraints: {
        ...BASE_CONSTRAINTS,
        departureAt: "2026-08-13T18:00:00+09:00",
        airportArrivalDeadline: "2026-08-13T16:00:00+09:00",
      },
    },
    {
      name: "evening-arrival",
      constraints: {
        ...BASE_CONSTRAINTS,
        arrivalAt: "2026-08-12T16:00:00+09:00",
        airportReadyAt: "2026-08-12T18:00:00+09:00",
      },
    },
    {
      name: "work-goblin",
      constraints: { ...BASE_CONSTRAINTS, selectedActorIds: [], selectedWorkIds: ["work-goblin"] },
    },
  ];
  for (const place of repos.places.slice(0, 12)) {
    variants.push({
      name: `exclude-${place.id}`,
      constraints: { ...BASE_CONSTRAINTS, excludedPlaceIds: [place.id] },
    });
  }
  return variants;
}
