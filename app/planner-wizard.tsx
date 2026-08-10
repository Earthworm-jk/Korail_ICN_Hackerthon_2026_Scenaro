"use client";
/**
 * 4단계 위저드 골격 — 여행 조건 → K-콘텐츠 → 촬영지 → 일정 결과 (ver.0.3·#14 ver.0.4 확정)
 * - 배우·작품 복수 선택 칩, 필수 방문 없음(전부 자유 선택), 방문지별 시각 미표기(역 단위 체류)
 * - 편집 = 촬영지 재선택·항공 시각 변경 후 전체 재계산 (무상태)
 * - 대안 시간표는 mock(#14 ⑨ 선행), 저장·내 일정은 in-memory 스텁(#25 선행) — 엔진·Supabase 연결 시 교체
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { MapPin, Sparkles, TriangleAlert } from "lucide-react";
import {
  searchEntities,
  type ActorSummary,
  type EntitySearchResult,
  type WorkSummary,
} from "@/lib/actions/search";
import {
  getCandidatePlaces,
  type CandidateResponse,
  type PlaceCandidate,
} from "@/lib/actions/places";
import { planGatewayAlternatives, planItinerary } from "@/lib/actions/itinerary";
import { excludedPlaceIdsFrom, initialCandidateIds } from "@/lib/candidates";
import { initialPlaceIdsFromItinerary } from "@/lib/initial-place-selection";
import { sortCandidatePlaces } from "@/lib/place-ranking";
import { getFlightInfo } from "@/lib/actions/flights";
import { t, type Locale, type MessageKey } from "@/lib/i18n/messages";
import { buildMockAlternatives } from "@/lib/alternatives-mock";
import {
  constraintsFromTripInputs,
  defaultSavedTitle,
  SAVED_SCHEMA_VERSION,
  tripInputsFromConstraints,
  type DisplayNameSnapshot,
  type LocalizedName,
  type SavedItineraryStub,
} from "@/lib/saved-itineraries-stub";
import {
  banner,
  displayedSelectionCapacity,
  displayedDays as deriveDisplayedDays,
  initialItineraryView,
  itineraryWarnings as deriveWarnings,
  recommendedDays,
  reduceItineraryView,
  rejectedPlaces as deriveRejectedPlaces,
  showEmpty,
  type SelectableAlternative,
} from "@/lib/itinerary-view";
import { autoPlanDecision } from "@/lib/auto-plan";
import { useLocalDraft } from "./local-draft";
import { fromKstLocalInput as fromLocalInput, toKstLocalInput as toLocalInput } from "@/lib/kst-datetime";
import { formatFlightStatus } from "@/lib/flight-status";
import { formatEpisodeLabel } from "@/lib/episode-label";
import { splitSourceLink } from "@/lib/source-link";
import { placePhoto } from "@/lib/place-photos";
import { PlaceTypeIcon } from "./place-type-icon";
import { diffItineraries, type ItineraryDiff } from "@/lib/itinerary-diff";
import { gatewayPlanningBaselineOf } from "@/lib/engine/gateway-baseline";
import { AlternativeTimetables } from "./alternative-timetables";
import { AuthModal, TripsModal, useSaveStub, type SaveStatus } from "./save-stub";
import { ExecutionSupport } from "./execution-support";
import { FinalItineraryPage } from "./final-itinerary-page";
import { GatewayAlternatives } from "./gateway-alternatives";
import { ItineraryChangeSummary } from "./itinerary-change-summary";
import { ItineraryRouteMap, KoreaMapPanel, type MapPlace, type MapStation } from "./korea-map";
import { PlaceRecommendationSheet, PlaceThumbnail } from "./place-recommendation-sheet";
import { ThemeExperienceCard, ThemeExperienceMapOverlay } from "./theme-experience";
import { TrainLegModal, legDurationLabel, type TrainLegDetail } from "./train-leg-modal";
import { getThemeExperience, type ThemeExperienceResult } from "@/lib/actions/theme-experience";
import type { StationFacilitiesSnapshotT } from "@/lib/station-facilities";
import type { StationCoordinatesSnapshotT } from "@/lib/station-coordinates";
import type { RailGeometrySnapshotT } from "@/lib/rail-geometry";
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

// #85 확정: 촬영지 선택과 일정 결과가 한 화면이라 스테퍼도 3단계다.
// 무엇을 뺄지 판단하는 순간과 뺀 결과를 보는 순간이 같은 화면에 있어야 한다.
const STEPS: MessageKey[] = ["nav.step1", "nav.step2", "nav.step3"];

/** 3단계 후보 목록을 한 번에 보여주는 개수 — 나머지는 "더보기" */
const PLACES_PAGE_SIZE = 5;

/**
 * 장소 토글 후 자동 재계산까지의 대기(ms) — #85 성능 실측 기준.
 * 실시드 14곳 92ms·확장 상한 50곳 935ms라 계산 자체는 즉시 반응 범위지만,
 * 여러 곳을 연달아 끄는 조작에서 매번 돌지 않도록 마지막 토글만 계산한다.
 */
const AUTO_PLAN_DEBOUNCE_MS = 400;

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

