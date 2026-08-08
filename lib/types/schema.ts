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

export const Place = z.object({
  id: NonEmptyId,
  name: LocalizedText, // #4: 데모 시드는 en 필수
  workIds: z.array(NonEmptyId), // 관계 유형은 저장하지 않음 — ENGINE_SPEC §2 파생 규칙
  nearestStationId: NonEmptyId,
  accessEstimate: AccessEstimate, // #5: 역→장소 접근시간 추정(왕복 동일 적용 — 역 허브 모델)
  openingHours: OpeningHours,
  stayMinutes: z.number().int().positive(), // 양의 정수 (#20)
  verificationLevel: z.enum(["원본확인", "교차확인", "TourAPI대조"]),
  officialSourceCount: z.number().int().nonnegative(), // UI 정렬 전용 — 엔진 점수와 분리 (#3)
  reasonText: LocalizedText, // 사전 작성 추천 사유 (REQ-DATA-005)
});

// 권역은 역에만 저장하고 장소는 nearestStationId로 파생한다 — 단일 진실 (이슈 #6 8일차 잔여)
export const RegionId = z.enum(["gangwon", "seoul_metro", "honam"]);

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

export const Flight = z.object({
  flightNo: NonEmptyId,
  direction: z.enum(["arrival", "departure"]),
  scheduledAt: IsoDateTime,
  terminal: z.string().optional(),
});

export type ActorT = z.infer<typeof Actor>;
export type WorkT = z.infer<typeof Work>;
export type PlaceT = z.infer<typeof Place>;
export type StationT = z.infer<typeof Station>;
export type TrainLegT = z.infer<typeof TrainLeg>;
export type FlightT = z.infer<typeof Flight>;

// #5: 버퍼는 저장하지 않고 파생한다 — max(20분, 접근시간의 50%)
export function accessBufferMinutes(accessMinutes: number): number {
  return Math.max(20, Math.ceil(accessMinutes * 0.5));
}
