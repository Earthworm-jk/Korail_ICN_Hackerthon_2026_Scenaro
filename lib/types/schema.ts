/**
 * 시드 데이터 스키마 — 단일 진실 공급원 (docs/ENGINE_SPEC.md §3, REQ-DATA-004)
 * Python 파이프라인이 생성한 JSON을 앱 기동 시 이 스키마로 검증한다.
 * 스키마 불일치는 런타임 중이 아니라 기동(로드) 단계에서 실패해야 한다.
 */
import { z } from "zod";

// #20: 형식만이 아니라 실제 유효값을 로드 단계에서 강제한다 (의미 검증)
export const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD 형식이어야 합니다")
  .refine((v) => {
    const [y, m, d] = v.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }, "실존하는 날짜여야 합니다");

export const HHmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:mm 형식이어야 합니다");

// PR #29 리뷰(차단): Date.parse는 ISO 전용 파서가 아니어서 날짜 전용·오프셋 누락·실존하지
// 않는 달력 일시까지 통과시킨다. 오프셋 없는 값은 실행 환경 시간대로 해석되어 정렬·출국
// 역산의 결정성을 깨므로, 오프셋(Z 또는 +HH:mm) 포함 실존 ISO 일시만 허용한다.
export const IsoDateTime = z.iso.datetime({
  offset: true,
  error: "오프셋 포함 ISO 일시여야 합니다",
});

// PR #29 리뷰: 빈 문자열 ID·참조는 시드 정규화 전에 로드 단계에서 차단한다
export const NonEmptyId = z.string().min(1, "빈 문자열 ID·참조는 허용되지 않습니다");

