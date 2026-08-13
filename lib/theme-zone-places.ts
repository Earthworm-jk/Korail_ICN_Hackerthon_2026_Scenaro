/**
 * 테마체험 권역을 장소처럼 다루기 위한 변환 (#80 후속).
 *
 * 권역은 촬영지가 아니다. 그래서 `places.json`에도, `work-place-relations.json`에도 넣지
 * 않는다 — 관계 파일에 넣으면 "촬영 관계"라는 뜻이 붙어 버리고, 작품↔권역 연결은
 * 촬영이 아니라 테마 유사도다. 연결은 지금처럼 랭킹 스냅샷에만 남는다.
 *
 * 대신 **엔진 앞에서만** Place 모양으로 바꿔 넣는다. 엔진은 Place만 알기 때문에,
 * 이 변환 하나로 권역이 후보 목록에 서고 일정에 자리를 잡는다. 유형(`theme_zone`)이
 * 남아 있어 화면은 촬영지와 구분해 그릴 수 있다.
 *
 * 일정 편입에 필요한 값(역·접근·운영·체류)이 다 있는 권역만 바꾼다. 하나라도 없으면
 * 지도 추천으로만 남는다 — 없는 값을 지어내지 않는다.
 */
import type { PlaceT } from "./types/schema";
import type { ThemeZoneT } from "./theme-zones";
import type { Repositories } from "./repositories/json";
import { loadThemeZoneRankings, loadThemeZones } from "./theme-zones-snapshot";

/** 이 권역이 일정에 들어갈 수 있는가 — 네 값이 모두 있어야 한다 */
export function isSchedulableZone(zone: ThemeZoneT): boolean {
  return zone.nearestStationId !== undefined
    && zone.accessEstimate !== undefined
    && zone.openingHours !== undefined
    && zone.stayMinutes !== undefined;
}

/**
 * 권역 하나를 Place로. `workIds`는 비운다 — 촬영 관계가 없다는 사실을 그대로 둔다.
 * 후보 산출은 이 배열이 아니라 랭킹 스냅샷을 본다.
 */
export function themeZoneAsPlace(zone: ThemeZoneT): PlaceT | null {
  if (!isSchedulableZone(zone)) return null;
  return {
    id: zone.id,
    name: zone.name,
    workIds: [],
    nearestStationId: zone.nearestStationId!,
    accessEstimate: zone.accessEstimate!,
    openingHours: zone.openingHours!,
    stayMinutes: zone.stayMinutes!,
    ...(zone.stayMetadata ? { stayMetadata: zone.stayMetadata } : {}),
    placeType: "theme_zone",
    // 권역 사실은 공식 관광정보 출처로 확인했다 — 촬영 관계 검증과는 다른 축이다
    verificationLevel: "원본확인",
    officialSourceCount: zone.sourceUrls.length,
    reasonText: zone.theme,
    ...(zone.latitude !== undefined && zone.longitude !== undefined
      ? { latitude: zone.latitude, longitude: zone.longitude }
      : {}),
  };
}

/**
 * 고른 작품에 연결된, 일정에 들어갈 수 있는 권역을 Place로 준다.
 *
 * 연결 판정은 지도 추천(`pickThemeExperience`)과 **같은 규칙**이다 — 검토를 마치고
 * 배지 기준을 넘은 행만 본다. 여기서 규칙을 새로 만들면 목록과 지도가 서로 다른
 * 권역을 말하게 된다.
 */
export function schedulableThemeZones(selectedWorkIds: readonly string[]): PlaceT[] {
  if (selectedWorkIds.length === 0) return [];
  const zones = loadThemeZones();
  if (!zones) return [];
  const snapshot = loadThemeZoneRankings(zones);
  if (!snapshot) return [];
  const workIds = new Set(selectedWorkIds);
  const linked = new Set(
    snapshot.rankings
      .filter((ranking) => ranking.reviewed && ranking.score >= snapshot.meta.badgeThreshold)
      .filter((ranking) => workIds.has(ranking.workId))
      .map((ranking) => ranking.zoneId),
  );
  return zones
    .filter((zone) => linked.has(zone.id))
    .map(themeZoneAsPlace)
    .filter((place): place is PlaceT => place !== null);
}

/** 엔진에 넘길 저장소에 권역을 장소로 얹는다. 원본 저장소는 건드리지 않는다 */
export function withThemeZonePlaces(repos: Repositories, zones: ThemeZoneT[] | null): Repositories {
  if (!zones || zones.length === 0) return repos;
  const known = new Set(repos.places.map((place) => place.id));
  const added = zones
    .map(themeZoneAsPlace)
    .filter((place): place is PlaceT => place !== null && !known.has(place.id));
  if (added.length === 0) return repos;
  return { ...repos, places: [...repos.places, ...added] };
}
