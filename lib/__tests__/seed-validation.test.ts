import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadRepositories,
  parseRepositories,
  SeedValidationError,
  type RawSeedFiles,
} from "../repositories/json";

// #20 확정 기준: 의미 검증(Zod refine) + 로드 후 중복·참조 무결성 + 오류 전건 일괄 보고

type LocalName = { ko: string; en: string };
type Seed = {
  actors: { id: string; name: LocalName; workIds: string[] }[];
  works: { id: string; title: LocalName }[];
  places: {
    id: string;
    name: LocalName;
    workIds: string[];
    nearestStationId: string;
    accessEstimate: { minutes: number; source: string; verifiedAt: string };
    openingHours: Record<string, unknown>;
    stayMinutes: number;
    verificationLevel: string;
    officialSourceCount: number;
    reasonText: LocalName;
  }[];
  stations: { id: string; name: LocalName; lineType: string; regionId: string; isAirport?: boolean }[];
  trainLegs: {
    trainNo: string;
    fromStationId: string;
    toStationId: string;
    departAt: string;
    arriveAt: string;
  }[];
  gatewayLegs: {
    id: string;
    routeId: string;
    direction: string;
    mode: string;
    fromStationId: string;
    toStationId: string;
    fromName: LocalName;
    toName: LocalName;
    departAt: string;
    arriveAt: string;
    serviceName: LocalName;
    operator: LocalName;
    sourceUrls: string[];
    verifiedAt: string;
  }[];
  flights: { flightNo: string; direction: string; scheduledAt: string; terminal?: string }[];
  workPlaceRelations: {
    workId: string;
    placeId: string;
    episodeLabel?: string;
    sceneNote?: LocalName;
    sourceUrls: string[];
    verifiedAt: string;
    reviewed: boolean;
  }[];
};

function baseSeed(): Seed {
  return structuredClone({
    actors: [{ id: "actor-a", name: { ko: "배우", en: "Actor" }, workIds: ["work-1"] }],
    works: [{ id: "work-1", title: { ko: "작품", en: "Work" } }],
    places: [
      {
        id: "place-1",
        name: { ko: "장소", en: "Place" },
        workIds: ["work-1"],
        nearestStationId: "station-1",
        accessEstimate: { minutes: 25, source: "fixture", verifiedAt: "2026-08-07" },
        openingHours: {
          type: "hours",
          open: "09:00",
          close: "18:00",
          lastEntry: "17:00",
          source: "fixture",
          verifiedAt: "2026-08-07",
        },
        stayMinutes: 60,
        verificationLevel: "원본확인",
        officialSourceCount: 1,
        reasonText: { ko: "사유", en: "Reason" },
      },
    ],
    stations: [
      { id: "station-1", name: { ko: "역", en: "Station" }, lineType: "KTX", regionId: "gangwon" },
    ],
    trainLegs: [
      {
        trainNo: "801",
        fromStationId: "station-1",
        toStationId: "station-1",
        departAt: "2026-08-12T07:00:00+09:00",
        arriveAt: "2026-08-12T09:00:00+09:00",
      },
    ],
    gatewayLegs: [],
    flights: [
      {
        flightNo: "KE123",
        direction: "arrival",
        scheduledAt: "2026-08-12T10:00:00+09:00",
        terminal: "T1",
      },
    ],
    workPlaceRelations: [
      {
        workId: "work-1",
        placeId: "place-1",
        episodeLabel: "1화",
        sourceUrls: ["https://example.com/source"],
        verifiedAt: "2026-08-08",
        reviewed: true,
      },
    ],
  });
}

function addValidGatewayPair(raw: Seed): void {
  raw.stations.push({
    id: "station-airport",
    name: { ko: "공항", en: "Airport" },
    lineType: "AREX",
    regionId: "seoul_metro",
    isAirport: true,
  });
  const common = {
    routeId: "route-airport-bus",
    mode: "airport_bus",
    serviceName: { ko: "공항버스", en: "Airport Bus" },
    operator: { ko: "운수사", en: "Operator" },
    sourceUrls: ["https://example.com/official"],
    verifiedAt: "2026-08-09",
    scheduleKind: "observed_snapshot",
    recheckRequired: true,
  };
  raw.gatewayLegs.push(
    {
      ...common,
      id: "bus-out",
      direction: "outbound",
      fromStationId: "station-airport",
      toStationId: "station-1",
      fromName: { ko: "공항 T1", en: "Airport T1" },
      toName: { ko: "지역 터미널", en: "Regional Terminal" },
      departAt: "2026-08-12T12:00:00+09:00",
      arriveAt: "2026-08-12T15:00:00+09:00",
    },
    {
      ...common,
      id: "bus-in",
      direction: "inbound",
      fromStationId: "station-1",
      toStationId: "station-airport",
      fromName: { ko: "지역 터미널", en: "Regional Terminal" },
      toName: { ko: "공항 T1", en: "Airport T1" },
      departAt: "2026-08-14T12:00:00+09:00",
      arriveAt: "2026-08-14T15:00:00+09:00",
    },
  );
}

