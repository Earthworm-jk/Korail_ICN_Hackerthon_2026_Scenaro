import { describe, expect, it } from "vitest";
import { messages } from "../i18n/messages";
import { getCandidatePlaces } from "../actions/places";
import { loadRepositories } from "../repositories/json";

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
  it("스냅샷에 구간이 있는 역만 hasTimetable이 참이다", async () => {
    const repos = loadRepositories();
    const covered = new Set(
      repos.trainLegs.flatMap((leg) => [leg.fromStationId, leg.toStationId]),
    );
    const response = await getCandidatePlaces({
      selectedActorIds: ["actor-kim-go-eun"],
      selectedWorkIds: [],
    });
    expect(response.stations.length).toBe(repos.stations.length);
    for (const station of response.stations) {
      expect(station.hasTimetable, station.id).toBe(covered.has(station.id));
    }
  });

  it("커버리지 밖 앵커역이 실제로 존재한다 — 분기가 죽은 코드가 아니다", async () => {
    // 지금은 전주역이 해당한다. 스냅샷이 확장돼 사라지면 이 테스트가 알려 준다.
    const response = await getCandidatePlaces({
      selectedActorIds: [],
      selectedWorkIds: ["work-the-king"],
    });
    const anchorIds = new Set(response.candidates.map((c) => c.nearestStationId));
    const uncovered = response.stations.filter(
      (s) => anchorIds.has(s.id) && !s.hasTimetable,
    );
    expect(uncovered.length).toBeGreaterThan(0);
  });
});
