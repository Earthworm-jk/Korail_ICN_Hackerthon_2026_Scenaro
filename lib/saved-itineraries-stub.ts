/**
 * 저장 일정 스텁 — Supabase 연결(#25 확정: Auth + PostgreSQL + RLS) 전의 in-memory 표현.
 * 필드는 saved_itineraries 최소 스키마(#25 PRD §6)와 이름을 맞춰 두어 실제 저장 액션으로
 * 교체할 때 UI 변경이 없게 한다. 세션이 끝나면 사라지는 것이 정상이며 UI는 스텁 배지를 단다.
 */
import type { CandidateWarning, DayPlan } from "./engine/types";
import type { PlanRequest } from "./actions/itinerary";
import type { ActorSummary, WorkSummary } from "./actions/search";
import { fromKstLocalInput, toKstLocalInput } from "./kst-datetime";

export const SAVED_SCHEMA_VERSION = 2; // v2: offset → 절대 시각(airportReadyAt·airportArrivalDeadline), #14 차단 2

export type SavedItineraryStub = {
  id: string;
  title: string; // 앱이 기본 제목 자동 생성 (#25 §6)
  savedAt: string; // ISO
  days: DayPlan[]; // 저장 시점 표시용 스냅샷 (#25 §6 itinerary JSON)
  /** 저장 당시 전체 재계산 입력 — 재열람 후 재계산은 반드시 이 값을 복원해 사용한다 (PR #35 리뷰 3) */
  constraints: PlanRequest;
  schemaVersion: number;
  snapshotVersion: string; // 열차·항공 스냅샷 기준 — 재열람 시 버전 불일치 안내 근거
  /** 재열람 시 검색 선택 칩·후보 재조회 복원용 요약 */
  context: { actors: ActorSummary[]; works: WorkSummary[] };
  /** 저장 시점 운영시간 경고 — 재열람에도 경고 누락 0건 유지 (#43, PR #44 리뷰 2).
   *  기존 레코드 호환을 위해 optional이며 없으면 빈 배열로 취급한다. */
  warnings?: CandidateWarning[];
};

/** 여행 조건 입력 필드(1단계 화면 상태) ↔ constraints 왕복 변환 — 재열람 복원의 단일 경로 */
export type TripInputFields = {
  arrivalAt: string; // datetime-local (KST)
  departureAt: string;
  airportReadyAt: string; // datetime-local (KST) — 공항 출발 가능 시각
  airportArrivalDeadline: string; // datetime-local (KST) — 공항 도착 마감 시각
};

export function tripInputsFromConstraints(constraints: PlanRequest): TripInputFields {
  return {
    arrivalAt: toKstLocalInput(constraints.arrivalAt),
    departureAt: toKstLocalInput(constraints.departureAt),
    airportReadyAt: toKstLocalInput(constraints.airportReadyAt),
    airportArrivalDeadline: toKstLocalInput(constraints.airportArrivalDeadline),
  };
}

export function constraintsFromTripInputs(
  inputs: TripInputFields,
  selectedActorIds: string[],
  selectedWorkIds: string[],
  excludedPlaceIds: string[],
): PlanRequest {
  return {
    arrivalAt: fromKstLocalInput(inputs.arrivalAt),
    departureAt: fromKstLocalInput(inputs.departureAt),
    airportReadyAt: fromKstLocalInput(inputs.airportReadyAt),
    airportArrivalDeadline: fromKstLocalInput(inputs.airportArrivalDeadline),
    selectedActorIds,
    selectedWorkIds,
    excludedPlaceIds,
  };
}

const KST = "Asia/Seoul";

function kstDayNumber(iso: string): number {
  const kst = new Date(Date.parse(iso) + 9 * 60 * 60 * 1000);
  return Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) / 86_400_000;
}

function shortDate(iso: string, locale: "ko" | "en"): string {
  return new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", {
    timeZone: KST,
    month: locale === "ko" ? "numeric" : "short",
    day: "numeric",
  }).format(new Date(iso));
}

/**
 * 기본 저장 제목 — 기간·박수·대표 콘텐츠 조합 (#25 §6 "강릉 3박 4일 · 김고은" 규칙의 스텁 버전.
 * 권역명은 엔진 출력에 권역 식별자가 실리는 #33 이후 합류).
 */
export function defaultSavedTitle(
  arrivalAt: string,
  departureAt: string,
  primaryContentName: string | null,
  locale: "ko" | "en",
): string {
  const nights = Math.max(0, kstDayNumber(departureAt) - kstDayNumber(arrivalAt));
  const range = `${shortDate(arrivalAt, locale)}-${shortDate(departureAt, locale)}`;
  const duration = locale === "ko" ? `${nights}박 ${nights + 1}일` : `${nights + 1} days`;
  const base = `${range} · ${duration}`;
  return primaryContentName ? `${base} · ${primaryContentName}` : base;
}