function SummarySidebar({ arrivalAt, departureAt, readyAt, deadlineAt, actors, works, placeCount, locale, tr, collapsed, onToggle }: {
  arrivalAt: string;
  departureAt: string;
  readyAt: string;
  deadlineAt: string;
  actors: ActorSummary[];
  works: WorkSummary[];
  placeCount: number;
  locale: Locale;
  tr: (key: MessageKey) => string;
  collapsed: boolean;
  onToggle: () => void;
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
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{tr("summary.title")}</h3>
        <button
          type="button"
          aria-expanded={!collapsed}
          className="rounded border px-1.5 py-0.5 text-xs text-sc-muted hover:border-sc-blue hover:text-sc-blue"
          onClick={onToggle}
        >
          {collapsed ? "＋" : "－"}
          <span className="sr-only">{tr(collapsed ? "summary.expand" : "summary.collapse")}</span>
        </button>
      </div>
      <div hidden={collapsed} className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-1 md:gap-4">
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

export default function PlannerWizard({ stationFacilities, stationCoordinates, railGeometry }: {
  stationFacilities: StationFacilitiesSnapshotT;
  stationCoordinates: StationCoordinatesSnapshotT;
  railGeometry: RailGeometrySnapshotT;
}) {
  const [locale, setLocale] = useState<Locale>("ko");
  const [step, setStep] = useState(1);
  const [showFinalItinerary, setShowFinalItinerary] = useState(false);
  // 요약 사이드바 접기 — 접으면 본문(지도·일정)이 220px을 더 쓴다
  const [summaryCollapsed, setSummaryCollapsed] = useState(false);
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
  const [results, setResults] = useState<EntitySearchResult>({ actors: [], works: [] });
  const [searched, setSearched] = useState(false);
  const [selectedActors, setSelectedActors] = useState<ActorSummary[]>([]);
  const [selectedWorks, setSelectedWorks] = useState<WorkSummary[]>([]);

  // step 3 — 후보·선택
  const [candidateData, setCandidateData] = useState<CandidateResponse | null>(null);
  const [selectedPlaceIds, setSelectedPlaceIds] = useState<Set<string>>(new Set());
  const [reopenCandidateStatus, setReopenCandidateStatus] = useState<"loading" | "failed" | null>(null);
  const [sortBy, setSortBy] = useState<"relevance" | "official">("relevance");
  // 후보 목록은 5곳씩 — 한 화면에 다 쏟으면 무엇을 고를지가 안 보인다. 표시 개수만 늘린다
  const [visibleCount, setVisibleCount] = useState(PLACES_PAGE_SIZE);

  // step 4 — 결과. 전이 규칙·파생은 lib/itinerary-view 순수 함수로 고정 (PR #35 리뷰 3)
  const [view, dispatchView] = useReducer(reduceItineraryView, initialItineraryView);
  // 직전 확정 결과와 최신 성공 결과의 차이. 엔진 상태와 분리된 발표용 표현 상태다 (#118 P0-2).
  const [lastItineraryDiff, setLastItineraryDiff] = useState<ItineraryDiff | null>(null);
  const planSequence = useRef(0); // 늦게 도착한 이전 요청의 공항버스 대안이 새 결과를 덮지 않게 한다.
  // 계산이 끝난(성공·무효·실패 모두) 마지막 선택. 지금 선택과 다르면 화면은 아직 옛 결론이다.
  // 대기 플래그를 따로 두지 않고 여기서 파생한다 — effect에서 setState를 하지 않기 위해서다.
  const [settledSelectionKey, setSettledSelectionKey] = useState<string | null>(null);

  // #80 테마체험 권역 — 일정이 확정된 시점(생성 성공·재열람)에만 조회한다.
  // 입력은 표시 중인 일정의 권역과 선택 작품뿐이며, 런타임 OpenAI 호출은 없다.
  const [themeExperience, setThemeExperience] = useState<ThemeExperienceResult | null>(null);
  // #14 v0.6 — 지도 권역 표시는 기본 숨김. 카드 버튼과 지도 헤딩 버튼이 같은 상태를 쓴다.
  const [themeMapVisible, setThemeMapVisible] = useState(false);
  // 인수인계 G — 열차 줄을 누르면 그 구간의 시각·출처를 팝업으로 본다 (화면 아래 카드 중복 제거)
  const [openTrainLeg, setOpenTrainLeg] = useState<TrainLegDetail | null>(null);
  // PR #82 리뷰 비차단 — 연속 재계산에서 먼저 보낸 요청의 늦은 응답이 최신 화면을 덮지 않게
  // 요청 순번을 붙이고, 자기 순번이 아니면 응답을 버린다.
  const themeRequestRef = useRef(0);
  const refreshThemeExperience = useCallback(async (days: DayPlan[] | null, workIds: string[]) => {
    const seq = ++themeRequestRef.current;
    setThemeMapVisible(false);
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
    setLastItineraryDiff(null);
    const c = record.constraints;
    const inputs = tripInputsFromConstraints(c);
    setArrival((f) => ({ ...f, at: inputs.arrivalAt }));
    setDeparture((f) => ({ ...f, at: inputs.departureAt }));
    // 저장 당시 절대 시각을 그대로 복원 — 이후 항공편 변경이 파생 기본값으로 덮지 않게 touched 고정
    setAirportReady({ at: inputs.airportReadyAt, touched: true });
    setAirportDeadline({ at: inputs.airportArrivalDeadline, touched: true });
    setSelectedActors(record.context.actors);
    setSelectedWorks(record.context.works);

    // 저장 레코드의 일정은 후보 재조회와 무관하게 먼저 연다. 발표장 네트워크가 끊겨도
    // 저장된 days와 조건만으로 결과를 복원할 수 있으며, 자동 재계산도 reopened에서 멈춘다.
    setCandidateData(null);
    setSelectedPlaceIds(new Set());
    setReopenCandidateStatus("loading");
    dispatchView({ type: "REOPEN", record });
    setStep(3); // #85 — 결과는 3단계 우측 열에서 보여준다
    setShowFinalItinerary(true); // 저장 목록의 "다시 열기"는 저장했던 최종 조망 화면으로 복귀한다.

    try {
      const data = await getCandidatePlaces({
        selectedActorIds: c.selectedActorIds,
        selectedWorkIds: c.selectedWorkIds,
      });
      setCandidateData(data);
      const excluded = new Set(c.excludedPlaceIds);
      // 재열람은 현재 엄격 후보 중 저장 당시 excluded의 여집합을 복원한다.
      setSelectedPlaceIds(new Set(initialCandidateIds(data.candidates).filter((id) => !excluded.has(id))));
      setReopenCandidateStatus(null);
    } catch {
      // 후보 편집만 비활성화하고, 먼저 연 저장 일정과 조건은 그대로 유지한다 (#118 P0-4).
      setReopenCandidateStatus("failed");
    }

    void refreshThemeExperience(record.days, c.selectedWorkIds);
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
    setShowFinalItinerary(false);
    const actorIds = selectedActors.map((a) => a.id);
    const workIds = selectedWorks.map((w) => w.id);
    const data = await getCandidatePlaces({
      selectedActorIds: actorIds,
      selectedWorkIds: workIds,
    });
    const allCandidateIds = initialCandidateIds(data.candidates);
    const sequence = ++planSequence.current;

    /**
     * 첫 Step 3은 후보 전체를 체크한 뒤 DOM에서 다시 끄는 방식이 아니라,
     * 실제 일정 엔진 결과와 선택 state를 먼저 맞춘 뒤 연다.
     *
     * 엔진이 부분집합만 배치했다면 그 장소만 선택한 조건으로 다시 계산해
     * rejectedPlaces/selectionGroups까지 현재 선택과 일치시키며, 최대 3회 안에서 고정점에 도달한다.
     */
    const constraintsFor = (selectedIds: readonly string[]) => {
      const selected = new Set(selectedIds);
      return constraintsFromTripInputs(
        {
          arrivalAt: arrival.at,
          departureAt: departure.at,
          airportReadyAt: airportReady.at,
          airportArrivalDeadline: airportDeadline.at,
        },
        actorIds,
        workIds,
        data.candidates.filter((candidate) => !selected.has(candidate.id)).map((candidate) => candidate.id),
      );
    };

    dispatchView({ type: "PLAN_START" });
    setLastItineraryDiff(null);
    setThemeExperience(null);

    let selectedIds = allCandidateIds;
    let finalConstraints = constraintsFor(selectedIds);

    try {
      let finalAction = await planItinerary(finalConstraints);
      if (sequence !== planSequence.current) return;

      for (let pass = 0; pass < 2 && finalAction.ok && finalAction.result.status === "planned"; pass += 1) {
        const nextSelectedIds = initialPlaceIdsFromItinerary(selectedIds, finalAction.result);
        const sameSelection =
          nextSelectedIds.length === selectedIds.length &&
          nextSelectedIds.every((id, index) => id === selectedIds[index]);
        if (sameSelection) break;

        selectedIds = nextSelectedIds;
        finalConstraints = constraintsFor(selectedIds);
        finalAction = await planItinerary(finalConstraints);
        if (sequence !== planSequence.current) return;
      }

      setCandidateData(data);
      setSelectedPlaceIds(new Set(selectedIds));
      setVisibleCount(PLACES_PAGE_SIZE);
      setSettledSelectionKey([...selectedIds].sort().join("|"));

      if (!finalAction.ok) {
        dispatchView({ type: "PLAN_INVALID" });
        setStep(3);
        return;
      }

      dispatchView({ type: "PLAN_SUCCESS", result: finalAction.result });
      saveStub.markDirty();
      setStep(3);

      if (finalAction.result.status === "planned") {
        const baseline = gatewayPlanningBaselineOf(finalAction.result);
        if (baseline) {
          void planGatewayAlternatives(finalConstraints, baseline).then((gateway) => {
            if (sequence !== planSequence.current || !gateway.ok) return;
            dispatchView({ type: "GATEWAY_ALTERNATIVES_SUCCESS", alternatives: gateway.alternatives });
          }).catch(() => {
            // 핵심 철도 일정은 이미 확정됐으므로 대안 조회 실패가 추천을 되돌리지는 않는다.
          });
        }
        void refreshThemeExperience(finalAction.result.days, finalConstraints.selectedWorkIds);
      }
    } catch {
      if (sequence !== planSequence.current) return;
      setCandidateData(data);
      setSelectedPlaceIds(new Set(allCandidateIds));
      setVisibleCount(PLACES_PAGE_SIZE);
      setSettledSelectionKey([...allCandidateIds].sort().join("|"));
      dispatchView({ type: "PLAN_FAILED" });
      setStep(3);
    }
  }, [
    selectedActors,
    selectedWorks,
    arrival.at,
    departure.at,
    airportReady.at,
    airportDeadline.at,
    saveStub,
    refreshThemeExperience,
  ]);

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

  /** 지금 고른 장소 집합의 지문 — 구분자는 `|`, 장소 ID는 kebab-case라 충돌하지 않는다 */
  const selectionKey = useMemo(() => [...selectedPlaceIds].sort().join("|"), [selectedPlaceIds]);

  const plan = useCallback(async () => {
    const constraints = currentConstraints();
    if (!constraints) return;
    const sequence = ++planSequence.current;
    const requestedSelectionKey = selectionKey;
    // 계산 중에도 view.result는 직전 확정 결과를 유지한다. 다만 대안을 보고 있었다면 화면과
    // view.result(추천안)의 기준이 다르므로 부정확한 변화량을 만들지 않는다.
    const previousResult = view.selectedAlt === null ? view.result : null;
    dispatchView({ type: "PLAN_START" });
    setLastItineraryDiff(null);
    setThemeExperience(null);
    try {
      const res = await planItinerary(constraints);
      // #85 기술항목 1 — 연속 토글에서 먼저 보낸 계산이 늦게 도착해 최신 결과를 덮지 않게 한다.
      // 계산 중에는 리듀서가 직전 결과를 유지하므로 버려도 화면이 비지 않는다.
      if (sequence !== planSequence.current) return;
      // 성공이든 무효든 "이 선택으로는 끝났다" — 실패에도 기록해야 갱신 표시가 남지 않는다
      setSettledSelectionKey(requestedSelectionKey);
      if (res.ok) {
        setLastItineraryDiff(previousResult ? diffItineraries(previousResult, res.result) : null);
        dispatchView({ type: "PLAN_SUCCESS", result: res.result });
        saveStub.markDirty();
        if (res.result.status === "planned") {
          const baseline = gatewayPlanningBaselineOf(res.result);
          // 핵심 철도 추천을 먼저 보여주고, 더 비싼 전체 공항버스 재계산은 비차단으로 붙인다.
          if (baseline) {
            void planGatewayAlternatives(constraints, baseline).then((gateway) => {
              if (sequence !== planSequence.current || !gateway.ok) return;
              dispatchView({ type: "GATEWAY_ALTERNATIVES_SUCCESS", alternatives: gateway.alternatives });
            }).catch(() => {
              // 선택 대안 보강 실패는 이미 생성된 핵심 추천을 실패 상태로 되돌리지 않는다.
            });
          }
          void refreshThemeExperience(res.result.days, constraints.selectedWorkIds);
        }
      } else dispatchView({ type: "PLAN_INVALID" }); // 1단계 검증을 우회한 요청 — 기존 결과 유지
    } catch {
      if (sequence !== planSequence.current) return;
      setSettledSelectionKey(requestedSelectionKey);
      dispatchView({ type: "PLAN_FAILED" }); // 네트워크·서버 장애 — 기존 결과 유지
    }
  }, [currentConstraints, selectionKey, saveStub, refreshThemeExperience, view.result, view.selectedAlt]);

  // #85 기술항목 2 — 장소를 켜고 끄면 자동 재계산한다. 연속 토글은 마지막 것만 계산하고,
  // 항공편 시각은 확정대로 자동 감지하지 않는다(사용자가 조회·변경 후 "다시 계산").
  // 재열람 중에는 저장 당시 일정을 보여주는 중이므로 자동 계산이 덮어쓰지 않게 건너뛴다.
  // plan은 입력이 바뀔 때마다 새로 만들어진다. 아래 디바운스 effect가 plan을 의존성으로 받으면
  // 타이머가 매 렌더 재설정되므로, 최신 함수는 ref로만 참조한다(갱신은 렌더가 아니라 effect에서).
  const planRef = useRef(plan);
  useEffect(() => { planRef.current = plan; }, [plan]);
  const reopened = view.reopened;
  useEffect(() => {
    // loadCandidates가 이미 현재 선택의 최종 일정까지 계산해 Step 3을 연 경우 중복 호출하지 않는다.
    // 이후 사용자가 장소를 켜거나 끄면 selectionKey가 달라져 아래 자동 재계산 경로로 들어간다.
    if (
      step === 3 &&
      candidateData !== null &&
      reopened === null &&
      selectedPlaceIds.size > 0 &&
      selectionKey === settledSelectionKey &&
      view.result !== null &&
      !view.planning
    ) return;

    const decision = autoPlanDecision({
      onPlacesStep: step === 3,
      hasCandidates: candidateData !== null,
      reopened: reopened !== null,
      selectedCount: selectedPlaceIds.size,
    });
    if (decision !== "schedule") {
      if (decision === "clear") {
        planSequence.current += 1;
        dispatchView({ type: "SELECTION_CLEARED" });
      }
      return;
    }

    // PR #99 리뷰 3 — 선택이 바뀐 "즉시" 진행 중 요청을 무효화한다. planSequence를 plan()
    // 안에서만 올리면, 디바운스가 끝나기 전에 도착한 이전 응답이 이미 바뀐 선택 옆에
    // 실린다. 그 순간 화면은 사용자가 고른 것과 다른 일정을 근거처럼 보여주게 된다.
    planSequence.current += 1;

    const timer = window.setTimeout(() => { void planRef.current(); }, AUTO_PLAN_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [
    selectedPlaceIds,
    step,
    candidateData,
    reopened,
    selectionKey,
    settledSelectionKey,
    view.result,
    view.planning,
  ]);

  // 조율 중 초안 자동 저장·복구 (#118 P0-3 · PR #123 어댑터 · PR #127 훅).
  // 판단·디바운스·저장은 훅이 갖고 있고, 여기서는 무엇을 담고 무엇을 되살릴지만 정한다.
  const { finalizeDraft } = useLocalDraft({
    trip: {
      arrivalAt: arrival.at,
      departureAt: departure.at,
      airportReadyAt: airportReady.at,
      airportArrivalDeadline: airportDeadline.at,
      // 시각만 담으면 파생 여부가 사라진다 — 자동으로 따라오던 값이 굳거나 수동 수정이 덮인다
      airportReadyTouched: airportReady.touched,
      airportDeadlineTouched: airportDeadline.touched,
    },
    // 배우 요약은 후보 응답에 없어 ID로는 되살릴 수 없다 — 저장 레코드의 context와 같은 이유
    context: { actors: selectedActors, works: selectedWorks },
    selectedPlaceIds: [...selectedPlaceIds],
    // 재열람 중에는 저장된 일정을 보여주는 중이라 초안을 덮지 않는다
    enabled: reopened === null,
    onRestore: async (draft) => {
      setArrival((f) => ({ ...f, at: draft.trip.arrivalAt }));
      setDeparture((f) => ({ ...f, at: draft.trip.departureAt }));
      setAirportReady({ at: draft.trip.airportReadyAt, touched: draft.trip.airportReadyTouched });
      setAirportDeadline({ at: draft.trip.airportArrivalDeadline, touched: draft.trip.airportDeadlineTouched });
      setSelectedActors(draft.context.actors);
      setSelectedWorks(draft.context.works);
      if (draft.context.actors.length === 0 && draft.context.works.length === 0) return;

      // 장소 선택은 후보를 다시 받아야 되살릴 수 있다. 여기서 던지면 훅이 자동 저장을
      // 잠근 채로 둬서 원본 초안이 보존된다(오프라인에서 초안을 잃지 않는다).
      const data = await getCandidatePlaces({
        selectedActorIds: draft.context.actors.map((a) => a.id),
        selectedWorkIds: draft.context.works.map((w) => w.id),
      });
      setCandidateData(data);
      const restorable = new Set(initialCandidateIds(data.candidates));
      const places = draft.selectedPlaceIds.filter((id) => restorable.has(id));
      setSelectedPlaceIds(new Set(places));
      // 초안에 단계는 담지 않는다 — 무엇이 되살아났는지로 정한다. 후보 조회가 성공한
      // 경우에만 3단계로 보내므로, 실패하면 빈 후보 목록 앞에 서는 일이 없다.
      setStep(places.length > 0 ? 3 : 2);
    },
  });

  // 최종 저장이 끝나면 초안을 비운다. 남겨 두면 다음 방문에서 이미 저장까지 마친 일정이
  // 초안으로 되살아나 사용자가 끝낸 작업을 다시 보게 된다.
  //
  // 키만 지우지 않고 훅의 finalizeDraft를 부른다 — 예약된 저장 타이머와 비교 기준까지
  // 함께 정리해야 지운 직후 같은 내용이 다시 쓰이지 않는다 (PR #129 리뷰).
  //
  // 재열람은 제외한다 — `reopen`도 저장 상태를 saved로 바꾸는데, 그때 지우면 사용자가
  // 만들던 초안이 저장 일정을 열었다는 이유로 사라진다.
  const prevSaveStatus = useRef(saveStub.saveStatus);
  useEffect(() => {
    const previous = prevSaveStatus.current;
    prevSaveStatus.current = saveStub.saveStatus;
    if (previous !== "saved" && saveStub.saveStatus === "saved" && reopened === null) {
      finalizeDraft();
    }
  }, [saveStub.saveStatus, reopened, finalizeDraft]);

  const baseDays = recommendedDays(view);
  const mockAlternatives = useMemo(
    () => (SHOW_ALT_MOCK && baseDays ? buildMockAlternatives(baseDays) : []),
    [baseDays],
  );
  const displayedDays = deriveDisplayedDays(view);
  // 고른 장소가 없는 상태 — 결과 열은 "선택 필요"만 보여주고 저장도 막는다 (PR #99 리뷰 2)
  const needsSelection = candidateData !== null && selectedPlaceIds.size === 0 && !view.reopened;
  /**
   * 갱신 표시 (PR #99 리뷰 비차단).
   *
   * view.planning만 보면 디바운스 400ms가 비어, 선택은 이미 바뀌었는데 직전 일정이
   * 확정 결과처럼 앉아 있는 구간이 생긴다 — "안 눌렸나"로 읽힌다. 계산이 시작된 시점이
   * 아니라 **선택이 바뀐 시점부터** 켠다. 재열람은 저장 당시 일정이라 대상이 아니다.
   */
  const updating =
    view.planning ||
    (candidateData !== null && !view.reopened && !needsSelection && selectionKey !== settledSelectionKey);
  const viewBanner = banner(view);
  const viewRejected = deriveRejectedPlaces(view);
  const viewWarnings = deriveWarnings(view);
  const uncoveredSelectionGroups = view.result?.selectionGroups.uncovered ?? [];
  // #84: 추천안 또는 선택한 전체 교체 대안 중 현재 화면에 보이는 일정으로만 판정한다.
  // empty와 재열람은 displayedSelectionCapacity에서 과선택 패널 대상에서 제외한다.
  const selectionCapacity = useMemo(
    () => displayedSelectionCapacity(view, selectedPlaceIds),
    [selectedPlaceIds, view],
  );

  const chooseAlternative = useCallback((alt: SelectableAlternative | null) => {
    setLastItineraryDiff(null);
    dispatchView({ type: "SELECT_ALT", alt });
    saveStub.markDirty();
  }, [saveStub]);

  /**
   * 저장 시점 표시 이름 수집 (#130).
   *
   * **이 일정에 실제로 쓰인 것만** 담는다 — 전체 후보를 담을 이유가 없다. gateway leg는
   * 레코드가 `fromName`·`toName`을 이미 갖고 있어 제외한다.
   *
   * locale 문자열 하나가 아니라 `{ ko, en }`을 담는 이유는 재열람 뒤에도 언어 전환이
   * 동작해야 하기 때문이다.
   */
  const collectDisplayNames = useCallback((days: DayPlan[]): DisplayNameSnapshot => {
    const places: Record<string, LocalizedName> = {};
    const stations: Record<string, LocalizedName> = {};
    for (const day of days) {
      for (const item of day.items) {
        const found = candidateData?.candidates.find((c) => c.id === item.placeId);
        if (found) places[item.placeId] = { ko: found.name.ko, en: found.name.en };
      }
      for (const ride of day.rides) {
        for (const id of [ride.fromStationId, ride.toStationId]) {
          const found = candidateData?.stations.find((station) => station.id === id);
          if (found) stations[id] = { ko: found.name.ko, en: found.name.en };
        }
      }
    }
    return { places, stations };
  }, [candidateData]);

  /**
   * 후보 재조회만 다시 시도한다 (#130).
   *
   * 저장된 일정은 이미 화면에 있으므로 `다시 열기`를 처음부터 반복할 이유가 없다.
   * 성공하면 이름이 현재 데이터로 바뀌고 장소 선택이 복원된다.
   */
  const retryReopenCandidates = useCallback(async () => {
    const record = view.reopened;
    if (!record) return;
    const c = record.constraints;
    setReopenCandidateStatus("loading");
    try {
      const data = await getCandidatePlaces({
        selectedActorIds: c.selectedActorIds,
        selectedWorkIds: c.selectedWorkIds,
      });
      setCandidateData(data);
      const excluded = new Set(c.excludedPlaceIds);
      setSelectedPlaceIds(new Set(initialCandidateIds(data.candidates).filter((id) => !excluded.has(id))));
      setReopenCandidateStatus(null);
    } catch {
      setReopenCandidateStatus("failed");
    }
  }, [view.reopened]);

  const savedEntry = useCallback((): Omit<SavedItineraryStub, "id" | "savedAt"> | null => {
    if (!displayedDays || selectionCapacity?.requiresAdjustment) return null;
    // 재열람 중 재저장은 저장 당시 조건을 그대로 보존한다
    const constraints = view.reopened?.constraints ?? currentConstraints();
    if (!constraints) return null;
    const context = view.reopened?.context ?? { actors: selectedActors, works: selectedWorks };
    // 재저장도 재열람 보존 규칙과 동일 — 저장 당시 경고를 잃지 않는다 (#43 경고 누락 0건)
    const warnings = view.reopened?.warnings ?? viewWarnings;
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
      // #130 — 재열람이 후보를 다시 받지 못해도 이름을 보여줄 수 있게 저장 시점 값을 담는다.
      // 재저장 시에는 저장 당시 스냅샷을 우선 보존한다(재열람 보존 규칙과 동일).
      displayNames: view.reopened?.displayNames ?? collectDisplayNames(displayedDays),
    };
  }, [displayedDays, selectionCapacity, view.reopened, viewWarnings, currentConstraints, selectedActors, selectedWorks, locale, collectDisplayNames]);

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

  // #14 v0.6 지도 — 좌표가 확인된 장소만 찍는다. 좌표 없는 장소(라라무리·오크밸리)는
  // 임의 위치나 역 위치로 대체하지 않고 표시에서 빼되(A3), 몇 곳이 빠졌는지 지도 옆에 밝힌다.
  const mapStations = useMemo<MapStation[]>(() => {
    const seedById = new Map((candidateData?.stations ?? []).map((s) => [s.id, s]));
    return stationCoordinates.stations.map((station) => ({
      id: station.stationId,
      name: seedById.get(station.stationId)?.name[locale] ?? station.sourceName,
      latitude: station.latitude,
      longitude: station.longitude,
      isAirport: seedById.get(station.stationId)?.isAirport === true,
    }));
  }, [stationCoordinates, candidateData, locale]);

  const mappablePlaces = useMemo<MapPlace[]>(
    () =>
      (candidateData?.candidates ?? [])
        .filter((c) => c.latitude !== undefined && c.longitude !== undefined)
        .map((c) => ({
          id: c.id,
          name: c.name[locale],
          latitude: c.latitude as number,
          longitude: c.longitude as number,
          stationId: c.nearestStationId,
          selected: selectedPlaceIds.has(c.id),
        })),
    [candidateData, locale, selectedPlaceIds],
  );
  // 지도에 못 실은 장소 수는 "지금 지도가 대상으로 삼는 집합" 기준이어야 한다.
  // 전체 후보 기준으로 세면 "선택한 장소만 보기"를 켠 상태에서 좌표 없는 장소를 하나도
  // 고르지 않았는데도 "2곳 미표시"가 남는다 (PR #83 리뷰).

  // 3단계 지도 전용 표시 필터 — 지도 안에서만 도는 상태이며 선택·일정에는 영향이 없다
  const [onlySelectedOnMap, setOnlySelectedOnMap] = useState(false);
  const step3MapPlaces = onlySelectedOnMap
    ? mappablePlaces.filter((place) => place.selected)
    : mappablePlaces;
  const step3MapScope = onlySelectedOnMap
    ? (candidateData?.candidates ?? []).filter((c) => selectedPlaceIds.has(c.id))
    : (candidateData?.candidates ?? []);
  const step3OmittedCount = step3MapScope.length - step3MapPlaces.length;


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
  // #61 확정 표기 — 접근시간은 자동차 길찾기 기반 보수값이라 수단을 명시한다.
  // "약 N분"만 두면 대중교통으로 읽힌다.
  const accessLabel = (minutes: number) => tr("access.byCar").replace("{n}", String(minutes));

  // #61 정적/동적 분리 — 같은 TRAIN_UNAVAILABLE도 원인이 둘이다.
  // 앵커역 시간표를 아직 확보하지 못한 것과, 확보했는데 일정 안에 탈 열차가 없는 것.
  // "연결 열차 없음"으로 뭉치면 갈 수 없는 곳을 추천한 것처럼 읽힌다.
  const rejectionLabel = (reason: { code: string; placeId: string }) => {
    const anchorId = candidateData?.candidates.find((c) => c.id === reason.placeId)?.nearestStationId;
    const anchor = candidateData?.stations.find((s) => s.id === anchorId);
    if (reason.code === "TRAIN_UNAVAILABLE" && anchor && !anchor.hasTimetable) {
      return tr("reason.TRAIN_OUT_OF_COVERAGE");
    }
    return tr(`reason.${reason.code}` as MessageKey);
  };

  /**
   * 표시 이름 조회 (#130).
   *
   * 순서는 `현재 candidateData` → `저장 당시 스냅샷` → `현지화된 대체 문구`다.
   * 예전에는 마지막이 `?? id`였는데, 후보 재조회가 실패하면 화면이 `place-seoullo-7017`
   * 같은 내부 ID를 그대로 보여 줬다. 발표장 네트워크가 끊기면 그대로 노출되는 자리다.
   *
   * 온라인 재조회가 성공하면 현재 데이터가 먼저다 — 저장 이후 이름이 바뀌었을 수 있다.
   */
  const savedNames = view.reopened?.displayNames;
  const stationName = (id: string) =>
    candidateData?.stations.find((s) => s.id === id)?.name[locale]
    ?? savedNames?.stations[id]?.[locale]
    ?? tr("common.nameUnavailable");
  const placeName = (id: string) =>
    candidateData?.candidates.find((c) => c.id === id)?.name[locale]
    ?? savedNames?.places[id]?.[locale]
    ?? tr("common.nameUnavailable");
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
    // 시안의 sc-app에는 max-width가 없다(브라우저 폭 전체). 3·4단계의 2단 그리드가
    // 220px 요약 사이드바와 함께 들어가려면 폭이 필요해 max-w-6xl로 넓힌다 — 좁으면
    // 지도 열이 시안의 minmax(320px) 아래로 눌린다.
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
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

      {!showFinalItinerary && <nav className="grid grid-cols-3 border-b bg-sc-subtle text-center text-sm">
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
      </nav>}

      {/* #14 v0.6 sc-layout — 좌측 선택 요약 + 본문 (md 미만은 상단 밴드) */}
      <div className={showFinalItinerary ? "block" : `grid ${summaryCollapsed ? "md:grid-cols-[64px_minmax(0,1fr)]" : "md:grid-cols-[220px_minmax(0,1fr)]"}`}>
      {!showFinalItinerary && <SummarySidebar
        arrivalAt={arrival.at}
        departureAt={departure.at}
        readyAt={airportReady.at}
        deadlineAt={airportDeadline.at}
        actors={selectedActors}
        works={selectedWorks}
        placeCount={selectedPlaceIds.size}
        locale={locale}
        tr={tr}
        collapsed={summaryCollapsed}
        onToggle={() => setSummaryCollapsed((on) => !on)}
      />}
      <div className="min-w-0 p-5 sm:p-6">

      {showFinalItinerary && displayedDays && (
        <FinalItineraryPage
          days={displayedDays}
          locale={locale}
          placeName={placeName}
          stationName={stationName}
          warnings={viewWarnings}
          warningLabel={(detail) => tr(`reason.${detail}` as MessageKey)}
          saveStatus={saveStub.saveStatus}
          saveStatusLabel={tr(SAVE_STATUS_KEY[saveStub.saveStatus])}
          onBackToAdjust={() => setShowFinalItinerary(false)}
          onSave={() => {
            const entry = savedEntry();
            if (entry) saveStub.requestSave(entry);
          }}
          tr={tr}
        />
      )}

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
          {searched && results.interpretedByAi && (
            <p
              aria-live="polite"
              className="mt-3 flex items-center gap-1.5 rounded border border-sc-airport/30 bg-sc-airport-soft p-3 text-sm text-sc-airport-text"
            >
              <Sparkles aria-hidden="true" className="size-4 shrink-0" />
              {tr("step2.aiInterpreted")}
            </p>
          )}
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

      {!showFinalItinerary && step === 3 && (candidateData || view.reopened) && (
        <section>
          <h2 className="text-lg font-semibold">{tr("step3.title")}</h2>
          <p className="text-sm text-sc-muted">{tr("step3.subtitle")}</p>
          {/* #61 — 접근시간이 대중교통으로 읽히지 않도록 목록 위에 한 번 고지 */}
          <p className="mt-3 text-xs text-sc-muted">{tr("access.notice")}</p>

          {/* #85 — 좌: 후보 선택 / 우: 계산 결과. 왕복 없이 같은 화면에서 판단한다 */}
          <div className="mt-3 grid gap-[18px] lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <PlaceRecommendationSheet
            selectedCount={selectedPlaceIds.size}
            totalCount={sortedCandidates.length}
            updating={updating}
            updated={lastItineraryDiff?.changed === true && !updating}
            sortBy={sortBy}
            onSortChange={setSortBy}
            remainingCount={Math.max(0, sortedCandidates.length - visibleCount)}
            onShowMore={() => setVisibleCount((n) => n + PLACES_PAGE_SIZE)}
            onBack={() => setStep(2)}
            tr={tr}
            map={candidateData ? (
              <KoreaMapPanel
                kind="places"
                places={step3MapPlaces}
                stations={mapStations}
                omittedCount={step3OmittedCount}
                tr={tr}
                headingAction={
                  <button
                    type="button"
                    aria-pressed={onlySelectedOnMap}
                    className={`min-h-[30px] rounded-lg border px-2 py-1 text-xs ${onlySelectedOnMap ? "border-sc-blue bg-sc-blue-soft text-sc-blue" : ""}`}
                    onClick={() => setOnlySelectedOnMap((on) => !on)}
                  >
                    {tr("map.filterSelected")}
                  </button>
                }
              />
            ) : null}
          >
          {candidateData ? (
          <>
          {sortedCandidates.length === 0 && (
            <li className="rounded border border-sc-orange/30 bg-sc-orange-soft p-3 text-sm text-sc-orange-text">
              {tr("step3.noCandidates")}
            </li>
          )}
          {/* #43 확정: 미확인 후보도 같은 목록에서 선택 가능 — 카드에 경고 배지 */}
          {sortedCandidates.slice(0, visibleCount).map((c) => (
            <PlaceCard key={c.id} candidate={c} locale={locale} tr={tr}
              selected={selectedPlaceIds.has(c.id)}
              stationName={stationName} workTitles={workTitles}
              aiReason={c.aiReason ?? null}
              onToggle={() => {
                const next = new Set(selectedPlaceIds);
                if (next.has(c.id)) next.delete(c.id); else next.add(c.id);
                if (next.size === 0) setLastItineraryDiff(null);
                setSelectedPlaceIds(next);
              }}
            />
          ))}
          </>
          ) : (
            <li className="rounded border border-sc-orange/30 bg-sc-orange-soft p-3 text-sm text-sc-orange-text" role="status">
              {tr(reopenCandidateStatus === "failed" ? "trips.reopenCandidatesFailed" : "common.loading")}
              {/* #130 — 실패는 대개 일시적이다. 다시 열기를 처음부터 하지 않고 후보만 다시 받는다 */}
              {reopenCandidateStatus === "failed" && (
                <button
                  type="button"
                  className="ml-2 rounded border border-sc-orange/50 bg-sc-surface px-2 py-1 text-xs font-medium"
                  onClick={() => void retryReopenCandidates()}
                >
                  {tr("trips.reopenCandidatesRetry")}
                </button>
              )}
            </li>
          )}
          </PlaceRecommendationSheet>

          {/* 우측 열 — 계산 결과. 장소를 켜고 끄면 여기서 바로 갱신된다 */}
          <div className="min-w-0" aria-busy={updating}>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold">{tr("step4.title")}</h3>
            {/* #85 리뷰 1 — 갱신 중에도 직전 일정을 지우지 않는다. 표시만 겹쳐 얹는다.
                리뷰 비차단 — 계산 시작이 아니라 선택이 바뀐 시점부터 켠다 */}
            {updating && displayedDays && (
              <span role="status" className="rounded-full bg-sc-blue-soft px-2 py-0.5 text-xs text-sc-blue">
                {tr("step4.updating")}
              </span>
            )}
          </div>
          <p className="text-sm text-sc-muted">{tr("step4.subtitle")}</p>

          {/* #83 §F sc-data-notice — 이 열의 숫자가 어디서 왔는지. 결과 유무와 무관하게 항상 둔다.
              헤더의 "데모 스냅샷" 배지는 제품 전체 라벨이고, 이쪽은 이 결과의 데이터 근거와
              예약 전 재확인 안내라 역할이 다르다 */}
          <p className="mt-3 rounded-lg border bg-sc-subtle px-3 py-2 text-xs text-sc-muted">
            <strong className="font-medium text-sc-text">{tr("step4.dataNoticeTitle")}</strong>{" "}
            {tr("step4.dataNotice")}
          </p>

          {/* 아직 보여줄 일정 자체가 없을 때만 자리를 차지하는 안내로 바꾼다 */}
          {updating && !displayedDays && !needsSelection && (
            <p className="mt-6 text-center text-sm text-sc-muted">{tr("step4.generating")}</p>
          )}

          {/* #85 리뷰 2 — 0곳이면 직전 선택의 일정을 남기지 않는다. 저장도 함께 막힌다 */}
          {needsSelection && (
            <p className="mt-6 rounded-lg border bg-sc-subtle px-3 py-6 text-center text-sm text-sc-muted">
              {tr("step4.needSelection")}
            </p>
          )}

          {!view.planning && view.planError && (
            <div className="mt-4 rounded-lg border border-sc-red/30 bg-sc-red/5 p-4 text-sm text-sc-red">
              {tr(view.planError === "invalid" ? "step4.errInvalid" : "step4.errUnexpected")}
            </div>
          )}

          {viewBanner && (
            <div className="mt-4 rounded-lg border border-sc-airport/30 bg-sc-airport-soft p-3 text-sm text-sc-airport-text">
              {tr(viewBanner === "reopened" ? "trips.reopened" : viewBanner === "gateway" ? "gateway.swapped" : "alt.swapped")}
            </div>
          )}

          {lastItineraryDiff && !updating && !view.reopened && (
            <ItineraryChangeSummary
              diff={lastItineraryDiff}
              placeName={placeName}
              reasonLabel={(reason) => tr(`reason.${reason}` as MessageKey)}
              tr={tr}
            />
          )}

          {selectionCapacity?.requiresAdjustment && (
            <div
              className="mt-4 rounded-lg border border-sc-orange/40 bg-sc-orange-soft p-4"
              role="status"
            >
              <h3 className="font-medium text-sc-orange-text">{tr("step4.overselectionTitle")}</h3>
              <p className="mt-2 font-medium text-sc-orange-text">
                {tr("step4.overselectionSummary")
                  .replace("{selected}", String(selectionCapacity.selectedCount))
                  .replace("{schedulable}", String(selectionCapacity.schedulableCount))
                  .replace("{minimum}", String(selectionCapacity.minimumExclusionCount))}
              </p>
              <p className="mt-1 text-sm text-sc-orange-text">{tr("step4.overselectionDesc")}</p>
              <p className="mt-1 text-xs text-sc-orange-text">{tr("step4.overselectionPreview")}</p>
              {/* #85 — 후보 목록이 같은 화면 좌측에 있으므로 화면 전환 대신 그쪽으로 이동시킨다 */}
              <a
                href="#place-picker"
                className="mt-3 inline-block rounded border border-sc-orange/50 bg-sc-surface px-3 py-2 text-sm font-medium text-sc-orange-text"
              >
                {tr("step4.adjustPlaces")}
              </a>
            </div>
          )}

          {displayedDays && (
            // 갱신 중에는 살짝 흐리게 — 지금 보이는 게 직전 결과라는 걸 알 수 있어야 한다
            <div className={`mt-4 space-y-4 ${updating ? "opacity-60 transition-opacity" : ""}`}>
              {!view.reopened && view.result?.status === "planned" && (
                <GatewayAlternatives
                  alternatives={view.result.gatewayAlternatives ?? []}
                  selectedId={view.selectedAlt?.kind === "gateway_bus" ? view.selectedAlt.id : null}
                  locale={locale}
                  onSelect={chooseAlternative}
                  tr={tr}
                />
              )}
              {/* #14 v0.6 sc-result-grid — 좌측 일정 타임라인 + 우측 지도·경고·실행 지원 */}
              <div className="grid gap-[18px] md:grid-cols-[minmax(0,1fr)_minmax(360px,1fr)] md:items-start">
                <div className="min-w-0 space-y-4">
              {displayedDays.map((day) => {
                const baseDay = baseDays?.find((d) => d.date === day.date);
                return (
                  <div key={day.date} className="rounded-lg border p-4">
                    <h3 className="font-medium">{day.date}</h3>
                    <ul className="mt-2 space-y-1 text-sm">
                      {/* #14: 장소 단위 시각 미표기 — 역 단위 활용시간은 regionWindows로 표시 (#33) */}
                      {day.items.map((item) => (
                        <li key={item.placeId} className="flex items-center text-sc-text/80">
                          <MapPin aria-hidden="true" className="mr-1 size-3.5 shrink-0 text-sc-blue" />
                          {placeName(item.placeId)}
                          <span className="ml-2 text-xs text-sc-muted">{accessLabel(item.accessMinutes)}</span>
                        </li>
                      ))}
                    </ul>
                    {day.rides.length + (day.gatewayLegs?.length ?? 0) > 0 && (
                      <details className="mt-3 rounded-lg border bg-sc-subtle/60" data-planning-transport>
                        <summary className="flex min-h-10 list-none items-center justify-between gap-2 px-3 py-2 text-sm font-medium">
                          <span>
                            {tr("step4.transportSummary").replace(
                              "{n}",
                              String(day.rides.length + (day.gatewayLegs?.length ?? 0)),
                            )}
                          </span>
                          <span className="text-xs text-sc-muted">{tr("step4.transportHint")}</span>
                        </summary>
                        <ul className="space-y-1 border-t px-3 py-2 text-sm">
                          {(day.gatewayLegs ?? []).map((leg) => (
                            <li key={leg.id} className="text-sc-text/80">
                              {fmtTime(leg.departAt)} {leg.fromName[locale]} → {fmtTime(leg.arriveAt)} {leg.toName[locale]}
                              <span className="ml-2 text-xs text-sc-muted/70">{leg.serviceName[locale]} · {leg.operator[locale]}</span>
                            </li>
                          ))}
                          {/* 조율 중에는 장소가 주정보다. 열차 번호·소요시간은 사용자가 펼쳤을 때만
                              기존 상세 모달 계약과 함께 제공한다 (#118 P0-3). */}
                          {day.rides.map((ride) => (
                            <li key={`${ride.trainNo}-${ride.departAt}`}>
                              <button
                                type="button"
                                className="-mx-1 w-full rounded border border-transparent px-1 py-0.5 text-left text-sc-text/80 hover:border-sc-blue"
                                onClick={() => setOpenTrainLeg({
                                  trainNo: ride.trainNo,
                                  fromName: stationName(ride.fromStationId),
                                  toName: stationName(ride.toStationId),
                                  departAt: ride.departAt,
                                  arriveAt: ride.arriveAt,
                                })}
                              >
                                {fmtTime(ride.departAt)} {stationName(ride.fromStationId)} → {fmtTime(ride.arriveAt)} {stationName(ride.toStationId)}
                                {" · "}{legDurationLabel(ride.departAt, ride.arriveAt, tr)}
                                <span className="ml-2 text-xs text-sc-muted/70 underline decoration-dotted underline-offset-2">
                                  {tr("step4.train")} {ride.trainNo}
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
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
              </div>

              <div className="min-w-0 space-y-4">
              <ItineraryRouteMap
                days={displayedDays}
                places={mappablePlaces}
                stations={mapStations}
                railLines={railGeometry.lines}
                tr={tr}
                sticky
                // 기본 지도는 공항·철도·촬영지만 — 권역은 토글을 눌렀을 때만 나타난다 (#14 v0.6)
                headingAction={
                  themeExperience?.status === "ok" && themeExperience.point ? (
                    <button
                      type="button"
                      aria-pressed={themeMapVisible}
                      onClick={() => setThemeMapVisible((visible) => !visible)}
                      className="rounded border px-2 py-0.5 text-xs text-sc-muted hover:border-sc-blue hover:text-sc-blue"
                    >
                      {tr(themeMapVisible ? "theme.mapFilterHide" : "theme.mapFilterShow")}
                    </button>
                  ) : undefined
                }
                experienceOverlay={
                  <ThemeExperienceMapOverlay result={themeExperience} visible={themeMapVisible} />
                }
                experienceLegend={
                  themeMapVisible && themeExperience?.status === "ok" && themeExperience.point ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block size-2 rounded-full border border-dashed border-sc-blue bg-sc-blue/15" />
                      {tr("theme.mapLegend")}
                    </span>
                  ) : undefined
                }
                // A3 — 원이 검증된 권역 경계로 읽히지 않도록 표시 중에는 항상 붙인다 (PR #88 리뷰)
                experienceNotice={
                  themeMapVisible && themeExperience?.status === "ok" && themeExperience.point ? (
                    <p className="mt-2 text-xs text-sc-muted">{tr("theme.mapPointNotice")}</p>
                  ) : undefined
                }
              />
              {/* #83 §F validation-copy — 이 일정이 무엇을 지켰는지. 지도 아래, 경고·미배치 목록
                  바로 위에 둬서 "지킨 것 → 다만 이런 예외가 있다" 순서로 읽히게 한다.
                  displayedDays가 있을 때만 렌더되므로 empty·선택 0곳에서는 나오지 않는다 */}
              <p className="rounded-lg border bg-sc-subtle px-3 py-2 text-xs text-sc-muted">
                {tr("step4.validation")}
              </p>
              {viewWarnings.length > 0 && (
                // #43 수용 기준: 경고 누락 0건 — 배치는 유지하되 방문 전 확인을 안내
                <div className="rounded-lg border border-sc-orange/30 bg-sc-orange-soft p-4">
                  <h3 className="text-sm font-medium text-sc-orange-text">{tr("step4.warningsTitle")}</h3>
                  <ul className="mt-2 space-y-1 text-sm text-sc-orange-text">
                    {viewWarnings.map((warning) => (
                      <li key={warning.placeId} className="flex items-start gap-1.5">
                        <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                        <span>{placeName(warning.placeId)} — {tr(`reason.${warning.detail}` as MessageKey)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {uncoveredSelectionGroups.length > 0 && (
                <div className="rounded-lg border border-sc-orange/30 bg-sc-orange-soft p-4">
                  <h3 className="text-sm font-medium text-sc-orange-text">
                    {tr("step4.uncoveredGroupsTitle")}
                  </h3>
                  <ul className="mt-2 space-y-1 text-sm text-sc-orange-text">
                    {uncoveredSelectionGroups.map(({ group, reasons }) => (
                      <li key={group}>
                        {tr(group === "actor" ? "step4.groupActor" : "step4.groupWork")}
                        {" — "}
                        {reasons.map((reason) => tr(`reason.${reason}` as MessageKey)).join(" · ")}
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
                        {placeName(reason.placeId)} — {rejectionLabel(reason)}
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
                mapVisible={themeMapVisible}
                onToggleMap={() => setThemeMapVisible((visible) => !visible)}
              />
              {/* #24 A5 — 역 시설·짐 보관: 일정에 등장하는 역만, 스냅샷 수록분만 안내 */}
              <ExecutionSupport
                snapshot={stationFacilities}
                stationIds={[...new Set(displayedDays.flatMap((day) => [
                  ...day.rides.flatMap((ride) => [ride.fromStationId, ride.toStationId]),
                  ...(day.gatewayLegs ?? []).flatMap((leg) => [leg.fromStationId, leg.toStationId]),
                  ...day.regionWindows.map((window) => window.stationId),
                ]))]}
                stationName={stationName}
                tr={tr}
              />
              </div>
              </div>

              {openTrainLeg && (
                <TrainLegModal leg={openTrainLeg} onClose={() => setOpenTrainLeg(null)} tr={tr} />
              )}
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
                      {placeName(reason.placeId)} — {rejectionLabel(reason)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            {/* #85 — "촬영지 다시 선택"은 왕복이 사라져 필요 없다. 항공편만 1단계로 돌아간다 */}
            <div className="flex gap-2">
              <button className="rounded border px-3 py-2 text-sm" onClick={() => setStep(1)}>{tr("step4.editFlights")}</button>
              <button className="rounded border px-3 py-2 text-sm" onClick={plan}>{tr("step4.recalculate")}</button>
            </div>
            <button
              type="button"
              className="rounded bg-sc-blue px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
              disabled={!displayedDays || updating || needsSelection || selectionCapacity?.requiresAdjustment}
              onClick={() => setShowFinalItinerary(true)}
              data-open-final
            >
              {tr("step4.openFinal")}
            </button>
          </div>
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

function PlaceCard({ candidate, locale, tr, selected, onToggle, stationName, workTitles, aiReason }: {
  candidate: PlaceCandidate;
  locale: Locale;
  tr: (key: MessageKey) => string;
  selected: boolean;
  onToggle: () => void; // #43: 미확인 후보도 선택 가능 — 표시 전용 카드 없음
  stationName: (id: string) => string;
  workTitles: (ids: string[]) => string;
  aiReason?: { ko: string; en: string } | null; // #48 — 검증된 장면 근거(점수 비노출)
}) {
  // 카드는 기본이 요약이다. 작품·회차·장면·검토 이유·출처를 한 번에 펼치면 후보 5개만으로
  // 화면이 꽉 차서 "무엇을 고를지"가 안 보인다 — 판단에 필요한 것만 남기고 근거는 토글 뒤로.
  const [showDetail, setShowDetail] = useState(false);
  const oh = candidate.openingHours;
  const hoursLabel =
    oh.type === "always_open" ? tr("step3.alwaysOpen")
    : oh.type === "hours" ? `${oh.open}–${oh.close}`
    : null; // 미확인은 텍스트 대신 경고 배지 (#43)
  // PR #59 리뷰 1 — 시드의 출처 설명은 한국어 원문이라 영어 모드에서는 번역 가능한
  // 라벨·확인일만 표시한다. 출처 ko/en 구조화는 #4 다국어 범위에서 후속 결정.
  // URL은 문구에서 떼어내 링크 뒤로 숨긴다 — 카드가 도메인 문자열로 뒤덮이지 않게.
  const sourceParts = oh.type !== "unverified" ? splitSourceLink(oh.source) : null;
  const sourceLabel = oh.type !== "unverified" && sourceParts
    ? locale === "ko"
      ? `${sourceParts.label} · ${oh.verifiedAt} ${tr("step3.verifiedAt")}`
      : `${tr("step3.officialSource")} · ${tr("step3.verifiedAt")} ${oh.verifiedAt}`
    : null;
  const photo = placePhoto(candidate.id);

  return (
    <li
      className={`rounded-lg border p-3 ${selected ? "border-sc-blue bg-sc-blue-soft/60" : ""}`}
      data-recommendation-card
    >
      <div className="flex items-start justify-between gap-2">
        {/* 이름·좌표·이미지를 검증한 TourAPI 제1유형 사진만 쓴다. 나머지는 추정 사진
            대신 동일한 플레이스홀더 프레임과 Lucide 장소 유형 표식을 유지한다. */}
        <PlaceThumbnail
          label={tr("step3.photoPlaceholder")}
          photo={photo}
          locale={locale}
        >
          <PlaceTypeIcon placeType={candidate.placeType} />
        </PlaceThumbnail>
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-medium">
            {candidate.name[locale]}
            {candidate.selectionGroups.map((group) => (
              <span
                key={group}
                className="ml-2 rounded bg-sc-subtle px-1.5 py-0.5 text-xs text-sc-muted"
              >
                {tr(group === "work" ? "step3.relationSelected" : "step3.relationActor")}
              </span>
            ))}
          </p>
          {/* 요약 — 어디인지, 얼마나 걸리는지, 열려 있는지. 고르는 데 필요한 것만 */}
          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-sc-muted">
            <span>
              {stationName(candidate.nearestStationId)} · {tr("access.byCar").replace("{n}", String(candidate.accessEstimate.minutes))}
            </span>
            {hoursLabel ? (
              <span>· {hoursLabel}</span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded bg-sc-orange-soft px-1.5 py-0.5 text-sc-orange-text">
                <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0" />
                {tr("step3.hoursUnverified")}
              </span>
            )}
          </p>

          <button
            type="button"
            aria-expanded={showDetail}
            className="mt-1.5 text-xs text-sc-blue underline underline-offset-2"
            onClick={() => setShowDetail((open) => !open)}
          >
            {tr(showDetail ? "step3.hideDetail" : "step3.showDetail")}
          </button>

          {showDetail && (
            <div className="mt-1.5 border-t pt-1.5">
              {/* #51 계약 5·6·7 — 작품별 `작품명 · 회차` + 검증된 장면 설명, 회차 미확인은 작품명만.
                  회차는 locale 포맷(영문 Ep. N) — 숫자 패턴이 아니면 영어에서 숨김 */}
              {candidate.relationDetails.length > 0 ? (
                candidate.relationDetails.map((detail) => {
                  const episode = formatEpisodeLabel(locale, detail.episodeLabel);
                  return (
                    <p key={detail.workId} className="text-xs text-sc-muted">
                      <span className="font-medium">
                        {workTitles([detail.workId])}
                        {episode ? ` · ${episode}` : ""}
                      </span>
                      {detail.sceneNote ? ` — ${detail.sceneNote[locale]}` : ""}
                    </p>
                  );
                })
              ) : (
                <p className="text-xs text-sc-muted">{workTitles(candidate.workIds)}</p>
              )}
              {/* #48 — 검토된 항목의 관련 이유만 ko/en 표시, 내부 점수는 노출하지 않는다 */}
              {aiReason && (
                <p className="mt-0.5 flex items-start gap-1 text-xs text-sc-airport-text">
                  <Sparkles aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                  <span>{tr("step3.aiReasonLabel")}: {aiReason[locale]}</span>
                </p>
              )}
              {sourceLabel && (
                <p className="mt-0.5 text-xs text-sc-muted/80">
                  {sourceParts?.url ? (
                    <a
                      href={sourceParts.url}
                      target="_blank"
                      rel="noreferrer"
                      className="underline underline-offset-2 hover:text-sc-blue"
                      title={tr("step3.sourceLink")}
                    >
                      {sourceLabel}
                    </a>
                  ) : (
                    sourceLabel
                  )}
                </p>
              )}
              {photo && (
                <p className="mt-0.5 text-xs text-sc-muted/80">
                  <a
                    href={photo.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-2 hover:text-sc-blue"
                    title={locale === "ko" ? "사진 원본 열기" : "Open original photo"}
                  >
                    {locale === "ko"
                      ? `사진: ${photo.provider} · ${photo.license}`
                      : "Photo: Korea Tourism Organization TourAPI · KOGL Type 1"}
                  </a>
                </p>
              )}
            </div>
          )}
        </div>
        <button
          className={`shrink-0 rounded px-3 py-1 text-sm ${selected ? "bg-sc-blue text-white" : "border"}`}
          onClick={onToggle}
          aria-label={tr(selected ? "step3.removePlace" : "step3.addPlace").replace("{place}", candidate.name[locale])}
          aria-pressed={selected}
        >
          {selected ? "✓" : "+"}
        </button>
      </div>
    </li>
  );
}