// PR #52 리뷰: 출처는 실제 http/https URL만 — 형식 없는 문자열이 출처로 고정되는 것을 차단
export const HttpUrl = z.string().refine((v) => {
  try {
    const url = new URL(v);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}, "http/https URL이어야 합니다");

export const LocalizedText = z.object({ ko: z.string(), en: z.string() });

// 관계 유형은 시드에 저장하지 않고 constraints에서 파생한다 (ENGINE_SPEC §2, PR #9 리뷰)
export const RelationType = z.enum(["selected_work", "actor_other_work"]);

// PR #9 리뷰: 부분 누락을 Zod에서 원천 차단하기 위한 통합 객체
export const AccessEstimate = z.object({
  minutes: z.number().int().positive(), // 양의 정수 (#20)
  source: z.string(),
  verifiedAt: IsoDate,
});

export const Weekday = z.enum(["sun", "mon", "tue", "wed", "thu", "fri", "sat"]);

// #5 최종 결정: 출처 없는 운영시간을 만들지 않는다. unverified는 자동 일정 제외 대상
// #20 의미 검증: MVP 시드는 당일 구간만 허용 — open < close, open <= lastEntry <= close.
// 자정 경과 운영은 임의 해석하지 않고 unverified로 제외한다(추후 명시 필드로 확장).
export const OpeningHours = z
  .discriminatedUnion("type", [
    z.object({
      type: z.literal("always_open"),
      source: z.string(),
      verifiedAt: IsoDate,
    }),
    z.object({
      type: z.literal("hours"),
      open: HHmm,
      close: HHmm,
      lastEntry: HHmm.optional(),
      closedDays: z.array(Weekday).optional(),
      source: z.string(),
      verifiedAt: IsoDate,
    }),
    z.object({ type: z.literal("unverified") }),
  ])
  .superRefine((oh, ctx) => {
    if (oh.type !== "hours") return;
    if (oh.open >= oh.close) {
      ctx.addIssue({ code: "custom", path: ["close"], message: "open < close 여야 합니다" });
    }
    if (oh.lastEntry !== undefined && (oh.lastEntry < oh.open || oh.lastEntry > oh.close)) {
      ctx.addIssue({
        code: "custom",
        path: ["lastEntry"],
        message: "open <= lastEntry <= close 여야 합니다",
      });
    }
  });

export const Actor = z.object({
  id: NonEmptyId,
  name: LocalizedText,
  workIds: z.array(NonEmptyId),
});

export const Work = z.object({
  id: NonEmptyId,
  title: LocalizedText,
  year: z.number().optional(),
});

// #84 P0-4 — 공식 관람시간이 없는 동안 사용하는 서비스 기본 보수 체류시간.
// 의미가 다른 유형은 기본 분 수가 같아도 분리해, 이후 공식 근거를 유형별로 보강할 수 있게 한다.
export const STAY_CATEGORY_DEFAULT_MINUTES = {
  brief_exterior: 45,
  nature_walk: 60,
  food_cafe: 60,
  culture_venue: 60,
  resort_visit: 90,
  large_experience: 120,
} as const;

export const StayCategory = z.enum([
  "brief_exterior",
  "nature_walk",
  "food_cafe",
  "culture_venue",
  "resort_visit",
  "large_experience",
]);

export const CategoryDefaultStayMetadata = z.object({
  category: StayCategory,
  basis: z.literal("category_default"),
});

export const OfficialSourceStayMetadata = z.object({
  category: StayCategory,
  basis: z.literal("official_source"),
  sourceMinutes: z.number().int().positive(),
  sourceScope: LocalizedText,
  source: HttpUrl,
  sourceFormat: z.literal("html"),
  sourceQuote: z.string().min(1),
  sourceLocator: z.string().min(1),
  verifiedAt: IsoDate,
});

export const StayMetadata = z.discriminatedUnion("basis", [
  CategoryDefaultStayMetadata,
  OfficialSourceStayMetadata,
]);

/**
 * 장소의 종류 (#83 §F 썸네일 대체 표기).
 *
 * `stayMetadata.category`와 다른 축이다. 그쪽은 **얼마나 머무는가**(체류시간 산정)이고
 * 이쪽은 **무엇인가**(카드 아이콘)다. 실제로 두 축은 겹치지 않는다 — `brief_exterior`
 * 하나에 호텔·고가 보행로·궁 담장길이 함께 들어 있고, `culture_venue` 하나에 사찰·전각·
 * 전시컨벤션·영화관이 들어 있다. 체류시간 기준으로 아이콘을 고르면 호텔과 돌담길이 같은
 * 그림이 된다.
 *
 * 원천 CSV(`장소타입`)도 그대로 쓸 수 없다. 어휘가 restaurant/cafe/stay/playground 중심이라
 * playground 하나가 해변·사찰·숲길·목장·케이블카·보행로를 전부 삼킨다.
 *
 * 30-50곳 확장(#72)에서 재사용되도록 장소 1:1 라벨이 아니라 종류로 끊었다.
 */
export const PlaceType = z.enum([
  "beach",
  "trail",
  "heritage", // 사찰·전각 등 문화유산 시설
  "walkway",
  "ranch",
  "cable_car",
  "cafe",
  "restaurant",
  "stay", // 호텔·리조트
  "convention",
  "cinema",
  "port",
  "workshop",
  "square",
  "library",
  "bookstore",
  "transit",
  "park",
  "cultural_center",
  "filming_set",
]);

export const Place = z.object({
  id: NonEmptyId,
  name: LocalizedText, // #4: 데모 시드는 en 필수
  workIds: z.array(NonEmptyId), // 관계 유형은 저장하지 않음 — ENGINE_SPEC §2 파생 규칙
  nearestStationId: NonEmptyId,
  accessEstimate: AccessEstimate, // #5: 역→장소 접근시간 추정(왕복 동일 적용 — 역 허브 모델)
  openingHours: OpeningHours,
  stayMinutes: z.number().int().positive(), // 양의 정수 (#20)
  // #84 additive: 엔진 입력은 stayMinutes 그대로다. 시드 로더는 P1부터 메타 존재를 필수 검증한다.
  stayMetadata: StayMetadata.optional(),
  // #83 §F additive — 후보 카드 아이콘용. optional인 이유는 "유형을 확인하지 못한 장소"의
  // 자리를 남기기 위해서다(화면은 기본 아이콘으로 떨어진다). 다만 현재 시드 전수 분류는
  // 테스트가 강제하므로, 빠뜨린 채 조용히 들어오는 것은 막힌다.
  placeType: PlaceType.optional(),
  verificationLevel: z.enum(["원본확인", "교차확인", "TourAPI대조"]),
  officialSourceCount: z.number().int().nonnegative(), // UI 정렬 전용 — 엔진 점수와 분리 (#3)
  reasonText: LocalizedText, // 사전 작성 추천 사유 (REQ-DATA-005)
  // #51 확정(additive — 기존 엔진·시드 무변경): 검토 통과 별칭·주소·좌표.
  // searchAliases는 place-aliases.json(검토 전 산출물)에서 검토 통과분만 수록되는 단방향 (#48)
  searchAliases: z.array(LocalizedText).optional(),
  address: z.string().min(1).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
}).superRefine((place, ctx) => {
  // PR #52 리뷰: 좌표는 동명이소 판단에 한 쌍으로 쓰인다 — 반쪽 좌표가 시드로 고정되는 것을 차단
  if ((place.latitude === undefined) !== (place.longitude === undefined)) {
    ctx.addIssue({
      code: "custom",
      path: [place.latitude === undefined ? "latitude" : "longitude"],
      message: "latitude·longitude는 함께 있어야 합니다 (좌표 쌍)",
    });
  }
  if (
    place.stayMetadata?.basis === "category_default"
    && place.stayMinutes !== STAY_CATEGORY_DEFAULT_MINUTES[place.stayMetadata.category]
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["stayMinutes"],
      message: `stayMetadata.category 기본값(${STAY_CATEGORY_DEFAULT_MINUTES[place.stayMetadata.category]}분)과 일치해야 합니다`,
    });
  }
  if (
    place.stayMetadata?.basis === "official_source"
    && place.stayMinutes !== place.stayMetadata.sourceMinutes
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["stayMinutes"],
      message: `공식 출처 소요시간(${place.stayMetadata.sourceMinutes}분)과 일치해야 합니다`,
    });
  }
});

