import { describe, expect, it } from "vitest";
import evidenceSeed from "../../data/actor-presence-evidence.json";
import relationsSeed from "../../data/work-place-relations.json";
import {
  ActorPresenceEvidenceRecordSchema,
  decideActorPresence,
  type ActorPresenceEvidence,
} from "../actor-presence-verification";

const evidence = (patch: Partial<ActorPresenceEvidence> = {}): ActorPresenceEvidence => ({
  sourceUrl: "https://english.visitkorea.or.kr/yeongjin",
  sourceTier: "official",
  excerpt: "Eun-tak (played by Kim Go-eun) appears at Yeongjin Beach.",
  placeMatched: true,
  workMatched: true,
  claim: "present",
  actorExplicit: false,
  characterActorLinked: true,
  ...patch,
});

describe("배우–장면 자동 검증 판정", () => {
  it("공식 출처의 배역–배우 명시는 A등급 등장 확정이다", () => {
    expect(decideActorPresence([evidence()])).toEqual({
      status: "confirmed",
      grade: "A",
      sourceUrls: ["https://english.visitkorea.or.kr/yeongjin"],
    });
  });

  it("서로 독립된 편집 출처 2개는 B등급으로 확정한다", () => {
    const result = decideActorPresence([
      evidence({ sourceTier: "editorial", sourceUrl: "https://media-a.example/scene" }),
      evidence({ sourceTier: "editorial", sourceUrl: "https://media-b.example/scene" }),
    ]);
    expect(result.status).toBe("confirmed");
    expect("grade" in result && result.grade).toBe("B");
  });

  it("작품–장소만 맞고 배우가 명시되지 않으면 미확정이다", () => {
    expect(decideActorPresence([
      evidence({ actorExplicit: false, characterActorLinked: false }),
    ]).status).toBe("unverified");
  });

  it("같은 도메인의 반복 기사와 커뮤니티 근거는 자동 확정하지 않는다", () => {
    expect(decideActorPresence([
      evidence({ sourceTier: "editorial", sourceUrl: "https://news.example/a" }),
      evidence({ sourceTier: "editorial", sourceUrl: "https://news.example/b" }),
      evidence({ sourceTier: "community", sourceUrl: "https://community.example/post" }),
    ]).status).toBe("unverified");
  });

  it("커뮤니티의 반대 주장은 공식 근거를 충돌로 강등하지 않는다", () => {
    expect(decideActorPresence([
      evidence(),
      evidence({
        sourceTier: "community",
        sourceUrl: "https://community.example/post",
        claim: "absent",
      }),
    ]).status).toBe("confirmed");
  });

  it("등장·미등장 명시 근거가 충돌하면 자동 확정하지 않는다", () => {
    expect(decideActorPresence([
      evidence(),
      evidence({ sourceUrl: "https://another.example/scene", claim: "absent" }),
    ]).status).toBe("conflict");
  });
});

describe("저장된 자동 검증 입력 재현", () => {
  const records = evidenceSeed.map((record) => ActorPresenceEvidenceRecordSchema.parse(record));

  it("커밋된 근거 레코드로 기대 판정을 다시 계산한다", () => {
    for (const record of records) {
      expect(decideActorPresence(record.evidence), record.id).toEqual(record.expectedDecision);
    }
  });

  it("판정에 기여한 URL만 관계 provenance에 기록한다", () => {
    for (const record of records) {
      const relation = relationsSeed.find((item) =>
        item.workId === record.workId && item.placeId === record.placeId,
      );
      expect(relation, record.id).toBeDefined();
      expect(relation?.featuredActorIds, record.id).toContain(record.actorId);
      expect(relation?.actorPresenceVerification, record.id).toMatchObject({
        decision: record.expectedDecision.status,
        ...("grade" in record.expectedDecision ? { grade: record.expectedDecision.grade } : {}),
        evidenceSourceUrls: record.expectedDecision.sourceUrls,
      });
    }
  });

  it("장면 맥락 출처와 자동 판정 적격 출처를 구분한다", () => {
    const [yeongjin] = records;
    const [contextOnly, eligible] = yeongjin.evidence;
    expect(contextOnly.characterActorLinked).toBe(false);
    expect(eligible.characterActorLinked).toBe(true);
    expect(yeongjin.expectedDecision.sourceUrls).toEqual([eligible.sourceUrl]);
  });
});
