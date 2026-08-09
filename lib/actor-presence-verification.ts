/**
 * 배우–장면 관계 자동 검증의 결정적 판정기.
 *
 * OpenAI는 웹 검색 결과에서 아래 근거 레코드를 구조화할 수 있지만, 확정 여부를
 * 직접 결정하지 않는다. 출처 등급·명시성·독립 출처 수를 이 함수가 동일하게 판정한다.
 */
export type EvidenceSourceTier = "official" | "editorial" | "community";
export type ActorPresenceClaim = "present" | "absent";

export type ActorPresenceEvidence = {
  sourceUrl: string;
  sourceTier: EvidenceSourceTier;
  placeMatched: boolean;
  workMatched: boolean;
  claim: ActorPresenceClaim;
  /** 출처 문장에 배우명이 직접 등장한다. */
  actorExplicit: boolean;
  /** 출처 문장에 검증된 배역–배우 연결(예: 은탁(김고은))이 등장한다. */
  characterActorLinked: boolean;
};

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