// #51 확정: 회차·장면·출처는 장소가 아니라 작품–장소 관계에 속한다. 장소는 복제하지 않고
// 같은 placeId에 작품별 관계를 각각 연결한다. 회차 근거가 없으면 episodeLabel을 생략한다.
//
// 장면 출연 배우 3상태 (#51 합의 — 회차 출연 ≠ 장면 출연):
//   ⓐ featuredActorIds: [...] + actorPresenceReviewed: true — 등장이 근거로 확정
//   ⓑ featuredActorIds: []  + actorPresenceReviewed: true — 시드 배우 미등장이 근거로 확정
//   ⓒ 두 필드 모두 생략 — 미검토(모름). "없음-확정"(ⓑ)과 "모름"(ⓒ)을 섞지 않는다.
// reviewed(작품–장소 관계 검토)를 배우 등장 확인으로 확대 해석하지 않는다.
// actorPresenceVerification은 자동·수동 검증의 출처와 등급을 보존하는 additive provenance다.
// 기존 수동 검토 시드는 생략 가능하지만 자동 확정 데이터에는 반드시 기록한다.
export const WorkPlaceRelation = z
  .object({
    workId: NonEmptyId,
    placeId: NonEmptyId,
    episodeLabel: z.string().min(1).optional(), // "1화"·"1–2화"·특별편 — 문자열, 영화는 생략
    sceneNote: LocalizedText.optional(),
    featuredActorIds: z.array(NonEmptyId).optional(), // 장면 등장이 검증된 배우만 (추측 금지)
    // PR #63 리뷰: 미검토(ⓒ)의 표현은 '생략' 하나뿐 — false 명시는 네 번째 상태가 되므로 금지
    actorPresenceReviewed: z.literal(true).optional(),
    actorPresenceVerification: z.object({
      // 근거 추출 방식이 아니라 관계의 최종 검증·승격 방식이다.
      method: z.enum(["manual", "automatic"]),
      grade: z.enum(["A", "B"]),
      decision: z.enum(["confirmed", "absent"]),
      evidenceSourceUrls: z.array(HttpUrl).min(1),
    }).optional(),
    sourceUrls: z.array(HttpUrl).min(1), // 검증 근거 필수 — http/https 형식 검사 (#51, PR #52 리뷰)
    verifiedAt: IsoDate,
    reviewed: z.boolean(),
  })
  .superRefine((relation, ctx) => {
    const reviewed = relation.actorPresenceReviewed === true;
    if (reviewed !== (relation.featuredActorIds !== undefined)) {
      ctx.addIssue({
        code: "custom",
        path: ["featuredActorIds"],
        message:
          "장면 배우 3상태 위반: featuredActorIds는 actorPresenceReviewed:true와 함께만 존재해야 합니다 (ⓐ/ⓑ/ⓒ)",
      });
    }
    if (relation.featuredActorIds) {
      const unique = new Set(relation.featuredActorIds);
      if (unique.size !== relation.featuredActorIds.length) {
        ctx.addIssue({
          code: "custom",
          path: ["featuredActorIds"],
          message: "featuredActorIds에 중복 배우가 있습니다",
        });
      }
    }
    const verification = relation.actorPresenceVerification;
    if (verification) {
      if (!reviewed) {
        ctx.addIssue({
          code: "custom",
          path: ["actorPresenceVerification"],
          message: "배우 등장 검증 provenance는 actorPresenceReviewed:true 관계에만 기록할 수 있습니다",
        });
      }
      const hasFeaturedActors = (relation.featuredActorIds?.length ?? 0) > 0;
      if ((verification.decision === "confirmed") !== hasFeaturedActors) {
        ctx.addIssue({
          code: "custom",
          path: ["actorPresenceVerification", "decision"],
          message: "confirmed는 등장 배우가 있어야 하고 absent는 빈 featuredActorIds여야 합니다",
        });
      }
      const relationSources = new Set(relation.sourceUrls);
      if (verification.evidenceSourceUrls.some((url) => !relationSources.has(url))) {
        ctx.addIssue({
          code: "custom",
          path: ["actorPresenceVerification", "evidenceSourceUrls"],
          message: "검증 근거 URL은 관계 sourceUrls에도 포함되어야 합니다",
        });
      }
    }
  });

