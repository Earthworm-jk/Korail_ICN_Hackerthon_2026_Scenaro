import { describe, expect, it } from "vitest";
import { actorPresence, initialSelectedIds, splitByActorPresence } from "../candidates";
import { formatEpisodeLabel } from "../episode-label";
import { getCandidatePlaces, type PlaceCandidate } from "../actions/places";

// #51 배우 선택 필터 회귀 — 미등장 확정·미확인 장소가 기본 목록(추천 상위)에 나오지 않는다.
// 필터는 표시 레벨 전용: 엔진·초기 선택(#43)은 관여하지 않는다.

const KIM = "actor-kim-go-eun";
const kimSet = new Set([KIM]);

type Sub = Pick<PlaceCandidate, "relation" | "relationDetails">;
const cand = (relation: Sub["relation"], details: Sub["relationDetails"]): Sub => ({
  relation,
  relationDetails: details,
});

describe("actorPresence", () => {
  it("배우 미선택이면 필터 비대상이다", () => {
    expect(actorPresence(cand("actor_other_work", []), new Set())).toBeNull();
  });

  it("선택 작품 유래 후보는 장면 배우와 무관하다 (작품 선택 계약)", () => {
    expect(actorPresence(
      cand("selected_work", [{ workId: "w", featuredActorIds: [], actorPresenceReviewed: true }]),
      kimSet,
    )).toBeNull();
  });

  it("등장 확정(ⓐ)·미등장 확정(ⓑ)·미검토(ⓒ)를 구분한다", () => {
    expect(actorPresence(
      cand("actor_other_work", [{ workId: "w", featuredActorIds: [KIM], actorPresenceReviewed: true }]),
      kimSet,
    )).toBe("confirmed");
    expect(actorPresence(
      cand("actor_other_work", [{ workId: "w", featuredActorIds: [], actorPresenceReviewed: true }]),
      kimSet,
    )).toBe("absent");
    expect(actorPresence(cand("actor_other_work", [{ workId: "w" }]), kimSet)).toBe("unreviewed");
  });

  // PR #65 리뷰 1 — 판정 순서 confirmed → unreviewed → absent
  it("한 장소 복수 관계: 미검토 관계가 남아 있으면 미등장을 단정하지 않는다", () => {
    // 관련 관계 = [미검토, 검토·미등장] → absent가 아니라 unreviewed
    expect(actorPresence(
      cand("actor_other_work", [
        { workId: "w1" },
        { workId: "w2", featuredActorIds: [], actorPresenceReviewed: true },
      ]),
      kimSet,
    )).toBe("unreviewed");
    // 등장 확정이 하나라도 있으면 나머지 상태와 무관하게 confirmed
    expect(actorPresence(
      cand("actor_other_work", [
        { workId: "w1" },
        { workId: "w2", featuredActorIds: [KIM], actorPresenceReviewed: true },
      ]),
      kimSet,
    )).toBe("confirmed");
    // 관련 관계가 전부 검토됐고 선택 배우가 없을 때만 absent
    expect(actorPresence(
      cand("actor_other_work", [
        { workId: "w1", featuredActorIds: ["actor-other"], actorPresenceReviewed: true },
        { workId: "w2", featuredActorIds: [], actorPresenceReviewed: true },
      ]),
      kimSet,
    )).toBe("absent");
    // 관련 관계가 없으면 모름 — unreviewed
    expect(actorPresence(cand("actor_other_work", []), kimSet)).toBe("unreviewed");
  });

  it("복수 배우: 한 명이라도 등장 확정이면 confirmed, 아니면 미검토 우선", () => {
    const twoActors = new Set([KIM, "actor-b"]);
    expect(actorPresence(
      cand("actor_other_work", [
        { workId: "w1", featuredActorIds: ["actor-b"], actorPresenceReviewed: true },
      ]),
      twoActors,
    )).toBe("confirmed");
    // A는 미등장 확정, B의 출연작 관계는 미검토 → 전체 absent가 아니라 unreviewed
    expect(actorPresence(
      cand("actor_other_work", [
        { workId: "w1", featuredActorIds: [], actorPresenceReviewed: true },
        { workId: "w2" },
      ]),
      twoActors,
    )).toBe("unreviewed");
  });
});

describe("formatEpisodeLabel — 영어 경로 한글 잔류 방지 (PR #59 리뷰 1 연장)", () => {
  it("ko는 원문, en은 Ep. 숫자 표기로 바꾼다", () => {
    expect(formatEpisodeLabel("ko", "1화")).toBe("1화");
    expect(formatEpisodeLabel("en", "1화")).toBe("Ep. 1");
    expect(formatEpisodeLabel("en", "7–8화")).toBe("Ep. 7–8");
    expect(formatEpisodeLabel("en", "1화·14화")).toBe("Ep. 1·14");
  });

  it("숫자 패턴이 아닌 표기는 영어에서 숨기고, 시드 전체 회차가 en 포맷에서 한글 0건이다", async () => {
    expect(formatEpisodeLabel("en", "특별편")).toBeNull();
    expect(formatEpisodeLabel("en", undefined)).toBeNull();
    const { candidates } = await getCandidatePlaces({ selectedActorIds: [KIM], selectedWorkIds: [] });
    for (const c of candidates) {
      for (const d of c.relationDetails) {
        const formatted = formatEpisodeLabel("en", d.episodeLabel);
        if (formatted) expect(/[가-힣]/.test(formatted), `${c.id}: ${formatted}`).toBe(false);
      }
    }
  });
});

