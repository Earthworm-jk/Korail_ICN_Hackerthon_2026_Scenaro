/**
 * 배우–장면 관계 자동 검증의 결정적 판정기.
 *
 * OpenAI는 웹 검색 결과에서 아래 근거 레코드를 구조화한다. 장소·작품 일치와 명시성도
 * 모델 추출값이므로 판단이 완전히 제거되지는 않는다. 이 함수는 그 판단의 결합 방식을
 * 출처 등급·명시성·독립 출처 수 규칙으로 제한하고 동일 입력을 결정적으로 재생한다.
 */
import { z } from "zod";

export type EvidenceSourceTier = "official" | "editorial" | "community";
export type ActorPresenceClaim = "present" | "absent";
export type EvidenceExtractionMethod = "rule_based" | "model_assisted" | "manual";

export const ActorPresenceEvidenceSchema = z.object({
  sourceUrl: z.url(),
  sourceTier: z.enum(["official", "editorial", "community"]),
  /** 원문에서 판정 필드를 다시 감사할 수 있는 짧은 근거 문장. */
  excerpt: z.string().min(1),
  placeMatched: z.boolean(),
  workMatched: z.boolean(),
  claim: z.enum(["present", "absent"]),
  /** 출처 문장에 배우명이 직접 등장한다. */
  actorExplicit: z.boolean(),
  /** 출처 문장에 배역–배우 연결(예: 은탁(김고은))이 등장한다. */
  characterActorLinked: z.boolean(),
});

export type ActorPresenceEvidence = z.infer<typeof ActorPresenceEvidenceSchema>;

export const ActorPresenceEvidenceRecordSchema = z.object({
  id: z.string().min(1),
  workId: z.string().min(1),
  placeId: z.string().min(1),
  actorId: z.string().min(1),
  extractedAt: z.iso.date(),
  /** 근거 필드를 구조화한 방식. 관계의 최종 검증·승격 방식과는 별개다. */
  extractionMethod: z.enum(["rule_based", "model_assisted", "manual"]),
  evidence: z.array(ActorPresenceEvidenceSchema).min(1),
  expectedDecision: z.discriminatedUnion("status", [
    z.object({
      status: z.enum(["confirmed", "absent"]),
      grade: z.enum(["A", "B"]),
      sourceUrls: z.array(z.url()).min(1),
    }),
    z.object({
      status: z.enum(["unverified", "conflict"]),
      sourceUrls: z.array(z.url()),
    }),
  ]),
});

export type ActorPresenceEvidenceRecord = z.infer<typeof ActorPresenceEvidenceRecordSchema>;

export type ActorPresenceDecision =
  | { status: "confirmed" | "absent"; grade: "A" | "B"; sourceUrls: string[] }
  | { status: "unverified" | "conflict"; sourceUrls: string[] };

function hostnameOf(sourceUrl: string): string | null {
  try {
    return new URL(sourceUrl).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function isExplicit(evidence: ActorPresenceEvidence): boolean {
  return evidence.actorExplicit || evidence.characterActorLinked;
}

/**
 * A: 공식 출처 1개가 장소·작품·배우(또는 배역–배우)를 명시.
 * B: 서로 다른 도메인의 편집 출처 2개 이상이 같은 사실을 명시.
 * 커뮤니티 출처, 작품명만 있는 근거, 상충 근거는 자동 확정하지 않는다.
 */
export function decideActorPresence(
  evidence: ActorPresenceEvidence[],
): ActorPresenceDecision {
  const eligible = evidence.filter((item) =>
    item.placeMatched
    && item.workMatched
    && isExplicit(item)
    && item.sourceTier !== "community"
    && hostnameOf(item.sourceUrl) !== null,
  );

  const present = eligible.filter((item) => item.claim === "present");
  const absent = eligible.filter((item) => item.claim === "absent");
  const sourceUrls = [...new Set(eligible.map((item) => item.sourceUrl))].sort();

  if (present.length > 0 && absent.length > 0) {
    return { status: "conflict", sourceUrls };
  }

  const matching = present.length > 0 ? present : absent;
  if (matching.length === 0) return { status: "unverified", sourceUrls };

  const status = present.length > 0 ? "confirmed" : "absent";
  if (matching.some((item) => item.sourceTier === "official")) {
    return { status, grade: "A", sourceUrls };
  }

  const editorialDomains = new Set(
    matching
      .filter((item) => item.sourceTier === "editorial")
      .map((item) => hostnameOf(item.sourceUrl))
      .filter((domain): domain is string => domain !== null),
  );
  if (editorialDomains.size >= 2) {
    return { status, grade: "B", sourceUrls };
  }

  return { status: "unverified", sourceUrls };
}
