"use client";
/**
 * 4단계 위저드 골격 — 여행 조건 → K-콘텐츠 → 촬영지 → 일정 결과 (ver.0.3·#14 ver.0.4 확정)
 * - 배우·작품 복수 선택 칩, 필수 방문 없음(전부 자유 선택), 방문지별 시각 미표기(역 단위 체류)
 * - 편집 = 촬영지 재선택·항공 시각 변경 후 전체 재계산 (무상태)
 * - 대안 시간표는 mock(#14 ⑨ 선행), 저장·내 일정은 in-memory 스텁(#25 선행) — 엔진·Supabase 연결 시 교체
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { searchEntities, type ActorSummary, type WorkSummary } from "@/lib/actions/search";
import {
  getCandidatePlaces,
  type CandidateResponse,
  type PlaceCandidate,
} from "@/lib/actions/places";
import { planItinerary } from "@/lib/actions/itinerary";
import { excludedPlaceIdsFrom, initialCandidateIds, initialSelectedIds, splitByActorPresence } from "@/lib/candidates";
import { sortCandidatePlaces } from "@/lib/place-ranking";
import { getFlightInfo } from "@/lib/actions/flights";
import { t, type Locale, type MessageKey } from "@/lib/i18n/messages";
import { buildMockAlternatives, type MockAlternative } from "@/lib/alternatives-mock";
import {
  constraintsFromTripInputs,
  defaultSavedTitle,
  SAVED_SCHEMA_VERSION,
  tripInputsFromConstraints,
  type SavedItineraryStub,
} from "@/lib/saved-itineraries-stub";
import {
  banner,
  displayedDays as deriveDisplayedDays,
  initialItineraryView,
  itineraryWarnings as deriveWarnings,
  recommendedDays,
  reduceItineraryView,
  rejectedPlaces as deriveRejectedPlaces,
  showEmpty,
} from "@/lib/itinerary-view";
import { fromKstLocalInput as fromLocalInput, toKstLocalInput as toLocalInput } from "@/lib/kst-datetime";
import { formatFlightStatus } from "@/lib/flight-status";
import { formatEpisodeLabel } from "@/lib/episode-label";
import { AlternativeTimetables } from "./alternative-timetables";
import { AuthModal, TripsModal, useSaveStub, type SaveStatus } from "./save-stub";
import { ExecutionSupport } from "./execution-support";
import { ThemeExperienceCard } from "./theme-experience";
import { getThemeExperience, type ThemeExperienceResult } from "@/lib/actions/theme-experience";
import type { StationFacilitiesSnapshotT } from "@/lib/station-facilities";
import type { DayPlan } from "@/lib/engine/types";

const KST = "Asia/Seoul";

// PR #35 리뷰 2: mock 대안은 실사용 경로에 노출하지 않는다 — 기본 비활성 개발 플래그
const SHOW_ALT_MOCK = process.env.NEXT_PUBLIC_ALT_TIMETABLE_MOCK === "1";

function fmtTime(iso: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: KST, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(iso));
}

type FlightField = {
  flightNo: string;
  at: string; // "YYYY-MM-DDTHH:mm" (KST) — 위젯 교체 후에도 직렬화 형식 유지 (#14)
  notFound: boolean;
  source?: "live" | "snapshot"; // 조회 출처 — 폴백 여부 표시 (API_SPEC 2.1)
  status?: string; // 운항 상태 문구 — live 조회 시
};

const STEPS: MessageKey[] = ["nav.step1", "nav.step2", "nav.step3", "nav.step4"];

/** #80 카드의 "OO 권역 일정과 연결" 문구 — 추천 권역과 같은 권역의 첫 일정 역 */
function themeStationLabel(
  days: DayPlan[],
  result: ThemeExperienceResult | null,
  stationName: (id: string) => string,
): string | null {
  if (result?.status !== "ok") return null;
  const window = days.flatMap((day) => day.regionWindows).find((w) => w.regionId === result.regionId);
  return window ? stationName(window.stationId) : null;
}

// #14 합의(2026-08-08): datetime-local은 시각 표기가 앱 locale이 아니라 브라우저 UI 언어를
// 따라 영어 모드에 '오전/오후'가 남는다 — 날짜 input + 24시간제 시/분 select로 교체 (A6).
// 값 형식("YYYY-MM-DDTHH:mm" KST)·검증·touched 규칙은 그대로다.
const pad2 = (n: number) => String(n).padStart(2, "0");
const HOURS = Array.from({ length: 24 }, (_, i) => pad2(i));
const MINUTES = Array.from({ length: 60 }, (_, i) => pad2(i));

