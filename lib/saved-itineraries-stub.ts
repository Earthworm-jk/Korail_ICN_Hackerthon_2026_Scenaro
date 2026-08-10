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
  /**
   * 저장 당시 표시 이름 스냅샷 (#130).
   *
   * 재열람은 후보를 다시 받아 이름을 채우는데, 그 조회가 실패하면 화면이 `place-…`·
   * `station-…` 같은 내부 ID를 그대로 보여 준다. 발표장 네트워크가 끊기면 그대로 노출되는
   * 자리라, 이름을 조회와 무관하게 복원할 수 있도록 저장 시점 값을 함께 담는다.
   *
   * 기존 레코드 호환을 위해 optional이다. 없으면 화면이 현지화된 대체 문구로 떨어진다.
   *
   * **클라우드 경로(`?cloud=1`)에서는 보존되지 않는다.** `saved-itineraries-codec.ts`의
   * `entryToRow`가 `days`·`context`·`warnings`만 담고 이 필드는 넣지 않아, 계정에 저장한 뒤
   * 다시 받으면 사라진다. #130이 로컬 경로의 P0라 이번 범위에서 다루지 않았고, 클라우드를
   * 계속 유지한다면 후속으로 채워야 한다 (PR #133 리뷰).
   */
  displayNames?: DisplayNameSnapshot;
};

/** 화면이 `text[locale]`로 바로 읽는 모양 */
export type LocalizedName = { ko: string; en: string };

/**
 * 표시 이름 스냅샷 (#130).
 *
 * **전체 후보를 담지 않는다** — 이 일정에 실제로 쓰인 것만 담는다.
 *
 * - `places`: `days[].items[].placeId`로 배치된 장소
 * - `stations`: `days[].rides`의 출발·도착역
 *
 * gateway leg는 레코드 자체에 `fromName`·`toName`을 이미 갖고 있어 중복 저장하지 않는다.
 *
 * locale 문자열 하나가 아니라 `{ ko, en }`을 담는 이유는, 재열람 뒤에도 ko/en 전환이
 * 동작해야 하기 때문이다.
 */
export type DisplayNameSnapshot = {
  places: Record<string, LocalizedName>;
  stations: Record<string, LocalizedName>;
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