describe("실시드 배우 선택 화면 회귀 (김고은)", () => {
  it("미등장 확정 3곳·미확인 1곳이 기본 목록에 나오지 않고 별도 구분으로 내려간다", async () => {
    const { candidates } = await getCandidatePlaces({ selectedActorIds: [KIM], selectedWorkIds: [] });
    const { primary, separated } = splitByActorPresence(candidates, kimSet);

    const separatedIds = separated.map(({ candidate }) => candidate.id).sort();
    expect(separatedIds).toEqual([
      "place-deoksugung-stone-wall-road",
      "place-samyang-ranch",
      "place-yeongjin-beach",
    ]);
    expect(separated.find(({ candidate }) => candidate.id === "place-yeongjin-beach")?.status)
      .toBe("unreviewed");
    expect(separated.filter(({ status }) => status === "absent")).toHaveLength(2);
    expect(primary.map((c) => c.id)).not.toContain("place-samyang-ranch");
    expect(primary).toHaveLength(8); // 등장 확정 8곳 (11곳 시드 — #61 죽림동·#56 (d) 경기전 제외)
  });

  it("작품을 함께 선택하면 그 작품 유래 후보는 장면 배우와 무관하게 기본 목록에 남는다", async () => {
    const { candidates } = await getCandidatePlaces({
      selectedActorIds: [KIM],
      selectedWorkIds: ["work-goblin"],
    });
    const { primary } = splitByActorPresence(candidates, kimSet);
    // 삼양목장은 김고은 미등장 확정(공유 장면)이지만 선택 작품(도깨비) 유래라 기본 목록 유지
    expect(primary.map((c) => c.id)).toContain("place-samyang-ranch");
  });

  // PR #65 리뷰 1 — relationDetails는 선택 작품 ∪ 선택 배우 출연작 관계만
  it("후보 관계 정보에 선택과 무관한 작품 관계가 섞이지 않는다", async () => {
    const { candidates } = await getCandidatePlaces({
      selectedActorIds: [],
      selectedWorkIds: ["work-little-women"],
    });
    expect(candidates.length).toBeGreaterThan(0);
    for (const c of candidates) {
      for (const d of c.relationDetails) {
        expect(d.workId, `${c.id}에 무관 작품 관계: ${d.workId}`).toBe("work-little-women");
      }
    }
  });

  // PR #65 리뷰 2 — 배우 모드 초기 선택은 기본 목록만, 별도 구분은 초기 미선택
  it("배우 선택 모드의 초기 선택에 미등장·미확인 후보가 들어가지 않는다", async () => {
    const { candidates } = await getCandidatePlaces({ selectedActorIds: [KIM], selectedWorkIds: [] });
    const initial = new Set(initialSelectedIds(candidates, kimSet));
    expect(initial.size).toBe(8);
    for (const id of [
      "place-samyang-ranch", "place-deoksugung-stone-wall-road", "place-yeongjin-beach",
    ]) {
      expect(initial.has(id), `${id}는 초기 미선택이어야 한다`).toBe(false);
    }
    // 배우 미선택이면 기존 전체 선택(#43) 그대로
    expect(initialSelectedIds(candidates, new Set())).toHaveLength(candidates.length);
  });

  it("선택 작품 유래(selected_work) 후보는 배우 모드에서도 초기 선택을 유지한다", async () => {
    const { candidates } = await getCandidatePlaces({
      selectedActorIds: [KIM],
      selectedWorkIds: ["work-goblin"],
    });
    expect(initialSelectedIds(candidates, kimSet)).toContain("place-samyang-ranch");
  });

  it("후보 카드 표시용 회차·장면이 관계 값 그대로 내려온다", async () => {
    const { candidates } = await getCandidatePlaces({ selectedActorIds: [KIM], selectedWorkIds: [] });
    const lalaMuri = candidates.find((c) => c.id === "place-lala-muri");
    expect(lalaMuri?.relationDetails).toHaveLength(1);
    expect(lalaMuri?.relationDetails[0].episodeLabel).toBe("1화");
    expect(lalaMuri?.relationDetails[0].sceneNote?.en).toBeTruthy();
    // 회차 근거가 없는 관계는 무표기 (#51 완료 기준)
    const samyang = candidates.find((c) => c.id === "place-samyang-ranch");
    expect(samyang?.relationDetails[0].episodeLabel).toBeUndefined();
  });
});