function DateTimeField({ value, onChange, className }: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const [date = "", time = ""] = value.split("T");
  const [hour = "00", minute = "00"] = time.split(":");
  const emit = (d: string, h: string, m: string) => onChange(d ? `${d}T${h}:${m}` : "");
  return (
    <div className={`flex items-center gap-1.5 ${className ?? ""}`}>
      <input
        type="date"
        className="min-w-0 flex-1 rounded border px-2 py-1 text-sm"
        value={date}
        onChange={(e) => emit(e.target.value, hour, minute)}
      />
      <select
        className="rounded border px-1.5 py-1 text-sm"
        value={hour}
        onChange={(e) => emit(date, e.target.value, minute)}
      >
        {HOURS.map((h) => <option key={h} value={h}>{h}</option>)}
      </select>
      <span className="text-sm text-sc-muted/70">:</span>
      <select
        className="rounded border px-1.5 py-1 text-sm"
        value={minute}
        onChange={(e) => emit(date, hour, e.target.value)}
      >
        {MINUTES.map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
    </div>
  );
}

// #14 v0.6 sc-summary — 선택 요약 사이드바 (2단계 디자인 패스, 표시 전용·상태 재해석 없음)
function fmtMonthDay(at: string): string {
  const [date] = at.split("T");
  const [, month, day] = date.split("-");
  return `${Number(month)}.${Number(day)}`;
}

function SummarySidebar({ arrivalAt, departureAt, readyAt, deadlineAt, actors, works, placeCount, locale, tr }: {
  arrivalAt: string;
  departureAt: string;
  readyAt: string;
  deadlineAt: string;
  actors: ActorSummary[];
  works: WorkSummary[];
  placeCount: number;
  locale: Locale;
  tr: (key: MessageKey) => string;
}) {
  const nights = Math.max(0, Math.round(
    (Date.parse(departureAt.split("T")[0]) - Date.parse(arrivalAt.split("T")[0])) / 86_400_000,
  ));
  const nightsLabel = tr("summary.nights")
    .replace("{n}", String(nights))
    .replace("{d}", String(nights + 1));
  const hasContent = actors.length > 0 || works.length > 0;
  return (
    <aside aria-label={tr("summary.title")} className="border-b bg-sc-subtle px-5 py-4 md:border-b-0 md:border-r md:px-4 md:py-5">
      <h3 className="text-sm font-medium">{tr("summary.title")}</h3>
      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-1 md:gap-4">
        <div>
          <span className="block text-xs text-sc-muted">{tr("summary.period")}</span>
          <strong className="mt-0.5 block text-sm font-medium">
            {fmtMonthDay(arrivalAt)}–{fmtMonthDay(departureAt)} · {nightsLabel}
          </strong>
        </div>
        <div>
          <span className="block text-xs text-sc-muted">{tr("summary.window")}</span>
          <strong className="mt-0.5 block text-sm font-medium">
            {fmtMonthDay(readyAt)} {readyAt.split("T")[1]}–{fmtMonthDay(deadlineAt)} {deadlineAt.split("T")[1]}
          </strong>
        </div>
        <div>
          <span className="block text-xs text-sc-muted">{tr("summary.content")}</span>
          {hasContent ? (
            <div className="mt-1 flex flex-wrap gap-1.5">
              {actors.map((a) => (
                <span key={a.id} className="rounded-full bg-sc-blue-soft px-2 py-0.5 text-xs text-sc-blue">{a.name[locale]}</span>
              ))}
              {works.map((w) => (
                <span key={w.id} className="rounded-full bg-sc-airport-soft px-2 py-0.5 text-xs text-sc-airport-text">{w.title[locale]}</span>
              ))}
            </div>
          ) : (
            <strong className="mt-0.5 block text-sm font-medium text-sc-muted/70">—</strong>
          )}
        </div>
        <div>
          <span className="block text-xs text-sc-muted">{tr("summary.places")}</span>
          <strong className="mt-0.5 block text-sm font-medium">
            {placeCount > 0
              ? tr("summary.placesCount").replace("{n}", String(placeCount))
              : <span className="text-sc-muted/70">—</span>}
          </strong>
        </div>
      </div>
    </aside>
  );
}

export default function PlannerWizard({ stationFacilities }: {
  stationFacilities: StationFacilitiesSnapshotT;
}) {
  const [locale, setLocale] = useState<Locale>("ko");
  const [step, setStep] = useState(1);
  const tr = useCallback((key: MessageKey) => t(locale, key), [locale]);

  // step 1 — 여행 조건
  const [arrival, setArrival] = useState<FlightField>({ flightNo: "", at: "2026-08-12T10:00", notFound: false });
  const [departure, setDeparture] = useState<FlightField>({ flightNo: "", at: "2026-08-14T18:00", notFound: false });
  // #14 차단 2: 주 입력은 절대 시각 — 항공편 시각에서 파생한 기본 제안값을 두되,
  // 사용자가 직접 수정하면(touched) 항공편 변경에도 덮어쓰지 않는다.
  // 파생 여유는 #3 확정 기본값 유지: 입국 +120분, 출국 안전 버퍼 120분(PRD §8.1) — 표현만 절대 시각
  const [airportReady, setAirportReady] = useState({ at: "2026-08-12T12:00", touched: false });
  const [airportDeadline, setAirportDeadline] = useState({ at: "2026-08-14T16:00", touched: false });

  const deriveLocal = (at: string, minutes: number) =>
    toLocalInput(new Date(Date.parse(fromLocalInput(at)) + minutes * 60_000).toISOString());

  const setArrivalAtInput = useCallback((at: string) => {
    setArrival((f) => ({ ...f, at }));
    if (at) setAirportReady((r) => (r.touched ? r : { ...r, at: deriveLocal(at, 120) }));
  }, []);
  const setDepartureAtInput = useCallback((at: string) => {
    setDeparture((f) => ({ ...f, at }));
    if (at) setAirportDeadline((d) => (d.touched ? d : { ...d, at: deriveLocal(at, -120) }));
  }, []);

  // step 2 — 검색·복수 선택
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ actors: ActorSummary[]; works: WorkSummary[] }>({ actors: [], works: [] });
  const [searched, setSearched] = useState(false);
  const [selectedActors, setSelectedActors] = useState<ActorSummary[]>([]);
  const [selectedWorks, setSelectedWorks] = useState<WorkSummary[]>([]);

  // step 3 — 후보·선택
  const [candidateData, setCandidateData] = useState<CandidateResponse | null>(null);
  const [selectedPlaceIds, setSelectedPlaceIds] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<"relevance" | "official">("relevance");

  // step 4 — 결과. 전이 규칙·파생은 lib/itinerary-view 순수 함수로 고정 (PR #35 리뷰 3)
  const [view, dispatchView] = useReducer(reduceItineraryView, initialItineraryView);

  // #80 테마체험 권역 — 일정이 확정된 시점(생성 성공·재열람)에만 조회한다.
  // 입력은 표시 중인 일정의 권역과 선택 작품뿐이며, 런타임 OpenAI 호출은 없다.
  const [themeExperience, setThemeExperience] = useState<ThemeExperienceResult | null>(null);
  // PR #82 리뷰 비차단 — 연속 재계산에서 먼저 보낸 요청의 늦은 응답이 최신 화면을 덮지 않게
  // 요청 순번을 붙이고, 자기 순번이 아니면 응답을 버린다.
  const themeRequestRef = useRef(0);
  const refreshThemeExperience = useCallback(async (days: DayPlan[] | null, workIds: string[]) => {
    const seq = ++themeRequestRef.current;
    const regionIds = [
      ...new Set((days ?? []).flatMap((day) => day.regionWindows.map((w) => w.regionId))),
    ];
    if (regionIds.length === 0 || workIds.length === 0) { setThemeExperience(null); return; }
    try {
      const result = await getThemeExperience({ selectedWorkIds: workIds, itineraryRegionIds: regionIds });
      if (seq === themeRequestRef.current) setThemeExperience(result);
    } catch {
      // 조회 실패도 계약 상태로 표현한다 — 검증 결과를 제시할 수 없다는 뜻은 '추천 불가'와 같다
      if (seq === themeRequestRef.current) setThemeExperience({ status: "unavailable" });
    }
  }, []);

  // 재열람 = 화면 교체가 아니라 저장 당시 조건의 복원 (PR #35 리뷰 3)
  // 입력·선택·후보 컨텍스트를 constraints에서 되살려, 이후 재계산이 저장 당시 조건으로 돈다
  const reopenRecord = useCallback(async (record: SavedItineraryStub) => {
    const c = record.constraints;
    const inputs = tripInputsFromConstraints(c);
    setArrival((f) => ({ ...f, at: inputs.arrivalAt }));
    setDeparture((f) => ({ ...f, at: inputs.departureAt }));
    // 저장 당시 절대 시각을 그대로 복원 — 이후 항공편 변경이 파생 기본값으로 덮지 않게 touched 고정
    setAirportReady({ at: inputs.airportReadyAt, touched: true });
    setAirportDeadline({ at: inputs.airportArrivalDeadline, touched: true });
    setSelectedActors(record.context.actors);
    setSelectedWorks(record.context.works);
    const data = await getCandidatePlaces({
      selectedActorIds: c.selectedActorIds,
      selectedWorkIds: c.selectedWorkIds,
    });
    setCandidateData(data);
    const excluded = new Set(c.excludedPlaceIds);
    // 재열람에는 배우 필터 초기 미선택(#65 리뷰 2)을 적용하지 않는다 — 저장 당시 선택
    // (excluded의 여집합)이 단일 기준이라, 사용자가 직접 담았던 별도 구분 후보를 잃지 않는다
    setSelectedPlaceIds(new Set(initialCandidateIds(data.candidates).filter((id) => !excluded.has(id))));
    dispatchView({ type: "REOPEN", record });
    void refreshThemeExperience(record.days, c.selectedWorkIds);
    setStep(4);
  }, [refreshThemeExperience]);

  const saveStub = useSaveStub((record) => {
    void reopenRecord(record);
  });

  const lookup = useCallback(async (direction: "arrival" | "departure") => {
    const field = direction === "arrival" ? arrival : departure;
    const setField = direction === "arrival" ? setArrival : setDeparture;
    if (!field.flightNo.trim()) return;
    const res = await getFlightInfo(field.flightNo, direction, field.at); // 날짜부 → searchday (#46)
    if (res.ok) {
      setField({ ...field, notFound: false, source: res.source, status: res.flight.status });
      // live 조회는 변경(예상) 시각이 있으면 그 값을 쓴다 — 예선 약속(지연 반영) 서사
      (direction === "arrival" ? setArrivalAtInput : setDepartureAtInput)(
        toLocalInput(res.flight.estimatedAt ?? res.flight.scheduledAt),
      );
    } else {
      setField({ ...field, notFound: true, source: undefined, status: undefined });
    }
  }, [arrival, departure, setArrivalAtInput, setDepartureAtInput]);

  // #78 P1 — LLM 보조는 결정적 검색 0건일 때 서버에서만 실행된다.
  // 타이핑 중 중간 문자열마다 외부 호출하지 않도록 300ms 디바운스하고, 취소된 요청의 응답은 버린다.
  useEffect(() => {
    const value = query.trim();
    if (!value) return;
    let active = true;
    const timer = window.setTimeout(() => {
      void searchEntities(value).then((next) => {
        if (!active) return;
        setResults(next);
        setSearched(true);
      }).catch(() => {
        if (!active) return;
        setResults({ actors: [], works: [] });
        setSearched(true);
      });
    }, 300);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [query]);

  const loadCandidates = useCallback(async () => {
    const data = await getCandidatePlaces({
      selectedActorIds: selectedActors.map((a) => a.id),
      selectedWorkIds: selectedWorks.map((w) => w.id),
    });
    setCandidateData(data);
    // #43(운영시간 미확인 포함 전체 선택)은 유지하되, 배우 선택 모드의 미등장·미확인 장면
    // 후보(#51 별도 구분)는 초기 미선택 — 사용자가 별도 영역에서 직접 선택 (PR #65 리뷰 2)
    setSelectedPlaceIds(new Set(
      initialSelectedIds(data.candidates, new Set(selectedActors.map((a) => a.id))),
    ));
    setStep(3);
  }, [selectedActors, selectedWorks]);

  /** 현재 입력 상태의 전체 재계산 constraints — 저장 레코드와 plan 호출이 같은 값을 쓴다 */
  const currentConstraints = useCallback(() => {
    if (!candidateData) return null;
    return constraintsFromTripInputs(
      { arrivalAt: arrival.at, departureAt: departure.at, airportReadyAt: airportReady.at, airportArrivalDeadline: airportDeadline.at },
      selectedActors.map((a) => a.id),
      selectedWorks.map((w) => w.id),
      excludedPlaceIdsFrom(candidateData.candidates, selectedPlaceIds),
    );
  }, [candidateData, selectedPlaceIds, arrival.at, departure.at, airportReady.at, airportDeadline.at, selectedActors, selectedWorks]);

  const plan = useCallback(async () => {
    const constraints = currentConstraints();
    if (!constraints) return;
    dispatchView({ type: "PLAN_START" });
    setThemeExperience(null);
    setStep(4);
    try {
      const res = await planItinerary(constraints);
      if (res.ok) {
        dispatchView({ type: "PLAN_SUCCESS", result: res.result });
        saveStub.markDirty();
        if (res.result.status === "planned") {
          void refreshThemeExperience(res.result.days, constraints.selectedWorkIds);
        }
      } else dispatchView({ type: "PLAN_INVALID" }); // 1단계 검증을 우회한 요청 — 기존 결과 유지
    } catch {
      dispatchView({ type: "PLAN_FAILED" }); // 네트워크·서버 장애 — 기존 결과 유지
    }
  }, [currentConstraints, saveStub, refreshThemeExperience]);

  const baseDays = recommendedDays(view);
  const mockAlternatives = useMemo(
    () => (SHOW_ALT_MOCK && baseDays ? buildMockAlternatives(baseDays) : []),
    [baseDays],
  );
  const displayedDays = deriveDisplayedDays(view);
  const viewBanner = banner(view);
  const viewRejected = deriveRejectedPlaces(view);
  const viewWarnings = deriveWarnings(view);

  const chooseAlternative = useCallback((alt: MockAlternative | null) => {
    dispatchView({ type: "SELECT_ALT", alt });
    saveStub.markDirty();
  }, [saveStub]);

  const savedEntry = useCallback((): Omit<SavedItineraryStub, "id" | "savedAt"> | null => {
    if (!displayedDays) return null;
    // 재열람 중 재저장은 저장 당시 조건을 그대로 보존한다
    const constraints = view.reopened?.constraints ?? currentConstraints();
    if (!constraints) return null;
    const context = view.reopened?.context ?? { actors: selectedActors, works: selectedWorks };
    // 재저장도 재열람 보존 규칙과 동일 — 저장 당시 경고를 잃지 않는다 (#43 경고 누락 0건)
    const warnings = view.reopened?.warnings
      ?? (view.result?.status === "planned" ? view.result.warnings : []);
    const primaryContent =
      context.actors[0]?.name[locale] ?? context.works[0]?.title[locale] ?? null;
    return {
      title: defaultSavedTitle(constraints.arrivalAt, constraints.departureAt, primaryContent, locale),
      days: displayedDays,
      constraints,
      schemaVersion: SAVED_SCHEMA_VERSION,
      snapshotVersion: "unversioned", // 시드 기준일 필드(#6 8/9 작업) 합류 시 교체
      context,
      warnings,
    };
  }, [displayedDays, view.reopened, view.result, currentConstraints, selectedActors, selectedWorks, locale]);

  const SAVE_STATUS_KEY: Record<SaveStatus, MessageKey> = {
    none: "save.statusNone",
    dirty: "save.statusDirty",
    saved: "save.statusSaved",
    error: "save.statusError",
  };

  const sortedCandidates = useMemo(() => {
    if (!candidateData) return [];
    // #48 정렬 연결 — 서버가 파생한 aiRank(선택 관련 작품 범위)만 사용, 없으면 관계·출처·ID 폴백
    return sortCandidatePlaces(candidateData.candidates, sortBy === "relevance" ? "relevance" : "official_sources");
  }, [candidateData, sortBy]);

  // #51 배우 선택 필터 — 등장 확정·작품 유래는 기본 목록, 미등장·미확인은 별도 구분(선택은 가능)
  const candidateGroups = useMemo(
    () => splitByActorPresence(sortedCandidates, new Set(selectedActors.map((a) => a.id))),
    [sortedCandidates, selectedActors],
  );

  // #33 — availableMinutes 포맷 전용 (재계산 금지)
  const availableLabel = (minutes: number) => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    const duration = hours > 0
      ? `${hours}${tr("region.hours")}${mins > 0 ? ` ${mins}${tr("region.minutes")}` : ""}`
      : `${mins}${tr("region.minutes")}`;
    return `${tr("region.about")} ${duration} ${tr("region.available")}`;
  };


  // PR #59 리뷰 1 — 엔진은 분 값만 내리고 라벨은 locale로 조합한다 (REQ-ITIN-006)
  const accessLabel = (minutes: number) =>
    `${tr("region.about")} ${minutes}${tr("region.minutes")} · ${tr("itinerary.estimateLabel")}`;

  const stationName = (id: string) =>
    candidateData?.stations.find((s) => s.id === id)?.name[locale] ?? id;
  const placeName = (id: string) =>
    candidateData?.candidates.find((c) => c.id === id)?.name[locale] ?? id;
  const workTitles = (ids: string[]) =>
    ids.map((id) => candidateData?.works.find((w) => w.id === id)?.title[locale] ?? id).join(" · ");

  const toggleChip = <T extends { id: string }>(list: T[], set: (v: T[]) => void, item: T) => {
    set(list.some((x) => x.id === item.id) ? list.filter((x) => x.id !== item.id) : [...list, item]);
  };

  // PR #30 리뷰 ③ + #14 차단 2: 필수값·입출국 순서·공항 경계 순서를 1단계에서 막는다
  const ms = (at: string) => Date.parse(fromLocalInput(at));
  const step1Error: MessageKey | null =
    !arrival.at || !departure.at || !airportReady.at || !airportDeadline.at
      ? "step1.errRequired"
      : ms(departure.at) <= ms(arrival.at)
        ? "step1.errOrder"
        : ms(airportReady.at) < ms(arrival.at)
          ? "step1.errReadyRange"
          : ms(airportDeadline.at) > ms(departure.at) || ms(airportDeadline.at) <= ms(airportReady.at)
            ? "step1.errDeadlineRange"
            : null;
  const readySlackMin =
    arrival.at && airportReady.at ? Math.round((ms(airportReady.at) - ms(arrival.at)) / 60_000) : null;
  const deadlineSlackMin =
    departure.at && airportDeadline.at ? Math.round((ms(departure.at) - ms(airportDeadline.at)) / 60_000) : null;

  return (
    // #14 v0.6 시안 — 페이지는 subtle 배경, 앱은 라운드 카드(sc-app)
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <div className="overflow-hidden rounded-2xl border bg-sc-surface shadow-[0_18px_50px_var(--sc-shadow)]">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-sc-surface px-5 py-4">
        <div className="flex items-center gap-2.5">
          <span aria-hidden className="grid h-9 w-9 place-items-center rounded-[10px] bg-sc-blue text-sm font-medium text-white">SC</span>
          <div>
            <h1 className="text-lg font-semibold tracking-wide">{tr("app.title")}</h1>
            <p className="mt-0.5 text-xs text-sc-muted">{tr("app.tagline")}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-sc-orange-soft px-2.5 py-1 text-xs text-sc-orange-text">{tr("app.snapshotBadge")}</span>
          <button className="rounded-[10px] border px-3 py-1.5 text-sm font-medium hover:border-sc-blue" onClick={saveStub.requestTrips}>
            {tr("trips.button")}
          </button>
          <button
            className="rounded-[10px] border px-3 py-1.5 text-sm font-medium hover:border-sc-blue"
            onClick={() => setLocale(locale === "ko" ? "en" : "ko")}
          >
            {locale === "ko" ? "EN" : "한국어"}
          </button>
        </div>
      </header>

      <nav className="grid grid-cols-4 border-b bg-sc-subtle text-center text-sm">
        {STEPS.map((key, i) => (
          <div
            key={key}
            aria-current={step === i + 1 ? "step" : undefined}
            className={`flex min-h-[52px] items-center justify-center gap-2 border-r px-1 last:border-r-0 ${step === i + 1 ? "bg-sc-blue-soft font-medium text-sc-blue" : "text-sc-muted"}`}
          >
            <span aria-hidden className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-current text-xs">{i + 1}</span>
            <span className="truncate">{tr(key)}</span>
          </div>
        ))}
      </nav>

      {/* #14 v0.6 sc-layout — 좌측 선택 요약 + 본문 (md 미만은 상단 밴드) */}
      <div className="grid md:grid-cols-[220px_minmax(0,1fr)]">
      <SummarySidebar
        arrivalAt={arrival.at}
        departureAt={departure.at}
        readyAt={airportReady.at}
        deadlineAt={airportDeadline.at}
        actors={selectedActors}
        works={selectedWorks}
        placeCount={selectedPlaceIds.size}
        locale={locale}
        tr={tr}
      />
      <div className="min-w-0 p-5 sm:p-6">

      {step === 1 && (
        <section>
          <h2 className="text-lg font-semibold">{tr("step1.title")}</h2>
          <p className="text-sm text-sc-muted">{tr("step1.subtitle")}</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {([
              ["arrival", arrival, setArrival] as const,
              ["departure", departure, setDeparture] as const,
            ]).map(([direction, field, setField]) => (
              <div key={direction} className="rounded-lg border p-4">
                <h3 className="font-medium">
                  {tr(direction === "arrival" ? "step1.arrival" : "step1.departure")}
                  <span className="ml-2 rounded bg-sc-airport-soft px-1.5 py-0.5 text-xs text-sc-airport-text">ICN</span>
                </h3>
                <label className="mt-3 block text-xs text-sc-muted">{tr("step1.flightNo")}</label>
                <div className="mt-1 flex gap-2">
                  <input
                    className="w-28 rounded border px-2 py-1 text-sm"
                    value={field.flightNo}
                    placeholder="KE123"
                    onChange={(e) => setField({ ...field, flightNo: e.target.value, notFound: false })}
                  />
                  <button className="rounded border px-2 py-1 text-sm" onClick={() => lookup(direction)}>
                    {tr("step1.lookup")}
                  </button>
                </div>
                {field.notFound && <p className="mt-1 text-xs text-sc-red">{tr("step1.notFound")}</p>}
                {field.source && (
                  <p className="mt-1 text-xs">
                    <span className={field.source === "live" ? "rounded bg-sc-airport-soft px-1.5 py-0.5 text-sc-airport-text" : "rounded bg-sc-orange-soft px-1.5 py-0.5 text-sc-orange-text"}>
                      {tr(field.source === "live" ? "step1.sourceLive" : "step1.sourceSnapshot")}
                    </span>
                    {/* PR #59 리뷰 1 — remark 원문 대신 매핑 문구, 매핑 불가는 영어에서 숨김 */}
                    {formatFlightStatus(locale, field.status) && (
                      <span className="ml-1 text-sc-muted">{formatFlightStatus(locale, field.status)}</span>
                    )}
                  </p>
                )}
                <label className="mt-3 block text-xs text-sc-muted">{tr("step1.scheduledAt")}</label>
                <DateTimeField
                  className="mt-1"
                  value={field.at}
                  onChange={direction === "arrival" ? setArrivalAtInput : setDepartureAtInput}
                />
              </div>
            ))}
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border p-4">
              <label className="text-sm font-medium">{tr("step1.airportReady")}</label>
              <DateTimeField
                className="mt-2"
                value={airportReady.at}
                onChange={(at) => setAirportReady({ at, touched: true })}
              />
              {readySlackMin !== null && readySlackMin >= 0 && (
                <p className="mt-1 text-xs text-sc-muted">
                  {tr("step1.slackAfterArrival")}: {readySlackMin}{tr("step1.minutes")}
                </p>
              )}
            </div>
            <div className="rounded-lg border p-4">
              <label className="text-sm font-medium">{tr("step1.airportDeadline")}</label>
              <DateTimeField
                className="mt-2"
                value={airportDeadline.at}
                onChange={(at) => setAirportDeadline({ at, touched: true })}
              />
              {deadlineSlackMin !== null && deadlineSlackMin >= 0 && (
                <p className="mt-1 text-xs text-sc-muted">
                  {tr("step1.slackBeforeDeparture")}: {deadlineSlackMin}{tr("step1.minutes")}
                </p>
              )}
            </div>
          </div>
          <div className="mt-4 flex items-center justify-end gap-3">
            {step1Error && <p className="text-sm text-sc-red">{tr(step1Error)}</p>}
            <button
              className="rounded bg-sc-blue px-4 py-2 text-sm text-white disabled:opacity-40"
              disabled={step1Error !== null}
              onClick={() => setStep(2)}
            >
              {tr("common.next")}: {tr("nav.step2")}
            </button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section>
          <h2 className="text-lg font-semibold">{tr("step2.title")}</h2>
          <p className="text-sm text-sc-muted">{tr("step2.subtitle")}</p>
          <input
            className="mt-4 w-full rounded border px-3 py-2"
            placeholder={tr("step2.placeholder")}
            value={query}
            onChange={(e) => {
              const nextQuery = e.target.value;
              setQuery(nextQuery);
              setSearched(false);
              if (!nextQuery.trim()) setResults({ actors: [], works: [] });
            }}
          />
          {searched && results.actors.length === 0 && results.works.length === 0 && (
            <p className="mt-3 rounded border border-sc-orange/30 bg-sc-orange-soft p-3 text-sm text-sc-orange-text">
              {tr("step2.noResult")}
            </p>
          )}
          <ul className="mt-3 space-y-1">
            {results.actors.map((a) => (
              <li key={a.id}>
                <button
                  className="w-full rounded border px-3 py-2 text-left text-sm hover:bg-sc-subtle"
                  onClick={() => toggleChip(selectedActors, setSelectedActors, a)}
                >
                  {a.name[locale]} <span className="ml-1 text-xs text-sc-muted/70">{tr("step2.actor")}</span>
                </button>
              </li>
            ))}
            {results.works.map((w) => (
              <li key={w.id}>
                <button
                  className="w-full rounded border px-3 py-2 text-left text-sm hover:bg-sc-subtle"
                  onClick={() => toggleChip(selectedWorks, setSelectedWorks, w)}
                >
                  {w.title[locale]} <span className="ml-1 text-xs text-sc-muted/70">{tr("step2.work")}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-4 rounded-lg border bg-sc-subtle p-3">
            <h3 className="text-sm font-medium">{tr("step2.selected")}</h3>
            {selectedActors.length === 0 && selectedWorks.length === 0 ? (
              <p className="mt-1 text-sm text-sc-muted/70">{tr("step2.empty")}</p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-2">
                {selectedActors.map((a) => (
                  <button
                    key={a.id}
                    className="rounded-full bg-sc-blue-soft px-3 py-1 text-sm text-sc-blue"
                    onClick={() => toggleChip(selectedActors, setSelectedActors, a)}
                  >
                    {a.name[locale]} · {tr("step2.actor")} ×
                  </button>
                ))}
                {selectedWorks.map((w) => (
                  <button
                    key={w.id}
                    className="rounded-full bg-sc-airport-soft px-3 py-1 text-sm text-sc-airport-text"
                    onClick={() => toggleChip(selectedWorks, setSelectedWorks, w)}
                  >
                    {w.title[locale]} · {tr("step2.work")} ×
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="mt-4 flex justify-between">
            <button className="rounded border px-4 py-2 text-sm" onClick={() => setStep(1)}>{tr("common.back")}</button>
            <button
              className="rounded bg-sc-blue px-4 py-2 text-sm text-white disabled:opacity-40"
              disabled={selectedActors.length === 0 && selectedWorks.length === 0}
              onClick={loadCandidates}
            >
              {tr("common.next")}: {tr("nav.step3")}
            </button>
          </div>
        </section>
      )}

      {step === 3 && candidateData && (
        <section>
          <h2 className="text-lg font-semibold">{tr("step3.title")}</h2>
          <p className="text-sm text-sc-muted">{tr("step3.subtitle")}</p>
          <div className="mt-3 flex gap-2 text-sm">
            {(["relevance", "official"] as const).map((mode) => (
              <button
                key={mode}
                className={`rounded border px-3 py-1 ${sortBy === mode ? "border-sc-blue bg-sc-blue-soft text-sc-blue" : ""}`}
                onClick={() => setSortBy(mode)}
              >
                {tr(mode === "relevance" ? "step3.sortRelevance" : "step3.sortOfficial")}
              </button>
            ))}
          </div>
          {sortedCandidates.length === 0 && (
            <p className="mt-4 rounded border border-sc-orange/30 bg-sc-orange-soft p-3 text-sm text-sc-orange-text">
              {tr("step3.noCandidates")}
            </p>
          )}
          <ul className="mt-3 space-y-2">
            {/* #43 확정: 미확인 후보도 같은 목록에서 선택 가능 — 카드에 경고 배지 */}
            {candidateGroups.primary.map((c) => (
              <PlaceCard key={c.id} candidate={c} locale={locale} tr={tr}
                selected={selectedPlaceIds.has(c.id)}
                stationName={stationName} workTitles={workTitles}
                aiReason={c.aiReason ?? null}
                onToggle={() => {
                  const next = new Set(selectedPlaceIds);
                  if (next.has(c.id)) next.delete(c.id); else next.add(c.id);
                  setSelectedPlaceIds(next);
                }}
              />
            ))}
          </ul>
          {/* #51 합의 3 — 배우 선택 모드: 미등장 확정·미확인은 별도 구분 영역, 선택은 동일하게 가능 */}
          {candidateGroups.separated.length > 0 && (
            <div className="mt-4">
              <h3 className="text-sm font-medium text-sc-muted">{tr("step3.actorSeparatedTitle")}</h3>
              <ul className="mt-2 space-y-2">
                {candidateGroups.separated.map(({ candidate: c, status }) => (
                  <PlaceCard key={c.id} candidate={c} locale={locale} tr={tr}
                    selected={selectedPlaceIds.has(c.id)}
                    stationName={stationName} workTitles={workTitles}
                    presence={status}
                    aiReason={c.aiReason ?? null}
                    onToggle={() => {
                      const next = new Set(selectedPlaceIds);
                      if (next.has(c.id)) next.delete(c.id); else next.add(c.id);
                      setSelectedPlaceIds(next);
                    }}
                  />
                ))}
              </ul>
            </div>
          )}
          <div className="mt-4 flex justify-between">
            <button className="rounded border px-4 py-2 text-sm" onClick={() => setStep(2)}>{tr("common.back")}</button>
            <button
              className="rounded bg-sc-blue px-4 py-2 text-sm text-white disabled:opacity-40"
              disabled={selectedPlaceIds.size === 0}
              onClick={plan}
            >
              {tr("step3.generate")}
            </button>
          </div>
        </section>
      )}

      {step === 4 && (
        <section>
          <h2 className="text-lg font-semibold">{tr("step4.title")}</h2>
          <p className="text-sm text-sc-muted">{tr("step4.subtitle")}</p>

          {view.planning && <p className="mt-6 text-center text-sm text-sc-muted">{tr("step4.generating")}</p>}

          {!view.planning && view.planError && (
            <div className="mt-4 rounded-lg border border-sc-red/30 bg-sc-red/5 p-4 text-sm text-sc-red">
              {tr(view.planError === "invalid" ? "step4.errInvalid" : "step4.errUnexpected")}
            </div>
          )}

          {viewBanner && (
            <div className="mt-4 rounded-lg border border-sc-airport/30 bg-sc-airport-soft p-3 text-sm text-sc-airport-text">
              {tr(viewBanner === "reopened" ? "trips.reopened" : "alt.swapped")}
            </div>
          )}

          {displayedDays && (
            <div className="mt-4 space-y-4">
              {displayedDays.map((day) => {
                const baseDay = baseDays?.find((d) => d.date === day.date);
                return (
                  <div key={day.date} className="rounded-lg border p-4">
                    <h3 className="font-medium">{day.date}</h3>
                    <ul className="mt-2 space-y-1 text-sm">
                      {day.rides.map((ride) => (
                        <li key={`${ride.trainNo}-${ride.departAt}`} className="text-sc-text/80">
                          🚆 {fmtTime(ride.departAt)} {stationName(ride.fromStationId)} → {fmtTime(ride.arriveAt)} {stationName(ride.toStationId)}
                          <span className="ml-2 text-xs text-sc-muted/70">{tr("step4.train")} {ride.trainNo}</span>
                        </li>
                      ))}
                      {/* #14: 장소 단위 시각 미표기 — 역 단위 활용시간은 regionWindows로 표시 (#33) */}
                      {day.items.map((item) => (
                        <li key={item.placeId} className="text-sc-text/80">
                          📍 {placeName(item.placeId)}
                          <span className="ml-2 text-xs text-sc-muted">{accessLabel(item.accessMinutes)}</span>
                        </li>
                      ))}
                    </ul>
                    {/* #33 — 엔진 값 포맷만, 경계·시각 재해석 금지 */}
                    {day.regionWindows.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {day.regionWindows.map((window) => (
                          <div
                            key={window.startAt}
                            className="rounded border-l-2 border-sc-orange/50 bg-sc-orange-soft/70 px-3 py-1.5 text-sm text-sc-text/80"
                          >
                            <span className="font-medium">{stationName(window.stationId)}</span>
                            {" "}{tr("region.block")} · {availableLabel(window.availableMinutes)}
                          </div>
                        ))}
                      </div>
                    )}
                    {/* 재열람 화면은 저장 시점 일정 그대로 — mock 대안은 개발 플래그에서만 (PR #35 리뷰 2) */}
                    {SHOW_ALT_MOCK && !view.reopened && baseDay && baseDay.rides.length > 0 && (
                      <AlternativeTimetables
                        date={day.date}
                        alternatives={mockAlternatives}
                        selectedAltId={view.selectedAlt?.id ?? null}
                        recommendedDepartAt={baseDay.rides[0].departAt}
                        onSelect={chooseAlternative}
                        tr={tr}
                      />
                    )}
                  </div>
                );
              })}
              {viewWarnings.length > 0 && (
                // #43 수용 기준: 경고 누락 0건 — 배치는 유지하되 방문 전 확인을 안내
                <div className="rounded-lg border border-sc-orange/30 bg-sc-orange-soft p-4">
                  <h3 className="text-sm font-medium text-sc-orange-text">{tr("step4.warningsTitle")}</h3>
                  <ul className="mt-2 space-y-1 text-sm text-sc-orange-text">
                    {viewWarnings.map((warning) => (
                      <li key={warning.placeId}>
                        ⚠️ {placeName(warning.placeId)} — {tr(`reason.${warning.detail}` as MessageKey)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {viewRejected.length > 0 && (
                <div className="rounded-lg border border-sc-orange/30 bg-sc-orange-soft p-4">
                  <h3 className="text-sm font-medium text-sc-orange-text">{tr("step4.rejectedTitle")}</h3>
                  <ul className="mt-2 space-y-1 text-sm text-sc-orange-text">
                    {viewRejected.map((reason) => (
                      <li key={`${reason.placeId}-${reason.code}`}>
                        {placeName(reason.placeId)} — {tr(`reason.${reason.code}` as MessageKey)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {/* #80 — 권역 단위 테마체험 제안. 일정에는 자동으로 포함되지 않는다 (#14 v0.6) */}
              <ThemeExperienceCard
                result={themeExperience}
                stationName={themeStationLabel(displayedDays, themeExperience, stationName)}
                locale={locale}
                tr={tr}
              />
              {/* #24 A5 — 실행 지원: 일정에 등장하는 역만, 스냅샷 수록분만 안내 */}
              <ExecutionSupport
                snapshot={stationFacilities}
                stationIds={[...new Set(displayedDays.flatMap((day) => [
                  ...day.rides.flatMap((ride) => [ride.fromStationId, ride.toStationId]),
                  ...day.regionWindows.map((window) => window.stationId),
                ]))]}
                rides={displayedDays.flatMap((day) => day.rides)}
                stationName={stationName}
                tr={tr}
              />
            </div>
          )}

          {showEmpty(view) && view.result?.status === "empty" && (
            <div className="mt-4 rounded-lg border border-sc-orange/30 bg-sc-orange-soft p-4">
              <h3 className="font-medium text-sc-orange-text">{tr("step4.emptyTitle")}</h3>
              <p className="mt-1 text-sm text-sc-orange-text">{tr("step4.emptyDesc")}</p>
              {view.result.rejectedPlaces.length > 0 && (
                <ul className="mt-2 space-y-1 text-sm text-sc-orange-text">
                  {view.result.rejectedPlaces.map((reason) => (
                    <li key={`${reason.placeId}-${reason.code}`}>
                      {placeName(reason.placeId)} — {tr(`reason.${reason.code}` as MessageKey)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-2">
              <button className="rounded border px-3 py-2 text-sm" onClick={() => setStep(3)}>{tr("step4.editPlaces")}</button>
              <button className="rounded border px-3 py-2 text-sm" onClick={() => setStep(1)}>{tr("step4.editFlights")}</button>
              <button className="rounded border px-3 py-2 text-sm" onClick={plan}>{tr("step4.recalculate")}</button>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`text-xs ${saveStub.saveStatus === "saved" ? "text-sc-green" : saveStub.saveStatus === "error" ? "text-sc-red" : "text-sc-muted"}`}
                role="status"
              >
                {tr(SAVE_STATUS_KEY[saveStub.saveStatus])}
              </span>
              <button
                className="rounded bg-sc-blue px-4 py-2 text-sm text-white disabled:opacity-40"
                disabled={!displayedDays}
                onClick={() => {
                  const entry = savedEntry();
                  if (entry) saveStub.requestSave(entry);
                }}
              >
                ♡ {tr("step4.save")}
              </button>
            </div>
          </div>
        </section>
      )}

      </div>
      </div>
      </div>

      {saveStub.authIntent && (
        <AuthModal
          intent={saveStub.authIntent}
          isStub={saveStub.mode !== "supabase"}
          pending={saveStub.authPending}
          failed={saveStub.authFailed}
          onSubmit={(kind, email, password) => void saveStub.submitAuth(kind, email, password, savedEntry())}
          onClose={saveStub.closeAuth}
          tr={tr}
        />
      )}
      {saveStub.tripsOpen && (
        <TripsModal
          saved={saveStub.saved}
          selectedTripId={saveStub.selectedTripId}
          isStub={saveStub.mode !== "supabase"}
          loadFailed={saveStub.tripsLoadFailed}
          onSelect={saveStub.selectTrip}
          onReopen={saveStub.reopen}
          onLogout={saveStub.logout}
          onClose={saveStub.closeTrips}
          tr={tr}
        />
      )}
    </div>
  );
}

function PlaceCard({ candidate, locale, tr, selected, onToggle, stationName, workTitles, presence, aiReason }: {
  candidate: PlaceCandidate;
  locale: Locale;
  tr: (key: MessageKey) => string;
  selected: boolean;
  onToggle: () => void; // #43: 미확인 후보도 선택 가능 — 표시 전용 카드 없음
  stationName: (id: string) => string;
  workTitles: (ids: string[]) => string;
  presence?: "absent" | "unreviewed"; // #51 — 별도 구분 영역 카드의 사유 배지
  aiReason?: { ko: string; en: string } | null; // #48 — 검토된 관련 이유(점수 비노출)
}) {
  const oh = candidate.openingHours;
  const hoursLabel =
    oh.type === "always_open" ? tr("step3.alwaysOpen")
    : oh.type === "hours" ? `${oh.open}–${oh.close}`
    : null; // 미확인은 텍스트 대신 경고 배지 (#43)
  // PR #59 리뷰 1 — 시드의 출처 설명은 한국어 원문이라 영어 모드에서는 번역 가능한
  // 라벨·확인일만 표시한다. 출처 ko/en 구조화는 #4 다국어 범위에서 후속 결정.
  const source = oh.type !== "unverified"
    ? locale === "ko"
      ? `${oh.source} · ${oh.verifiedAt} ${tr("step3.verifiedAt")}`
      : `${tr("step3.officialSource")} · ${tr("step3.verifiedAt")} ${oh.verifiedAt}`
    : null;

  return (
    <li className={`rounded-lg border p-3 ${selected ? "border-sc-blue bg-sc-blue-soft/60" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm">
          <p className="font-medium">
            {candidate.name[locale]}
            <span className="ml-2 rounded bg-sc-subtle px-1.5 py-0.5 text-xs text-sc-muted">
              {tr(candidate.relation === "selected_work" ? "step3.relationSelected" : "step3.relationActor")}
            </span>
            {presence && (
              <span className="ml-1 rounded bg-sc-line/60 px-1.5 py-0.5 text-xs text-sc-text/80">
                {tr(presence === "absent" ? "step3.actorAbsent" : "step3.actorUnreviewed")}
              </span>
            )}
          </p>
          <p className="mt-1 text-xs text-sc-muted">
            {stationName(candidate.nearestStationId)} · {tr("step3.accessAbout")} {candidate.accessEstimate.minutes}{tr("step3.accessEstimate")}
          </p>
          {/* #51 계약 5·6·7 — 작품별 `작품명 · 회차` + 검증된 장면 설명, 회차 미확인은 작품명만.
              회차는 locale 포맷(영문 Ep. N) — 숫자 패턴이 아니면 영어에서 숨김 */}
          {candidate.relationDetails.length > 0 ? (
            candidate.relationDetails.map((detail) => {
              const episode = formatEpisodeLabel(locale, detail.episodeLabel);
              return (
                <p key={detail.workId} className="mt-0.5 text-xs text-sc-muted">
                  <span className="font-medium">
                    {workTitles([detail.workId])}
                    {episode ? ` · ${episode}` : ""}
                  </span>
                  {detail.sceneNote ? ` — ${detail.sceneNote[locale]}` : ""}
                </p>
              );
            })
          ) : (
            <p className="mt-0.5 text-xs text-sc-muted">{workTitles(candidate.workIds)}</p>
          )}
          {/* #48 — 검토된 항목의 관련 이유만 ko/en 표시, 내부 점수는 노출하지 않는다 */}
          {aiReason && (
            <p className="mt-0.5 text-xs text-sc-airport-text">
              ✨ {tr("step3.aiReasonLabel")}: {aiReason[locale]}
            </p>
          )}
          <p className="mt-0.5 text-xs text-sc-muted">
            {hoursLabel ?? (
              <span className="rounded bg-sc-orange-soft px-1.5 py-0.5 text-sc-orange-text">
                ⚠️ {tr("step3.hoursUnverified")}
              </span>
            )}
            {source ? ` · ${source}` : ""}
          </p>
        </div>
        <button
          className={`shrink-0 rounded px-3 py-1 text-sm ${selected ? "bg-sc-blue text-white" : "border"}`}
          onClick={onToggle}
        >
          {selected ? "✓" : "+"}
        </button>
      </div>
    </li>
  );
}