/** 타입이 막는 오염 값을 의도적으로 주입한다 — 검증기가 잡아내야 하는 입력 */
function corrupt(target: object, patch: Record<string, unknown>): void {
  Object.assign(target, patch);
}

function issuesOf(raw: Seed): string[] {
  try {
    parseRepositories(raw as RawSeedFiles);
    return [];
  } catch (error) {
    if (error instanceof SeedValidationError) return error.issues;
    throw error;
  }
}

describe("시드 의미 검증 (#20)", () => {
  it("유효한 시드는 통과한다", () => {
    expect(() => parseRepositories(baseSeed() as RawSeedFiles)).not.toThrow();
  });

  it("verifiedAt은 실존하는 YYYY-MM-DD 날짜여야 한다", () => {
    const raw = baseSeed();
    raw.places[0].accessEstimate.verifiedAt = "2026-13-40";
    const issues = issuesOf(raw);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("[places.json][Place:place-1][accessEstimate.verifiedAt]");
  });

  it("운영시간은 HH:mm 형식과 open < close, open <= lastEntry <= close를 지켜야 한다", () => {
    const raw = baseSeed();
    corrupt(raw.places[0].openingHours, { open: "19:00", close: "9시", lastEntry: "20:00" });
    const issues = issuesOf(raw);
    expect(issues.some((m) => m.includes("openingHours") && m.includes("HH:mm"))).toBe(true);

    corrupt(raw.places[0].openingHours, { close: "09:00" });
    const ordered = issuesOf(raw);
    expect(ordered.some((m) => m.includes("open < close"))).toBe(true);
    expect(ordered.some((m) => m.includes("lastEntry"))).toBe(true);
  });

  it("accessEstimate.minutes·stayMinutes는 양의 정수여야 한다", () => {
    const raw = baseSeed();
    raw.places[0].accessEstimate.minutes = 0;
    raw.places[0].stayMinutes = -30;
    const issues = issuesOf(raw);
    expect(issues.some((m) => m.includes("accessEstimate.minutes"))).toBe(true);
    expect(issues.some((m) => m.includes("stayMinutes"))).toBe(true);
  });

  it("TrainLeg는 유효한 ISO 일시와 departAt < arriveAt을 지켜야 한다", () => {
    const raw = baseSeed();
    raw.trainLegs.push({
      trainNo: "802",
      fromStationId: "station-1",
      toStationId: "station-1",
      departAt: "2026-08-12T12:00:00+09:00",
      arriveAt: "2026-08-12T11:00:00+09:00",
    });
    raw.trainLegs.push({
      trainNo: "803",
      fromStationId: "station-1",
      toStationId: "station-1",
      departAt: "언젠가",
      arriveAt: "2026-08-12T11:00:00+09:00",
    });
    const issues = issuesOf(raw);
    expect(issues.some((m) => m.includes("[TrainLeg:802]") && m.includes("departAt < arriveAt"))).toBe(true);
    expect(issues.some((m) => m.includes("[TrainLeg:803]") && m.includes("ISO"))).toBe(true);
  });

  it("GatewayLeg는 실제 터미널명·공식 출처와 departAt < arriveAt을 강제한다 (#58)", () => {
    const raw = baseSeed();
    addValidGatewayPair(raw);
    expect(() => parseRepositories(raw as RawSeedFiles)).not.toThrow();

    raw.gatewayLegs[0].sourceUrls = [];
    raw.gatewayLegs[0].arriveAt = raw.gatewayLegs[0].departAt;
    const issues = issuesOf(raw);
    expect(issues.some((m) => m.includes("[GatewayLeg:bus-out][sourceUrls]"))).toBe(true);
    expect(issues.some((m) => m.includes("[GatewayLeg:bus-out][arriveAt]") && m.includes("departAt < arriveAt"))).toBe(true);
  });

  // PR #29 리뷰(차단): Date.parse 기반 검증이 통과시키던 세 케이스를 계약으로 고정
  it("일시는 오프셋 포함 ISO만 허용 — 날짜 전용·오프셋 누락·실존하지 않는 달력 일시 거절", () => {
    for (const bad of ["2026-08-12", "2026-08-12T10:00:00", "2026-02-30T10:00:00+09:00"]) {
      const raw = baseSeed();
      raw.trainLegs[0].departAt = bad;
      const issues = issuesOf(raw);
      expect(
        issues.some((m) => m.includes("[TrainLeg:801][departAt]") && m.includes("ISO")),
        bad,
      ).toBe(true);
    }
  });

  it("오프셋은 Z와 +09:00 표기를 모두 허용한다", () => {
    const raw = baseSeed();
    raw.trainLegs[0].departAt = "2026-08-11T22:00:00Z"; // = 2026-08-12T07:00:00+09:00
    expect(() => parseRepositories(raw as RawSeedFiles)).not.toThrow();
  });

  it("빈 문자열 ID·참조는 거절한다 (PR #29 리뷰)", () => {
    const raw = baseSeed();
    raw.actors[0].id = "";
    raw.places[0].nearestStationId = "";
    const issues = issuesOf(raw);
    expect(issues.some((m) => m.includes("[actors.json][Actor:#0][id]"))).toBe(true);
    expect(issues.some((m) => m.includes("[places.json][Place:place-1][nearestStationId]"))).toBe(true);
  });
});

