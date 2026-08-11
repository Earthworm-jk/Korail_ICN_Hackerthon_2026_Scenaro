import { describe, expect, it } from "vitest";
import { generateItinerary } from "../engine";
import { loadRepositories } from "../repositories/json";
import { BASE_CONSTRAINTS } from "../../test/planner-fixtures";
import type { CandidateRejection } from "../engine/types";

/**
 * 미배치 사유 정확도 회귀 (#84 P0-1)
 *
 * 사유는 사용자가 다음에 무엇을 할지 정하는 근거다. 하루 상한 때문에 밀린 장소에
 * "출국 여유를 지킬 수 없습니다"라고 하면, 선택을 줄이거나 날짜를 늘리면 되는데도
 * 조건을 바꿀 방법이 없다고 읽힌다.
 *
 * #84 회신에서 요구한 네 경계(정상 / 일일 상한 / 여행 마감 / 열차 없음)를 고정한다.
 */

const codesOf = (rejected: CandidateRejection[]) => new Set(rejected.map((r) => r.code));

describe("미배치 사유 분리", () => {
  const repos = loadRepositories();

  it("정상 조건에서는 미배치가 없거나, 있어도 사유가 정의된 코드다", () => {
    const result = generateItinerary(BASE_CONSTRAINTS, repos);
    expect(result.status).toBe("planned");
    for (const rejection of result.rejectedPlaces) {
      expect(
        ["TRAIN_UNAVAILABLE", "DAILY_CAPACITY_EXCEEDED", "DEPARTURE_DEADLINE_EXCEEDED",
          "NOT_IN_BEST_SUBSET"],
      ).toContain(rejection.code);
    }
  });

  /**
   * #84 §2 · #171 — 실시드 기본 조건이 곧 과선택 상황이다(후보 전체가 초기 선택이므로).
   * 여기서 밀린 장소들이 "이용 가능한 KTX가 없습니다"를 받고 있었다. 강릉·부산처럼 KTX가
   * 멀쩡히 다니는 곳이라 화면이 사실과 다른 말을 했다.
   */
  describe("밀린 것과 단독 불가능을 가른다", () => {
    it("기본 조건에서 밀린 장소는 NOT_IN_BEST_SUBSET이다", () => {
      const result = generateItinerary(BASE_CONSTRAINTS, repos);
      expect(result.status).toBe("planned");
      expect(codesOf(result.rejectedPlaces).has("NOT_IN_BEST_SUBSET")).toBe(true);
    });

    /**
     * 분류의 근거를 고정한다 — 코드만 바꾸고 판정이 틀리면 이 테스트가 잡는다.
     * 밀렸다고 보고한 장소는 **다른 선택을 모두 빼면 실제로 배치돼야** 한다.
     */
    it("밀렸다고 보고한 장소는 혼자 고르면 실제로 배치된다", () => {
      const result = generateItinerary(BASE_CONSTRAINTS, repos);
      expect(result.status).toBe("planned");
      if (result.status !== "planned") return;

      const pushedOut = result.rejectedPlaces.filter((r) => r.code === "NOT_IN_BEST_SUBSET");
      expect(pushedOut.length).toBeGreaterThan(0);

      for (const rejection of pushedOut) {
        const alone = generateItinerary(
          {
            ...BASE_CONSTRAINTS,
            excludedPlaceIds: repos.places
              .map((place) => place.id)
              .filter((id) => id !== rejection.placeId),
          },
          repos,
        );
        expect(alone.status, `${rejection.placeId} 는 혼자면 갈 수 있어야 한다`).toBe("planned");
      }
    });

    /**
     * 하루 상한은 이미 구체적이고 조치도 다르다(날짜를 늘리면 된다). 밀림으로 덮으면
     * 사용자가 할 수 있는 일이 사라진다 — #84 P0-1이 나눠 놓은 것을 되돌리면 안 된다.
     */
    it("하루 상한 사유를 밀림으로 덮지 않는다", () => {
      const tight = generateItinerary({ ...BASE_CONSTRAINTS, maxPlacesPerDay: 1 }, repos);
      expect(codesOf(tight.rejectedPlaces).has("DAILY_CAPACITY_EXCEEDED")).toBe(true);
    });

    /** 일정 자체가 서지 않는 경우는 조합 경쟁이 없다 — 사유가 밀림으로 바뀌면 안 된다 */
    it("일정이 아예 안 서면 밀림으로 보고하지 않는다", () => {
      const tooShort = generateItinerary(
        {
          ...BASE_CONSTRAINTS,
          airportArrivalDeadline: "2026-08-12T18:00:00+09:00",
          departureAt: "2026-08-12T20:00:00+09:00",
        },
        repos,
      );
      expect(tooShort.status).toBe("empty");
      expect(tooShort.rejectedPlaces.length).toBeGreaterThan(0);
      expect(codesOf(tooShort.rejectedPlaces).has("NOT_IN_BEST_SUBSET")).toBe(false);
    });
  });

  it("하루 상한을 1로 조이면 밀린 장소가 DAILY_CAPACITY_EXCEEDED로 보고된다", () => {
    // 기간·열차는 그대로 두고 하루 수용량만 줄인다 — 원인이 상한임이 자명한 조건
    const tight = generateItinerary({ ...BASE_CONSTRAINTS, maxPlacesPerDay: 1 }, repos);
    expect(tight.status).toBe("planned");
    const codes = codesOf(tight.rejectedPlaces);
    expect(tight.rejectedPlaces.length).toBeGreaterThan(0);
    expect(codes.has("DAILY_CAPACITY_EXCEEDED")).toBe(true);
  });

  it("하루 상한을 풀면 상한 사유가 사라진다 — 사유가 상한에 반응한다", () => {
    const loose = generateItinerary({ ...BASE_CONSTRAINTS, maxPlacesPerDay: 99 }, repos);
    expect(loose.status).toBe("planned");
    expect(codesOf(loose.rejectedPlaces).has("DAILY_CAPACITY_EXCEEDED")).toBe(false);
  });

  it("여행 기간을 하루로 줄이면 상한이 아니라 마감·열차 사유로 보고된다", () => {
    // 하루 상한은 넉넉히 두고 기간만 조인다 — 상한 탓으로 뭉뚱그리지 않는지 확인
    const short = generateItinerary(
      {
        ...BASE_CONSTRAINTS,
        maxPlacesPerDay: 99,
        departureAt: "2026-08-12T20:00:00+09:00",
        airportArrivalDeadline: "2026-08-12T18:00:00+09:00",
      },
      repos,
    );
    const codes = codesOf(short.rejectedPlaces);
    expect(short.rejectedPlaces.length).toBeGreaterThan(0);
    expect(codes.has("DAILY_CAPACITY_EXCEEDED")).toBe(false);
    expect(
      codes.has("DEPARTURE_DEADLINE_EXCEEDED") || codes.has("TRAIN_UNAVAILABLE"),
    ).toBe(true);
  });

  it("열차가 하나도 없으면 TRAIN_UNAVAILABLE이다", () => {
    const noTrains = { ...repos, trainLegs: [] };
    const result = generateItinerary(BASE_CONSTRAINTS, noTrains);
    const codes = codesOf(result.rejectedPlaces);
    expect(result.rejectedPlaces.length).toBeGreaterThan(0);
    expect(codes.has("DAILY_CAPACITY_EXCEEDED")).toBe(false);
    expect(codes.has("TRAIN_UNAVAILABLE")).toBe(true);
  });

  it("모든 사유 코드에 ko·en 문구가 있다", async () => {
    const { messages } = await import("../i18n/messages");
    for (const code of [
      "TRAIN_UNAVAILABLE",
      "DAILY_CAPACITY_EXCEEDED",
      "DEPARTURE_DEADLINE_EXCEEDED",
    ] as const) {
      expect(messages.ko[`reason.${code}`], code).toBeTruthy();
      expect(messages.en[`reason.${code}`], code).toBeTruthy();
    }
  });
});