// 권역은 역에만 저장하고 장소는 nearestStationId로 파생한다 — 단일 진실 (이슈 #6 8일차 잔여)
export const RegionId = z.enum(["gangwon", "seoul_metro", "honam", "yeongnam"]);

export const Station = z.object({
  id: NonEmptyId,
  name: LocalizedText,
  lineType: z.enum(["KTX", "ITX", "AREX", "일반"]),
  regionId: RegionId,
  isGateway: z.boolean().optional(),
  gatewayPriority: z.number().int().nonnegative().optional(),
  isAirport: z.boolean().optional(),
});

export const TrainLeg = z
  .object({
    trainNo: NonEmptyId,
    fromStationId: NonEmptyId,
    toStationId: NonEmptyId,
    departAt: IsoDateTime,
    arriveAt: IsoDateTime,
  })
  .superRefine((leg, ctx) => {
    if (
      !Number.isNaN(Date.parse(leg.departAt)) &&
      !Number.isNaN(Date.parse(leg.arriveAt)) &&
      Date.parse(leg.departAt) >= Date.parse(leg.arriveAt)
    ) {
      ctx.addIssue({ code: "custom", path: ["arriveAt"], message: "departAt < arriveAt 여야 합니다" });
    }
  });

// #58 — 공항 진입 구간은 TrainLeg로 가장하지 않고 독립 계약으로 보존한다.
// 실제 MVP 데이터는 공항버스지만 목적지·노선명에 종속되지 않는 안정 ID와 왕복 방향을 쓴다.
export const GatewayLeg = z
  .object({
    id: NonEmptyId,
    routeId: NonEmptyId,
    direction: z.enum(["outbound", "inbound"]),
    mode: z.literal("airport_bus"),
    fromStationId: NonEmptyId,
    toStationId: NonEmptyId,
    // 플래너는 권역 앵커 ID를 쓰되 UI는 실제 승하차 터미널명을 표시한다.
    // (예: 강릉시외버스터미널을 강릉역이라고 오표기하지 않음)
    fromName: LocalizedText,
    toName: LocalizedText,
    departAt: IsoDateTime,
    arriveAt: IsoDateTime,
    serviceName: LocalizedText,
    operator: LocalizedText,
    sourceUrls: z.array(HttpUrl).min(1),
    verifiedAt: IsoDate,
    // 당일 API와 공식 예매처를 교차 확인해 고정한 관측 스냅샷이다.
    // 미래 운행 보장으로 오해하지 않도록 UI 재확인 안내를 데이터 계약으로 강제한다.
    scheduleKind: z.literal("observed_snapshot"),
    recheckRequired: z.literal(true),
  })
  .superRefine((leg, ctx) => {
    if (Date.parse(leg.departAt) >= Date.parse(leg.arriveAt)) {
      ctx.addIssue({ code: "custom", path: ["arriveAt"], message: "departAt < arriveAt 여야 합니다" });
    }
  });

export const Flight = z.object({
  flightNo: NonEmptyId,
  direction: z.enum(["arrival", "departure"]),
  scheduledAt: IsoDateTime,
  terminal: z.string().optional(),
});

export type ActorT = z.infer<typeof Actor>;
export type WorkT = z.infer<typeof Work>;
export type PlaceT = z.infer<typeof Place>;
export type StayCategoryT = z.infer<typeof StayCategory>;
export type PlaceTypeT = z.infer<typeof PlaceType>;
export type StationT = z.infer<typeof Station>;
export type TrainLegT = z.infer<typeof TrainLeg>;
export type GatewayLegT = z.infer<typeof GatewayLeg>;
export type FlightT = z.infer<typeof Flight>;
export type WorkPlaceRelationT = z.infer<typeof WorkPlaceRelation>;

// #5: 버퍼는 저장하지 않고 파생한다 — max(20분, 접근시간의 50%)
export function accessBufferMinutes(accessMinutes: number): number {
  return Math.max(20, Math.ceil(accessMinutes * 0.5));
}