describe("중복 키 검증 (#20 — 복합 키)", () => {
  it("엔티티 id 중복은 실패한다", () => {
    const raw = baseSeed();
    raw.places.push(baseSeed().places[0]);
    const issues = issuesOf(raw);
    expect(issues.some((m) => m.includes("[Place:place-1]") && m.includes("중복 키"))).toBe(true);
  });

  it("열차는 trainNo 단독이 아니라 복합 키 기준 — 같은 번호라도 출발시각이 다르면 통과", () => {
    const raw = baseSeed();
    raw.trainLegs.push({
      ...baseSeed().trainLegs[0],
      departAt: "2026-08-13T07:00:00+09:00",
      arriveAt: "2026-08-13T09:00:00+09:00",
    });
    expect(() => parseRepositories(raw as RawSeedFiles)).not.toThrow();

    raw.trainLegs.push(baseSeed().trainLegs[0]);
    const issues = issuesOf(raw);
    expect(issues.some((m) => m.includes("[TrainLeg:801]") && m.includes("중복 키"))).toBe(true);
  });

  // PR #29 리뷰: 오프셋 표기가 달라도 같은 시각이면 중복
  it("같은 시각의 Z·+09:00 표기 차이는 중복 판정을 빠져나가지 못한다", () => {
    const raw = baseSeed();
    raw.trainLegs.push({
      ...baseSeed().trainLegs[0],
      departAt: "2026-08-11T22:00:00Z", // = 2026-08-12T07:00:00+09:00
      arriveAt: "2026-08-12T00:00:00Z",
    });
    const issues = issuesOf(raw);
    expect(issues.some((m) => m.includes("[TrainLeg:801]") && m.includes("중복 키"))).toBe(true);
  });

  it("항공은 flightNo+direction+scheduledAt 복합 키 기준", () => {
    const raw = baseSeed();
    raw.flights.push({ ...baseSeed().flights[0], direction: "departure" });
    expect(() => parseRepositories(raw as RawSeedFiles)).not.toThrow();

    raw.flights.push(baseSeed().flights[0]);
    const issues = issuesOf(raw);
    expect(issues.some((m) => m.includes("[Flight:KE123]") && m.includes("중복 키"))).toBe(true);
  });

  it("GatewayLeg 안정 ID 중복은 실패한다 (#58)", () => {
    const raw = baseSeed();
    addValidGatewayPair(raw);
    raw.gatewayLegs.push({ ...raw.gatewayLegs[0] });
    const issues = issuesOf(raw);
    expect(issues.some((m) => m.includes("[GatewayLeg:bus-out]") && m.includes("중복 키"))).toBe(true);
  });
});

