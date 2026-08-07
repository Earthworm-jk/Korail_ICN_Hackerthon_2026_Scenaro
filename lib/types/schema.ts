/**
 * 시드 데이터 스키마 — 단일 진실 공급원 (docs/ENGINE_SPEC.md §3, REQ-DATA-004)
 * Python 파이프라인이 생성한 JSON을 앱 기동 시 이 스키마로 검증한다.
 * 스키마 불일치는 런타임 중이 아니라 기동(로드) 단계에서 실패해야 한다.
 */
import { z } from "zod";

export const LocalizedText = z.object({ ko: z.string(), en: z.string() });

// #3 최종 결정: 시드에는 점수가 아니라 관계 유형을 저장, 점수는 엔진 상수에서 파생
export const RelationType = z.enum(["selected_work", "actor_other_work"]);

// #5 최종 결정: 출처 없는 운영시간을 만들지 않는다. unverified는 자동 일정 제외 대상
export const OpeningHours = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("always_open"),
    source: z.string(),
    verifiedAt: z.string(),
  }),
  z.object({
    type: z.literal("hours"),
    open: z.string(), // HH:mm
    close: z.string(),
    lastEntry: z.string().optional(),
    closedDays: z.array(z.string()).optional(),
    source: z.string(),
    verifiedAt: z.string(),
  }),
  z.object({ type: z.literal("unverified") }),
]);

export const Actor = z.object({
  id: z.string(),
  name: LocalizedText,
  workIds: z.array(z.string()),
});

export const Work = z.object({
  id: z.string(),
  title: LocalizedText,
  year: z.number().optional(),
});

export const Place = z.object({
  id: z.string(),
  name: LocalizedText, // #4: 데모 시드는 en 필수
  workIds: z.array(z.string()),
  relationType: RelationType,
  nearestStationId: z.string(),
  accessMinutes: z.number(), // #5: 역→장소 접근시간 추정
  accessSource: z.string(),
  accessVerifiedAt: z.string(),
  openingHours: OpeningHours,
  stayMinutes: z.number(),
  verificationLevel: z.enum(["원본확인", "교차확인", "TourAPI대조"]),
  officialSourceCount: z.number(), // UI 정렬 전용 — 엔진 점수와 분리 (#3)
  reasonText: LocalizedText, // 사전 작성 추천 사유 (REQ-DATA-005)
});

export const Station = z.object({
  id: z.string(),
  name: LocalizedText,
  lineType: z.enum(["KTX", "ITX", "일반"]),
});

export const TrainLeg = z.object({
  trainNo: z.string(),
  fromStationId: z.string(),
  toStationId: z.string(),
  departAt: z.string(), // ISO
  arriveAt: z.string(),
});

export const Flight = z.object({
  flightNo: z.string(),
  direction: z.enum(["arrival", "departure"]),
  scheduledAt: z.string(),
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
