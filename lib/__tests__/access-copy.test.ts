import { describe, expect, it } from "vitest";
import { messages } from "../i18n/messages";
import { getCandidatePlaces } from "../actions/places";
import { loadRepositories } from "../repositories/json";
import { roundTripStationIds } from "../timetable-coverage";

/**
 * #61 확정 표기 계약 전파 회귀 (#84 P0-3)
 *
 * 접근시간은 카카오맵 자동차 길찾기 기반 보수값이다. 화면에서 "역에서 약 N분"이라고만
 * 하면 대중교통으로 읽히고, 우리는 대중교통 소요시간을 제공하지 않는다.
 * 또 앵커역 시간표를 아직 확보하지 못한 장소를 "연결 열차 없음"으로 표시하면
 * 갈 수 없는 곳을 추천한 것처럼 읽힌다.
 */
describe("접근시간 표기 계약 (#61)", () => {
  it("접근시간 문구가 이동수단을 명시한다", () => {
    expect(messages.ko["access.byCar"]).toContain("차량");
    expect(messages.en["access.byCar"]).toContain("by car");
    // 분 수는 자리표시자로 넣고 화면에서 채운다 — 완성 문장을 엔진이 만들지 않는다
    expect(messages.ko["access.byCar"]).toContain("{n}");
    expect(messages.en["access.byCar"]).toContain("{n}");
  });

  it("대중교통 미제공 고지가 두 언어에 있다", () => {
    expect(messages.ko["access.notice"]).toContain("대중교통");
    expect(messages.en["access.notice"]).toContain("public transit");
  });

  it("이동수단을 감춘 옛 문구가 남아 있지 않다", () => {
    for (const locale of ["ko", "en"] as const) {
      expect(Object.keys(messages[locale])).not.toContain("step3.accessAbout");
      expect(Object.keys(messages[locale])).not.toContain("step3.accessEstimate");
      expect(Object.keys(messages[locale])).not.toContain("itinerary.estimateLabel");
    }
  });

  it("열차 없음 사유가 커버리지와 일정 실패로 나뉜다", () => {
    expect(messages.ko["reason.TRAIN_UNAVAILABLE"]).toContain("일정");
    expect(messages.ko["reason.TRAIN_OUT_OF_COVERAGE"]).toContain("범위 밖");
    expect(messages.en["reason.TRAIN_OUT_OF_COVERAGE"]).toContain("timetable range");
  });
});

describe("시간표 커버리지 노출", () => {
  it("왕복이 가능한 역만 hasTimetable이 참이다", async () => {
    const repos = loadRepositories();
    const covered = roundTripStationIds(repos.trainLegs);
    const response = await getCandidatePlaces({
      selectedActorIds: ["actor-kim-go-eun"],
      selectedWorkIds: [],
    });
    expect(response.stations.length).toBe(repos.stations.length);
    for (const station of response.stations) {
      expect(station.hasTimetable, station.id).toBe(covered.has(station.id));
    }
  });

  it("커버리지 밖 판정이 합성 스냅샷에서 재현된다 — 분기가 죽은 코드가 아니다", async () => {
    // 전라선 팩(#72) 수록으로 실시드에는 커버리지 밖 앵커역이 더 이상 없다. 그래서
    // 실데이터 대신 합성 스냅샷으로 고정한다: 앵커역이 실재해도 그 역 왕복 구간이
    // 스냅샷에 없으면 hasTimetable이 거짓이 되고, 화면은 "시간표 범위 밖"으로 갈린다.
    const response = await getCandidatePlaces({
      selectedActorIds: [],
      selectedWorkIds: ["work-the-king"],
    });
    const anchorIds = [...new Set(response.candidates.map((c) => c.nearestStationId))];
    expect(anchorIds.length).toBeGreaterThan(1);

    // 첫 앵커역만 왕복이 없는 스냅샷 — 나머지는 왕복을 갖춘다
    const [uncovered, ...rest] = anchorIds;
    const synthetic = [
      { fromStationId: uncovered, toStationId: rest[0] }, // 편도만 — 돌아오는 편 없음
      ...rest.flatMap((id) => [
        { fromStationId: id, toStationId: "station-seoul" },
        { fromStationId: "station-seoul", toStationId: id },
      ]),
    ];
    const covered = roundTripStationIds(synthetic);
    expect(covered.has(uncovered)).toBe(false);
    for (const id of rest) expect(covered.has(id), id).toBe(true);
  });

  it("《더 킹》 후보의 앵커역이 모두 왕복 커버다 — 전라선 팩 회귀 (#72)", async () => {
    // 경기전이 "연결 가능한 열차가 없습니다"로 빠지던 원인은 전주 구간 0건이었다.
    const response = await getCandidatePlaces({
      selectedActorIds: [],
      selectedWorkIds: ["work-the-king"],
    });
    const anchorIds = new Set(response.candidates.map((c) => c.nearestStationId));
    expect(anchorIds.has("station-jeonju")).toBe(true);
    for (const station of response.stations.filter((s) => anchorIds.has(s.id))) {
      expect(station.hasTimetable, station.id).toBe(true);
    }
  });
});

describe("왕복 커버리지 판정 (#61 수록 기준 5)", () => {
  it("단방향 구간만 있는 역은 커버로 치지 않는다", () => {
    // 가는 열차만 있고 돌아오는 열차가 없으면 일정이 성립하지 않는다.
    // "일정 안에 KTX 없음"이 아니라 "시간표 범위 밖"이 맞다 (PR #91 리뷰).
    const covered = roundTripStationIds([{ fromStationId: "A", toStationId: "B" }]);
    expect(covered.size).toBe(0);
  });

  it("양방향 구간이 있으면 양쪽 역 모두 커버다", () => {
    const covered = roundTripStationIds([
      { fromStationId: "A", toStationId: "B" },
      { fromStationId: "B", toStationId: "A" },
    ]);
    expect([...covered].sort()).toEqual(["A", "B"]);
  });

  it("나가는 축과 들어오는 축이 다르면 커버가 아니다", () => {
    // A→B 와 C→A 만 있으면 A는 등장 횟수가 둘이지만 A 기점 왕복은 못 만든다
    const covered = roundTripStationIds([
      { fromStationId: "A", toStationId: "B" },
      { fromStationId: "C", toStationId: "A" },
    ]);
    expect(covered.has("A")).toBe(false);
  });

  it("자기 자신으로 가는 구간은 왕복으로 치지 않는다", () => {
    expect(roundTripStationIds([{ fromStationId: "A", toStationId: "A" }]).size).toBe(0);
  });

  it("실시드에서는 등장 역이 모두 왕복 가능하다 — 단방향 수집분이 생기면 알려 준다", () => {
    const repos = loadRepositories();
    const appearing = new Set(
      repos.trainLegs.flatMap((leg) => [leg.fromStationId, leg.toStationId]),
    );
    const roundTrip = roundTripStationIds(repos.trainLegs);
    expect([...appearing].filter((id) => !roundTrip.has(id))).toEqual([]);
  });
});