describe("참조 무결성 검증 (#20)", () => {
  it("끊어진 역·작품 참조는 로드 단계에서 실패한다", () => {
    const raw = baseSeed();
    raw.places[0].nearestStationId = "station-ghost";
    raw.actors[0].workIds = ["work-ghost"];
    raw.trainLegs[0].toStationId = "station-ghost";
    const issues = issuesOf(raw);
    expect(issues.some((m) => m.includes("[Place:place-1][nearestStationId]") && m.includes("station-ghost"))).toBe(true);
    expect(issues.some((m) => m.includes("[Actor:actor-a][workIds]") && m.includes("work-ghost"))).toBe(true);
    expect(issues.some((m) => m.includes("[TrainLeg:801][toStationId]"))).toBe(true);
  });

  it("GatewayLeg의 앵커 참조와 왕복 방향을 검증한다 (#58)", () => {
    const raw = baseSeed();
    addValidGatewayPair(raw);
    raw.gatewayLegs[0].toStationId = "station-ghost";
    raw.gatewayLegs[1].direction = "outbound";
    const issues = issuesOf(raw);
    expect(issues.some((m) => m.includes("[GatewayLeg:bus-out][toStationId]") && m.includes("station-ghost"))).toBe(true);
    expect(issues.some((m) => m.includes("[GatewayLeg:bus-in][direction]") && m.includes("outbound"))).toBe(true);
  });

  it("구조가 깨진 파일에서 파생되는 참조 오류는 연쇄 보고하지 않는다", () => {
    const raw = baseSeed();
    corrupt(raw.stations[0], { id: 123 }); // stations 구조 실패
    const issues = issuesOf(raw);
    expect(issues.some((m) => m.startsWith("[stations.json]"))).toBe(true);
    // stations가 깨졌으므로 places·trainLegs의 역 참조 오류는 노이즈 — 보고 금지
    expect(issues.some((m) => m.includes("존재하지 않는 역 참조"))).toBe(false);
  });
});

describe("작품–장소 관계 검증 (#51 — 스키마 선행 고정)", () => {
  it("빈 관계 파일은 통과한다 — 값은 시드 정규화 트랙에서 채운다", () => {
    const raw = baseSeed();
    raw.workPlaceRelations = [];
    expect(() => parseRepositories(raw as RawSeedFiles)).not.toThrow();
  });

  it("episodeLabel·sceneNote 생략은 정상(회차 근거 없으면 무표기), sourceUrls는 최소 1개 필수", () => {
    const raw = baseSeed();
    delete raw.workPlaceRelations[0].episodeLabel;
    expect(() => parseRepositories(raw as RawSeedFiles)).not.toThrow();

    raw.workPlaceRelations[0].sourceUrls = [];
    const issues = issuesOf(raw);
    expect(issues.some((m) => m.includes("[work-place-relations.json]") && m.includes("[sourceUrls]"))).toBe(true);
  });

  it("같은 장소·다른 작품 관계는 정상, 같은 작품·장소 중복은 실패한다", () => {
    const raw = baseSeed();
    raw.works.push({ id: "work-2", title: { ko: "작품2", en: "Work2" } });
    raw.places[0].workIds.push("work-2"); // 관계는 Place.workIds와 정합해야 한다 (PR #52 리뷰)
    raw.workPlaceRelations.push({ ...baseSeed().workPlaceRelations[0], workId: "work-2" });
    expect(() => parseRepositories(raw as RawSeedFiles)).not.toThrow();

    raw.workPlaceRelations.push(baseSeed().workPlaceRelations[0]);
    const issues = issuesOf(raw);
    expect(issues.some((m) => m.includes("[WorkPlaceRelation:work-1→place-1]") && m.includes("중복 키"))).toBe(true);
  });

  it("끊어진 작품·장소 참조는 로드 단계에서 실패한다", () => {
    const raw = baseSeed();
    raw.workPlaceRelations[0].workId = "work-ghost";
    raw.workPlaceRelations.push({ ...baseSeed().workPlaceRelations[0], placeId: "place-ghost" });
    const issues = issuesOf(raw);
    expect(issues.some((m) => m.includes("[workId]") && m.includes("work-ghost"))).toBe(true);
    expect(issues.some((m) => m.includes("[placeId]") && m.includes("place-ghost"))).toBe(true);
  });

  it("관계의 workId가 장소의 workIds에 없으면 실패한다 — 엔진·회차 표시 사실 분기 차단 (PR #52 리뷰)", () => {
    const raw = baseSeed();
    raw.works.push({ id: "work-2", title: { ko: "작품2", en: "Work2" } });
    // work-2는 실존하지만 place-1.workIds에는 없음 — 후보 분류와 회차 표시가 갈라지는 상태
    raw.workPlaceRelations.push({ ...baseSeed().workPlaceRelations[0], workId: "work-2" });
    const issues = issuesOf(raw);
    expect(issues.some((m) =>
      m.includes("[workId]") && m.includes("workIds에 없는 작품: work-2"))).toBe(true);
  });

  it("sourceUrls는 http/https URL 형식이어야 한다 (PR #52 리뷰)", () => {
    const raw = baseSeed();
    raw.workPlaceRelations[0].sourceUrls = ["not-a-url"];
    const issues = issuesOf(raw);
    expect(issues.some((m) =>
      m.includes("[work-place-relations.json]") && m.includes("http/https"))).toBe(true);

    raw.workPlaceRelations[0].sourceUrls = ["ftp://example.com/file"];
    const ftp = issuesOf(raw);
    expect(ftp.some((m) => m.includes("http/https"))).toBe(true);
  });

  it("Place의 별칭·주소·좌표 optional 필드는 값이 있으면 검증하고 없으면 통과한다 (#51 additive)", () => {
    const raw = baseSeed();
    corrupt(raw.places[0], {
      searchAliases: [{ ko: "영진해변", en: "Yeongjin Beach" }],
      address: "강원 강릉시 주문진읍",
      latitude: 37.9,
      longitude: 128.8,
    });
    expect(() => parseRepositories(raw as RawSeedFiles)).not.toThrow();

    corrupt(raw.places[0], { latitude: 123.4 });
    const issues = issuesOf(raw);
    expect(issues.some((m) => m.includes("[places.json]") && m.includes("latitude"))).toBe(true);
  });

  it("좌표는 한 쌍이어야 한다 — 반쪽 좌표는 실패 (PR #52 리뷰, 동명이소 판단 근거)", () => {
    const raw = baseSeed();
    corrupt(raw.places[0], { latitude: 37.9 }); // longitude 없음
    const issues = issuesOf(raw);
    expect(issues.some((m) =>
      m.includes("[places.json]") && m.includes("함께 있어야"))).toBe(true);

    const raw2 = baseSeed();
    corrupt(raw2.places[0], { longitude: 128.8 }); // latitude 없음
    const issues2 = issuesOf(raw2);
    expect(issues2.some((m) => m.includes("함께 있어야"))).toBe(true);
  });
});

