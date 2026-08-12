import { describe, expect, it } from "vitest";

import { displayRejectionCode, groupRejections } from "@/lib/rejection-groups";
import { messages } from "@/lib/i18n/messages";
import type { CandidateRejection } from "@/lib/engine/types";

/**
 * 미배치 사유 묶기 (#84 §2 · #171).
 *
 * 지키는 것은 **읽을 수 있는 줄 수**와 **순서**다. 사유가 3-4종인데 장소 수만큼 줄이 나오면
 * 지금도 읽기 어렵고 카탈로그가 30-50곳으로 늘면(#72) 더 나빠진다.
 */

const r = (code: CandidateRejection["code"], placeId: string): CandidateRejection =>
  ({ code, placeId }) as CandidateRejection;

describe("미배치 사유 묶기", () => {
  it("사유 종류만큼만 줄이 나온다 — 장소 수와 무관하다", () => {
    const many = [
      ...Array.from({ length: 40 }, (_, i) => r("NOT_IN_BEST_SUBSET", `p${i}`)),
      ...Array.from({ length: 9 }, (_, i) => r("DAILY_CAPACITY_EXCEEDED", `q${i}`)),
      r("DEPARTURE_DEADLINE_EXCEEDED", "z0"),
    ];
    expect(groupRejections(many)).toHaveLength(3);
  });

  it("장소를 하나도 잃지 않는다", () => {
    const input = [
      r("TRAIN_UNAVAILABLE", "a"),
      r("NOT_IN_BEST_SUBSET", "b"),
      r("DAILY_CAPACITY_EXCEEDED", "c"),
      r("NOT_IN_BEST_SUBSET", "d"),
    ];
    const flat = groupRejections(input).flatMap((g) => g.placeIds);
    expect(flat.sort()).toEqual(["a", "b", "c", "d"]);
  });

  /** 목록이 곧 개수다 — 중복이 남으면 "11곳"이라 적고 12줄을 그리게 된다 */
  it("같은 장소가 여러 사유로 와도 한 번만 센다", () => {
    const groups = groupRejections([
      r("TRAIN_UNAVAILABLE", "a"),
      r("NOT_IN_BEST_SUBSET", "a"),
      r("DAILY_CAPACITY_EXCEEDED", "a"),
    ]);
    expect(groups.flatMap((g) => g.placeIds)).toEqual(["a"]);
  });

  /**
   * 순서는 "지금 무엇을 할 수 있는가"다. 개수 많은 순으로 두면 손댈 수 있는 항목이 아래로
   * 밀릴 수 있다 — 여기서는 1곳짜리 밀림이 40곳짜리 열차 없음보다 위에 와야 한다.
   */
  it("고칠 수 있는 사유가 먼저 온다", () => {
    const groups = groupRejections([
      ...Array.from({ length: 40 }, (_, i) => r("TRAIN_UNAVAILABLE", `t${i}`)),
      r("NOT_IN_BEST_SUBSET", "fixable"),
    ]);
    expect(groups.map((g) => g.code)).toEqual(["NOT_IN_BEST_SUBSET", "TRAIN_UNAVAILABLE"]);
  });

  it("없는 사유는 빈 줄을 만들지 않는다", () => {
    expect(groupRejections([])).toEqual([]);
    expect(groupRejections([r("NOT_IN_BEST_SUBSET", "a")]).map((g) => g.code))
      .toEqual(["NOT_IN_BEST_SUBSET"]);
  });

  it("같은 입력이면 같은 순서다 — 화면이 흔들리지 않는다", () => {
    const input = [r("DAILY_CAPACITY_EXCEEDED", "b"), r("NOT_IN_BEST_SUBSET", "a")];
    expect(groupRejections(input)).toEqual(groupRejections(input));
  });

  it("두 로케일 모두 개수 문구에 자리표시자가 있다", () => {
    for (const locale of ["ko", "en"] as const) {
      expect(messages[locale]["step4.rejectedCount"]).toContain("{n}");
    }
  });

  /**
   * PR #172 리뷰 — `TRAIN_UNAVAILABLE` 하나가 화면에서 두 문구로 갈린다 (#61). 엔진 코드로
   * 묶고 그룹 대표 하나로 문구를 정하면, 커버리지 밖 장소와 안쪽 장소가 한 줄에 섞여
   * **이 작업이 고치려던 "사유가 사실과 다르게 읽힌다"가 그대로 되살아난다.**
   */
  describe("커버리지 갈림을 묶기 전에 처리한다", () => {
    const outOfCoverage = new Set(["far"]);

    it("커버리지 밖 장소만 다른 표시 코드가 된다", () => {
      expect(displayRejectionCode(r("TRAIN_UNAVAILABLE", "far"), outOfCoverage))
        .toBe("TRAIN_OUT_OF_COVERAGE");
      expect(displayRejectionCode(r("TRAIN_UNAVAILABLE", "near"), outOfCoverage))
        .toBe("TRAIN_UNAVAILABLE");
    });

    it("다른 사유는 커버리지와 무관하다", () => {
      for (const code of ["NOT_IN_BEST_SUBSET", "DAILY_CAPACITY_EXCEEDED", "DEPARTURE_DEADLINE_EXCEEDED"] as const) {
        expect(displayRejectionCode(r(code, "far"), outOfCoverage)).toBe(code);
      }
    });

    /** 이 테스트가 리뷰에서 지적된 결함을 직접 잡는다 */
    it("섞인 장소는 두 줄로 갈리고 각자 제 문구를 받는다", () => {
      const mixed = [r("TRAIN_UNAVAILABLE", "far"), r("TRAIN_UNAVAILABLE", "near")];
      const groups = groupRejections(
        mixed.map((reason) => ({
          code: displayRejectionCode(reason, outOfCoverage),
          placeId: reason.placeId,
        })),
      );
      expect(groups).toHaveLength(2);
      expect(groups.find((g) => g.code === "TRAIN_OUT_OF_COVERAGE")?.placeIds).toEqual(["far"]);
      expect(groups.find((g) => g.code === "TRAIN_UNAVAILABLE")?.placeIds).toEqual(["near"]);
    });

    it("커버리지 밖 문구가 두 로케일에 있다", () => {
      for (const locale of ["ko", "en"] as const) {
        expect(messages[locale]["reason.TRAIN_OUT_OF_COVERAGE"]).toBeTruthy();
      }
    });
  });

  /** 새 사유 코드를 추가하고 순서에 넣지 않으면 화면에서 조용히 사라진다 */
  it("모든 사유 코드가 순서에 들어 있다", () => {
    const codes = [
      "TRAIN_UNAVAILABLE",
      "TRAIN_OUT_OF_COVERAGE",
      "DAILY_CAPACITY_EXCEEDED",
      "DEPARTURE_DEADLINE_EXCEEDED",
      "NOT_IN_BEST_SUBSET",
    ] as const;
    const grouped = groupRejections(codes.map((code, i) => ({ code, placeId: `p${i}` })));
    expect(grouped).toHaveLength(codes.length);
    for (const locale of ["ko", "en"] as const) {
      for (const code of codes) {
        expect(messages[locale][`reason.${code}`]).toBeTruthy();
      }
    }
  });
});