describe("오류 전건 일괄 보고 (#20)", () => {
  it("여러 파일의 오류가 한 번의 실패에 모두 담긴다", () => {
    const raw = baseSeed();
    raw.places[0].stayMinutes = 0; // places 의미 오류
    raw.actors[0].workIds = ["work-ghost"]; // actors 참조 오류
    raw.flights.push(baseSeed().flights[0]); // flights 중복
    const issues = issuesOf(raw);
    expect(issues.length).toBeGreaterThanOrEqual(3);
    expect(issues.some((m) => m.startsWith("[places.json]"))).toBe(true);
    expect(issues.some((m) => m.startsWith("[actors.json]"))).toBe(true);
    expect(issues.some((m) => m.startsWith("[flights-snapshot.json]"))).toBe(true);
  });

  it("파일 단위 JSON 파싱 오류도 다른 파일 검증과 함께 수집된다", () => {
    const dir = mkdtempSync(join(tmpdir(), "scenaro-seed-"));
    const raw = baseSeed();
    const files: Record<string, unknown> = {
      "actors.json": raw.actors,
      "works.json": raw.works,
      "places.json": raw.places,
      "stations.json": raw.stations,
      "train-snapshot.json": raw.trainLegs,
      "gateway-legs.json": raw.gatewayLegs,
      "flights-snapshot.json": raw.flights,
      "work-place-relations.json": raw.workPlaceRelations,
    };
    for (const [name, value] of Object.entries(files)) {
      writeFileSync(join(dir, name), JSON.stringify(value), "utf-8");
    }
    writeFileSync(join(dir, "works.json"), "{ 깨진 JSON", "utf-8");

    try {
      loadRepositories(dir);
      expect.unreachable("검증이 실패해야 합니다");
    } catch (error) {
      expect(error).toBeInstanceOf(SeedValidationError);
      const issues = (error as SeedValidationError).issues;
      expect(issues.some((m) => m.startsWith("[works.json][(파일)]"))).toBe(true);
      // works가 읽히지 않았으므로 actors→works 참조 오류는 연쇄 보고하지 않는다
      expect(issues.some((m) => m.includes("존재하지 않는 작품 참조"))).toBe(false);
    }
  });
});
