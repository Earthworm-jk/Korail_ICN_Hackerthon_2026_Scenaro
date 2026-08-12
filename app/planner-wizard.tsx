"use client";
/**
 * 4단계 위저드 골격 — 여행 조건 → K-콘텐츠 → 촬영지 → 일정 결과 (ver.0.3·#14 ver.0.4 확정)
 * - 배우·작품 복수 선택 칩, 필수 방문 없음(전부 자유 선택), 방문지별 시각 미표기(역 단위 체류)
 * - 편집 = 촬영지 재선택·항공 시각 변경 후 전체 재계산 (무상태)
 * - 대안 시간표는 mock(#14 ⑨ 선행), 저장·내 일정은 in-memory 스텁(#25 선행) — 엔진·Supabase 연결 시 교체
 */
import { useCallback, useEffect, useId, useMemo, useReducer, useRef, useState, useTransition } from "react";
import { BusFront, Hourglass, Info, Sparkles, TrainFront, TriangleAlert, X } from "lucide-react";
import { PlaceOrderMenu } from "./place-order-menu";
import { StageUtilityPortal } from "./stage-utility-portal";
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
import {
  runItineraryCommand,
  runDayMove,
  runVisitDateEdit,
  runVisitOrderEdit,
  type RouteRecommendation,
} from "@/lib/actions/itinerary-command";
import { excludedPlaceIdsFrom, initialCandidateIds } from "@/lib/candidates";
import { initialPlaceIdsFromItinerary } from "@/lib/initial-place-selection";
import {
  commandPanelUnavailable,
  canEditVisitDate,
  panelDismissable,
  commandResponseIsCurrent,
  selectionAfterCommand,
  stateAfterRouteRecommendation,
} from "@/lib/itinerary-command-ui";
import { sortCandidatePlaces } from "@/lib/place-ranking";
import { getFlightInfo } from "@/lib/actions/flights";
import { t, withValues, type Locale, type MessageKey } from "@/lib/i18n/messages";
import { buildMockAlternatives } from "@/lib/alternatives-mock";
import {
  constraintsFromTripInputs,
  defaultSavedTitle,
  SAVED_SCHEMA_VERSION,
  tripInputsFromConstraints,
  type SavedItineraryStub,
} from "@/lib/saved-itineraries-stub";
import {
  banner,
  displayedSelectionCapacity,
  type ItineraryView,
  displayedDays as deriveDisplayedDays,
  initialItineraryView,
  itineraryWarnings as deriveWarnings,
  recommendedDays,
  reduceItineraryView,
  rejectedPlaces as deriveRejectedPlaces,
  showEmpty,
  themeChipState,
  type SelectableAlternative,
} from "@/lib/itinerary-view";
import { selectionResultIsCurrent } from "@/lib/selection-capacity";
import { autoPlanDecision } from "@/lib/auto-plan";
import { collectDisplayNames, resolveDisplayName } from "@/lib/display-names";
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
import { FinalItineraryPage } from "./final-itinerary-page";
import { DayStationFacilities } from "./day-context";
import { DayMoveMenu } from "./day-move-menu";
import { DayGatewayInfo } from "./day-gateway";
import { ItineraryChangeSummary } from "./itinerary-change-summary";
import {
  ItineraryCommandPanel,
  type CommandFeedback,
  type ProposalOutcome,
} from "./itinerary-command-panel";
import { ItineraryRouteMap, type MapPlace, type MapStation } from "./korea-map";
import { PlaceRecommendationSheet, PlaceThumbnail } from "./place-recommendation-sheet";
import { PlaceBrowser } from "./place-browser";
import sheetStyles from "./place-recommendation-sheet.module.css";
import { airportLegsOf, itineraryRowsOf, rowKey, shouldNoteAirportRail, stationIdsOf } from "@/lib/itinerary-rows";
import { MoveRow } from "./move-row";
import { ThemeExperienceChip, ThemeExperienceMapOverlay } from "./theme-experience";
import { TrainLegModal, legDurationLabel, type TrainLegDetail } from "./train-leg-modal";
import { getThemeExperience, type ThemeExperienceResult } from "@/lib/actions/theme-experience";
import type { StationFacilitiesSnapshotT } from "@/lib/station-facilities";
import type { StationCoordinatesSnapshotT } from "@/lib/station-coordinates";
import type { RailGeometrySnapshotT } from "@/lib/rail-geometry";
import type { DayPlan } from "@/lib/engine/types";
import { undoPointOf, type UndoPoint } from "@/lib/itinerary-undo";
import { displayRejectionCode, groupRejections } from "@/lib/rejection-groups";

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

/** 그 장소가 지금 배치된 날짜 — 같은 날 드롭을 걸러내는 데 쓴다 (#109) */
function dateOfPlace(days: DayPlan[] | null, placeId: string): string | undefined {
  return days?.find((day) => day.items.some((item) => item.placeId === placeId))?.date;
}

export default function PlannerWizard({ stationFacilities, stationCoordinates, railGeometry }: {
  stationFacilities: StationFacilitiesSnapshotT;
  stationCoordinates: StationCoordinatesSnapshotT;
  railGeometry: RailGeometrySnapshotT;
}) {
  const [locale, setLocale] = useState<Locale>("ko");
  /**
   * 단계와 **지금까지 가 본 가장 먼 단계**를 함께 든다 (#146).
   *
   * nav로 앞 단계에 돌아갔을 때 원래 있던 자리로 되돌아올 수 있어야 한다. `step`
   * 하나로 판정하면 3단계에서 2단계로 내려가는 순간 3단계 버튼이 잠겨 조건을 다시
   * 다 통과해야 한다 - 실제로 그렇게 막혔다.
   *
   * 파생이 아니라 같은 갱신에서 올린다 — `step`을 보고 effect로 따라 올리면 렌더가
   * 한 번 더 돌고, 그 사이 한 프레임 동안 버튼이 잠긴 채로 보인다.
   */
  const [{ step, furthestStep }, setStepState] = useState({ step: 1, furthestStep: 1 });
  const setStep = useCallback((next: number) => {
    setStepState((current) => ({ step: next, furthestStep: Math.max(current.furthestStep, next) }));
  }, []);
  const [showFinalItinerary, setShowFinalItinerary] = useState(false);
  // 요약 사이드바 접기 — 접으면 본문(지도·일정)이 220px을 더 쓴다
  const [summaryCollapsed, setSummaryCollapsed] = useState(false);
  const tr = useCallback((key: MessageKey) => t(locale, key), [locale]);

  // Popover API의 light-dismiss 동작은 내장 브라우저·WebView별 편차가 있다. 열린 패널을
  // 바깥 클릭과 Escape로 확실히 닫아 일정 안내와 장소 상세가 화면에 남지 않게 한다.
  useEffect(() => {
    const hideOpenPopovers = () => {
      document.querySelectorAll<HTMLElement>(":popover-open").forEach((popover) => {
        popover.hidePopover();
      });
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") hideOpenPopovers();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      document.querySelectorAll<HTMLElement>(":popover-open").forEach((popover) => {
        const invoker = [...document.querySelectorAll<HTMLElement>("[popovertarget]")]
          .find((element) => element.getAttribute("popovertarget") === popover.id);
        if (!popover.contains(target) && !invoker?.contains(target)) popover.hidePopover();
      });
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, []);

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
  // 자연어 방문일 선호는 일반 선택과 별도 입력이다. 적용 후 수동 재계산·저장에도 유지한다.
  const [preferredVisitDates, setPreferredVisitDates] = useState<Record<string, string>>({});
  const [reopenCandidateStatus, setReopenCandidateStatus] = useState<"loading" | "failed" | null>(null);
  const [sortBy, setSortBy] = useState<"relevance" | "official">("relevance");
  // 후보 목록은 5곳씩 — 한 화면에 다 쏟으면 무엇을 고를지가 안 보인다. 표시 개수만 늘린다
  /** 전체 보기 안의 좁히기 상태. 시트 밖에 필터를 늘어놓으면 시트가 다시 무거워진다 */
  const [browserOpen, setBrowserOpen] = useState(false);
  const [browserStation, setBrowserStation] = useState<string | null>(null);
  const [browserWork, setBrowserWork] = useState<string | null>(null);

  // step 4 — 결과. 전이 규칙·파생은 lib/itinerary-view 순수 함수로 고정 (PR #35 리뷰 3)
  const [view, dispatchView] = useReducer(reduceItineraryView, initialItineraryView);
  // 직전 확정 결과와 최신 성공 결과의 차이. 엔진 상태와 분리된 발표용 표현 상태다 (#118 P0-2).
  const [lastItineraryDiff, setLastItineraryDiff] = useState<ItineraryDiff | null>(null);
  const [aiSentence, setAiSentence] = useState("");
  const [aiFeedback, setAiFeedback] = useState<CommandFeedback | null>(null);
  // #109 드래그 — 잡고 있는 장소와 올라가 있는 날짜. 표시 전용 상태다
  const [draggingPlaceId, setDraggingPlaceId] = useState<string | null>(null);
  /** 같은 날 순서 드래그에서 지금 겨냥한 카드 (#145) — 어느 앞으로 갈지 화면으로 알린다 */
  const [dragOverPlaceId, setDragOverPlaceId] = useState<string | null>(null);
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);
  const [draggingDayDate, setDraggingDayDate] = useState<string | null>(null);
  /**
   * 부작용 없는 변경을 즉시 적용한 직후의 되돌리기 지점 (#145 · PR #150 리뷰 2번).
   *
   * 원래 날짜 버튼을 다시 누르는 것은 실행 취소가 아니다 — 소프트 선호와 전체 재계산 탓에
   * 역방향 명령이 원래 일정과 같은 결과를 보장하지 않는다. **명령 직전 상태를 통째로**
   * 들고 있다가 복원한다.
   */
  /** #151 — 조율 패널은 기본적으로 접혀 있고 아이콘으로 연다 */
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  /** 발견성 보완 라벨. 한 번 열면 다시 보여 주지 않는다 */
  const aiTriggerRef = useRef<HTMLButtonElement>(null);
  const [undoPoint, setUndoPoint] = useState<
    UndoPoint<ItineraryView["selectedAlt"], typeof saveStub.saveStatus> | null
  >(null);
  const [aiPending, startAiTransition] = useTransition();
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
    setAiFeedback(null);
    const c = record.constraints;
    const inputs = tripInputsFromConstraints(c);
    setArrival((f) => ({ ...f, at: inputs.arrivalAt }));
    setDeparture((f) => ({ ...f, at: inputs.departureAt }));
    // 저장 당시 절대 시각을 그대로 복원 — 이후 항공편 변경이 파생 기본값으로 덮지 않게 touched 고정
    setAirportReady({ at: inputs.airportReadyAt, touched: true });
    setAirportDeadline({ at: inputs.airportArrivalDeadline, touched: true });
    setPreferredVisitDates(c.preferredVisitDates ?? {});
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
  }, [refreshThemeExperience, setStep]);

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
    setPreferredVisitDates({});
    setAiFeedback(null);
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
      setBrowserStation(null);
      setBrowserWork(null);
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
      setBrowserStation(null);
      setBrowserWork(null);
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
    setStep,
  ]);

  /** 현재 입력 상태의 전체 재계산 constraints — 저장 레코드와 plan 호출이 같은 값을 쓴다 */
  const currentConstraints = useCallback(() => {
    if (!candidateData) return null;
    const base = constraintsFromTripInputs(
      { arrivalAt: arrival.at, departureAt: departure.at, airportReadyAt: airportReady.at, airportArrivalDeadline: airportDeadline.at },
      selectedActors.map((a) => a.id),
      selectedWorks.map((w) => w.id),
      excludedPlaceIdsFrom(candidateData.candidates, selectedPlaceIds),
    );
    return Object.keys(preferredVisitDates).length > 0
      ? { ...base, preferredVisitDates }
      : base;
  }, [candidateData, selectedPlaceIds, preferredVisitDates, arrival.at, departure.at, airportReady.at, airportDeadline.at, selectedActors, selectedWorks]);

  /** 서버가 돌려준 제안을 실제 화면 상태에 반영한다. 확인 전에는 절대 호출하지 않는다. */
  const applyCommandOutcome = useCallback((outcome: ProposalOutcome, submittedSequence: number) => {
    if (!candidateData || outcome.proposal.decision === "impossible") return;
    // 자동·수동 적용 모두 제출 당시 화면에만 유효하다. 응답 뒤 다시 계산하거나 항공 시각을
    // 바꾼 경우에도 옛 nextResult를 새 입력 위에 덮지 않고 취소 이유를 사용자에게 알린다.
    if (!commandResponseIsCurrent(submittedSequence, planSequence.current)) {
      setAiFeedback({ kind: "cancelled" });
      return;
    }
    // 되돌리기 지점은 화면을 바꾸기 **전에** 잡는다. 담는 필드는 lib에 모아 뒀다
    setUndoPoint(undoPointOf({
      selectedPlaceIds,
      preferredVisitDates,
      result: view.result,
      selectedAlt: view.selectedAlt,
      diff: lastItineraryDiff,
      settledSelectionKey,
      saveStatus: saveStub.saveStatus,
      themeExperience,
      themeMapVisible,
    }));
    const sequence = ++planSequence.current;
    const scheduledPlaceIds = new Set(
      outcome.nextResult.status === "planned"
        ? outcome.nextResult.days.flatMap((day) => day.items.map(({ placeId }) => placeId))
        : [],
    );
    // 확인 대화에서 고지한 displaced 장소는 사용자가 변경 적용을 누른 순간 선택에서도
    // 제외되어야 한다. 그렇지 않으면 일정·지도는 8곳인데 선택 카운터만 9곳으로 남아
    // "모두 배치할 수 없음" 상태가 되어 저장이 막힌다.
    const displacedPlaceIds = new Set(
      outcome.proposal.displaced.map(({ placeId }) => placeId),
    );
    const selected = selectionAfterCommand({
      candidatePlaceIds: candidateData.candidates.map(({ id }) => id),
      currentSelectedPlaceIds: selectedPlaceIds,
      scheduledPlaceIds,
      displacedPlaceIds,
    });
    const appliedRequest = {
      ...outcome.nextRequest,
      excludedPlaceIds: candidateData.candidates
        .filter(({ id }) => !selected.has(id))
        .map(({ id }) => id),
    };
    const nextSelectionKey = [...selected].sort().join("|");
    setSelectedPlaceIds(selected);
    setSettledSelectionKey(nextSelectionKey);
    setPreferredVisitDates(outcome.nextRequest.preferredVisitDates ?? {});
    setLastItineraryDiff(outcome.diff);
    dispatchView({ type: "PLAN_SUCCESS", result: outcome.nextResult });
    saveStub.markDirty();
    setAiFeedback((current) => current?.kind === "proposal"
      ? { ...current, applied: true }
      : current);

    if (outcome.nextResult.status === "planned") {
      const baseline = gatewayPlanningBaselineOf(outcome.nextResult);
      if (baseline) {
        void planGatewayAlternatives(appliedRequest, baseline).then((gateway) => {
          if (sequence !== planSequence.current || !gateway.ok) return;
          dispatchView({ type: "GATEWAY_ALTERNATIVES_SUCCESS", alternatives: gateway.alternatives });
        }).catch(() => {
          // 자연어 변경은 이미 적용됐다. 비차단 대안 실패가 현재 결과를 되돌리지는 않는다.
        });
      }
      void refreshThemeExperience(outcome.nextResult.days, appliedRequest.selectedWorkIds);
    }
  }, [
    candidateData, selectedPlaceIds, saveStub, refreshThemeExperience,
    // 되돌리기 지점이 오래된 값을 잡지 않도록 스냅샷이 읽는 상태를 모두 넣는다
    view.result, view.selectedAlt, preferredVisitDates, lastItineraryDiff, settledSelectionKey,
    themeExperience, themeMapVisible,
  ]);

  /** 동선 추천은 카드를 누른 뒤에만 선택·방문일 선호로 반영한다. */
  const applyRouteRecommendation = useCallback((
    recommendation: RouteRecommendation,
    submittedSequence: number,
  ) => {
    if (!candidateData || !candidateData.candidates.some(({ id }) => id === recommendation.placeId)) return;
    if (!commandResponseIsCurrent(submittedSequence, planSequence.current)) {
      setAiFeedback({ kind: "cancelled" });
      return;
    }
    ++planSequence.current;
    const next = stateAfterRouteRecommendation({
      currentSelectedPlaceIds: selectedPlaceIds,
      currentPreferredVisitDates: preferredVisitDates,
      recommendation,
    });
    setSelectedPlaceIds(next.selectedPlaceIds);
    setPreferredVisitDates(next.preferredVisitDates);
    setAiFeedback(null);
    saveStub.markDirty();
  }, [candidateData, selectedPlaceIds, preferredVisitDates, saveStub]);


  const submitItineraryCommand = useCallback((sentence: string) => {
    const request = currentConstraints();
    if (!request || !view.result || view.reopened || view.selectedAlt !== null) return;
    const normalized = sentence.trim();
    if (!normalized) return;
    // 제출 시점의 입력 상태를 식별한다. 이후 카드 토글·재계산이 이 값을 올리면 도착한
    // 응답은 현재 화면을 대상으로 한 것이 아니므로 feedback과 자동 적용을 모두 버린다.
    const submittedSequence = ++planSequence.current;
    setAiSentence(normalized);
    setAiFeedback(null);
    startAiTransition(async () => {
      try {
        const result = await runItineraryCommand({ sentence: normalized, request });
        if (!commandResponseIsCurrent(submittedSequence, planSequence.current)) {
          setAiFeedback({ kind: "cancelled" });
          return;
        }
        if (!result.ok) {
          setAiFeedback({ kind: "error" });
          return;
        }
        if (result.outcome.kind === "clarify") {
          setAiFeedback({
            kind: "clarify",
            interpretation: result.interpretation,
            clarification: result.outcome.clarification,
          });
          return;
        }
        if (result.outcome.kind === "explain") {
          setAiFeedback({ kind: "explain", interpretation: result.interpretation });
          return;
        }
        if (result.outcome.kind === "recommendations") {
          setAiFeedback({
            kind: "recommendations",
            interpretation: result.interpretation,
            outcome: result.outcome,
            submittedSequence,
          });
          return;
        }
        const feedback: CommandFeedback = {
          kind: "proposal",
          interpretation: result.interpretation,
          outcome: result.outcome,
          applied: false,
          submittedSequence,
        };
        setAiFeedback(feedback);
        if (result.outcome.proposal.decision === "ready") {
          applyCommandOutcome(result.outcome, submittedSequence);
        }
      } catch {
        if (!commandResponseIsCurrent(submittedSequence, planSequence.current)) {
          setAiFeedback({ kind: "cancelled" });
          return;
        }
        setAiFeedback({ kind: "error" });
      }
    });
  }, [currentConstraints, view.result, view.reopened, view.selectedAlt, applyCommandOutcome]);

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
    preferredVisitDates,
    // 재열람 중에는 저장된 일정을 보여주는 중이라 초안을 덮지 않는다
    enabled: reopened === null,
    onRestore: async (draft) => {
      setArrival((f) => ({ ...f, at: draft.trip.arrivalAt }));
      setDeparture((f) => ({ ...f, at: draft.trip.departureAt }));
      setAirportReady({ at: draft.trip.airportReadyAt, touched: draft.trip.airportReadyTouched });
      setAirportDeadline({ at: draft.trip.airportArrivalDeadline, touched: draft.trip.airportDeadlineTouched });
      setSelectedActors(draft.context.actors);
      setSelectedWorks(draft.context.works);
      setPreferredVisitDates(draft.preferredVisitDates);
      setAiFeedback(null);
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
    view.planning || aiPending ||
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
  /**
   * 배치 수를 말해도 되는가 (PR #156 리뷰 3).
   *
   * 갱신 중이거나, 표시 중인 결과가 현재 선택으로 계산된 것이 아니면 말하지 않는다.
   * 선택은 즉시 바뀌고 일정은 응답 후에 바뀌므로, 그 사이에 새로 고른 장소가
   * "이전 일정에 없다"는 이유만으로 미배치로 찍힌다.
   */
  const selectionStateShown = useMemo(() => {
    if (updating || selectionCapacity === null || !displayedDays) return false;
    return selectionResultIsCurrent(
      selectedPlaceIds,
      displayedDays,
      deriveRejectedPlaces(view).map((rejection) => rejection.placeId),
    );
  }, [updating, selectionCapacity, displayedDays, selectedPlaceIds, view]);

  const aiCommandDisabled = commandPanelUnavailable({
    hasCandidates: candidateData !== null,
    hasPlannedResult: view.result?.status === "planned",
    reopened: view.reopened !== null,
    alternativeSelected: view.selectedAlt !== null,
    requiresSelectionAdjustment: selectionCapacity?.requiresAdjustment === true,
  });

  /**
   * 날짜 편집을 지금 허용해도 되는가 (PR #150 리뷰 1번).
   *
   * 표시 중인 일정과 입력 상태가 어긋난 구간에는 편집을 막는다. AI 입력의 비활성 조건과
   * 별개로 계산해, 버튼·드래그·핸들러가 **같은 기준**을 본다.
   */
  const visitDateEditable = canEditVisitDate({
    updating,
    commandDisabled: aiCommandDisabled,
    hasDisplayedDays: displayedDays !== null && displayedDays.length > 0,
    needsSelection,
    requiresAdjustment: selectionCapacity?.requiresAdjustment === true,
  });

  /**
   * 날짜 선택 버튼·드래그 (#109).
   *
   * 자연어와 **같은 실행기·같은 판정·같은 적용 경로**를 쓴다. 해석 단계만 없다.
   * `ready`면 바로 반영하고, 요청 밖 부작용이 있으면 확인 창을 띄운다 — 규칙이 갈리면
   * 같은 변경인데 조작 방법에 따라 다르게 확정되는 일이 생긴다.
   */
  /** 확인 대기 중에는 닫히지 않는다 — 닫으면 무엇을 승인하려던 것인지 사라진다 (#151) */
  const closeAiPanel = useCallback(() => {
    if (!panelDismissable(aiFeedback, aiPending)) return;
    // 표시를 숨길 뿐 작업 상태를 버리지 않는다 — 지우면 다시 열었을 때 최근 결과와
    // 실행 취소가 사라진다. 폐기는 `현재 일정 유지` 같은 명시적 동작에서만 한다
    setAiPanelOpen(false);
    aiTriggerRef.current?.focus();
  }, [aiFeedback, aiPending]);

  useEffect(() => {
    if (!aiPanelOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") closeAiPanel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [aiPanelOpen, closeAiPanel]);

  /** 즉시 적용을 한 번에 되돌린다 — 역방향 명령이 아니라 상태 복원이다 (#145) */
  const undoLastCommand = useCallback(() => {
    if (!undoPoint) return;
    ++planSequence.current;
    // 적용 때 시작한 테마 조회가 늦게 끝나 되돌린 일정 위에 덮이지 않게 무효화한다
    ++themeRequestRef.current;
    setSelectedPlaceIds(undoPoint.selectedPlaceIds);
    setPreferredVisitDates(undoPoint.preferredVisitDates);
    setSettledSelectionKey(undoPoint.settledSelectionKey);
    setLastItineraryDiff(undoPoint.diff);
    setThemeExperience(undoPoint.themeExperience as ThemeExperienceResult | null);
    setThemeMapVisible(undoPoint.themeMapVisible);
    dispatchView({ type: "PLAN_SUCCESS", result: undoPoint.result });
    dispatchView({ type: "SELECT_ALT", alt: undoPoint.selectedAlt });
    // markDirty로는 못 되돌린다 — 저장된 일정을 바꿨다 취소하면 dirty로 남는다
    saveStub.restoreSaveStatus(undoPoint.saveStatus);
    setUndoPoint(null);
    setAiFeedback({ kind: "undone" });
  }, [undoPoint, saveStub]);

  const submitVisitDateEdit = useCallback((placeId: string, targetDate: string) => {
    const request = currentConstraints();
    // UI 비활성만으로는 서버 호출 경계를 막지 못한다 — 같은 기준으로 한 번 더 본다
    if (!request || !visitDateEditable) return;
    const submittedSequence = ++planSequence.current;
    setAiFeedback(null);
    // 결과가 패널 안에만 있다 — 열지 않으면 확인 창도 실행 취소도 닿지 않는다
    setAiPanelOpen(true);
    startAiTransition(async () => {
      try {
        const result = await runVisitDateEdit({ placeId, targetDate, request });
        if (!commandResponseIsCurrent(submittedSequence, planSequence.current)) {
          setAiFeedback({ kind: "cancelled" });
          return;
        }
        if (!result.ok) {
          setAiFeedback({ kind: "error" });
          return;
        }
        setAiFeedback({
          kind: "proposal",
          outcome: result.outcome,
          applied: false,
          submittedSequence,
        });
        if (result.outcome.proposal.decision === "ready") {
          applyCommandOutcome(result.outcome, submittedSequence);
        }
      } catch {
        // 늦게 도착한 실패가 현재 화면에 옛 오류를 띄우지 않게 한다
        if (!commandResponseIsCurrent(submittedSequence, planSequence.current)) {
          setAiFeedback({ kind: "cancelled" });
          return;
        }
        setAiFeedback({ kind: "error" });
      }
    });
  }, [currentConstraints, visitDateEditable, applyCommandOutcome]);

  /**
   * 같은 날 방문 순서 (#145).
   *
   * `submitVisitDateEdit`과 **같은 골격이다** — 제안을 만들고, 패널을 열고, `ready`면 바로
   * 적용한다. 확인 창·실행 취소·diff가 전부 그 경로에 이미 붙어 있어 순서만 따로 만들 이유가
   * 없다(#118 결정 2).
   *
   * 순서는 소프트 선호라 못 지켜도 일정이 실패하지 않는다. 대신 엔진이 `adjusted`로 알리고
   * 확인 창이 `열차 시간표에 따라...`를 띄운다 — 혼합 권역 성립률이 63%라 자주 나온다.
   */
  const submitVisitOrderEdit = useCallback((firstPlaceId: string, secondPlaceId: string) => {
    const request = currentConstraints();
    if (!request || !visitDateEditable) return;
    const submittedSequence = ++planSequence.current;
    setAiFeedback(null);
    setAiPanelOpen(true);
    startAiTransition(async () => {
      try {
        const result = await runVisitOrderEdit({ firstPlaceId, secondPlaceId, request });
        if (!commandResponseIsCurrent(submittedSequence, planSequence.current)) {
          setAiFeedback({ kind: "cancelled" });
          return;
        }
        if (!result.ok) {
          setAiFeedback({ kind: "error" });
          return;
        }
        setAiFeedback({
          kind: "proposal",
          outcome: result.outcome,
          applied: false,
          submittedSequence,
        });
        if (result.outcome.proposal.decision === "ready") {
          applyCommandOutcome(result.outcome, submittedSequence);
        }
      } catch {
        if (!commandResponseIsCurrent(submittedSequence, planSequence.current)) {
          setAiFeedback({ kind: "cancelled" });
          return;
        }
        setAiFeedback({ kind: "error" });
      }
    });
  }, [currentConstraints, visitDateEditable, applyCommandOutcome]);

  /**
   * 날짜 통 이동 (#146 10).
   *
   * 한 곳짜리와 **같은 실행기·같은 판정·같은 적용 경로**를 쓴다. 다른 것은 대상이 여럿이라는
   * 사실뿐이다. 여러 장소가 한 번에 움직여 부작용이 클 수 있으므로 `ready`가 아니면
   * 자동 적용하지 않고 확인을 받는다.
   */
  const submitDayMove = useCallback((placeIds: string[], targetDate: string) => {
    const request = currentConstraints();
    if (!request || !visitDateEditable || placeIds.length === 0) return;
    const submittedSequence = ++planSequence.current;
    setAiFeedback(null);
    setAiPanelOpen(true);
    startAiTransition(async () => {
      try {
        const result = await runDayMove({ placeIds, targetDate, request });
        if (!commandResponseIsCurrent(submittedSequence, planSequence.current)) {
          setAiFeedback({ kind: "cancelled" });
          return;
        }
        if (!result.ok) {
          setAiFeedback({ kind: "error" });
          return;
        }
        setAiFeedback({
          kind: "proposal",
          outcome: result.outcome,
          applied: false,
          submittedSequence,
        });
        if (result.outcome.proposal.decision === "ready") {
          applyCommandOutcome(result.outcome, submittedSequence);
        }
      } catch {
        if (!commandResponseIsCurrent(submittedSequence, planSequence.current)) {
          setAiFeedback({ kind: "cancelled" });
          return;
        }
        setAiFeedback({ kind: "error" });
      }
    });
  }, [currentConstraints, visitDateEditable, applyCommandOutcome]);

  const chooseAlternative = useCallback((alt: SelectableAlternative | null) => {
    setLastItineraryDiff(null);
    dispatchView({ type: "SELECT_ALT", alt });
    saveStub.markDirty();
  }, [saveStub]);

  /** 저장 시점 표시 이름 수집 — 규칙은 `lib/display-names.ts`에 있다 (#130) */
  const collectNames = useCallback((days: DayPlan[]) => collectDisplayNames(days, {
    place: (id) => candidateData?.candidates.find((c) => c.id === id)?.name,
    station: (id) => candidateData?.stations.find((station) => station.id === id)?.name,
  }), [candidateData]);

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
      displayNames: view.reopened?.displayNames ?? collectNames(displayedDays),
    };
  }, [displayedDays, selectionCapacity, view.reopened, viewWarnings, currentConstraints, selectedActors, selectedWorks, locale, collectNames]);

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
  const routeRecommendationFeedback = aiFeedback?.kind === "recommendations" ? aiFeedback : null;
  const routeRecommendationIds = useMemo(
    () => new Set(routeRecommendationFeedback?.outcome.recommendations.map(({ placeId }) => placeId) ?? []),
    [routeRecommendationFeedback],
  );
  const regularCandidates = routeRecommendationIds.size > 0
    ? sortedCandidates.filter(({ id }) => !routeRecommendationIds.has(id))
    : sortedCandidates;

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
  /**
   * 체류 시간 포맷 (#33 — 엔진 값 포맷 전용, 재계산 금지).
   *
   * 옛 문구는 `약 2시간 2분 활용 가능`이었다. 카드 폭이 240px이라 "활용 가능"까지
   * 넣으면 두 줄이 되고, 제목이 이미 `체류 시간`이라 매 칸마다 되풀이할 이유가 없다.
   */
  const stayLabel = (minutes: number) => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    const duration = hours > 0
      ? `${hours}${tr("region.hours")}${mins > 0 ? ` ${mins}${tr("region.minutes")}` : ""}`
      : `${mins}${tr("region.minutes")}`;
    return `${tr("region.about")} ${duration}`;
  };

  // 3단계 시트 안의 촬영지 위치 지도와 "선택한 장소만 보기" 토글은 지웠다 (#146).
  // 화면에 전체 이동 동선 지도가 이미 있어 같은 것을 두 벌 그리고 있었다.



  // PR #59 리뷰 1 — 엔진은 분 값만 내리고 라벨은 locale로 조합한다 (REQ-ITIN-006)
  // #61 확정 표기 — 접근시간은 자동차 길찾기 기반 보수값이라 수단을 명시한다.
  // "약 N분"만 두면 대중교통으로 읽힌다.
  const accessLabel = (minutes: number) => tr("access.byCar").replace("{n}", String(minutes));

  // #61 정적/동적 분리 — 같은 TRAIN_UNAVAILABLE도 원인이 둘이다.
  // 앵커역 시간표를 아직 확보하지 못한 것과, 확보했는데 일정 안에 탈 열차가 없는 것.
  // "연결 열차 없음"으로 뭉치면 갈 수 없는 곳을 추천한 것처럼 읽힌다.
  /**
   * 시간표 범위 밖 장소 (#61) — `TRAIN_UNAVAILABLE`이 화면에서 두 문구로 갈리는 기준이다.
   * 장소마다 다르므로 집합으로 들고 다닌다.
   */
  const outOfCoveragePlaceIds = new Set(
    (candidateData?.candidates ?? [])
      .filter((candidate) => {
        const anchor = candidateData?.stations.find((s) => s.id === candidate.nearestStationId);
        return anchor !== undefined && !anchor.hasTimetable;
      })
      .map((candidate) => candidate.id),
  );

  /**
   * 미배치 목록 — **사유별로 묶는다** (#84 §2 · #171).
   *
   * 장소마다 한 줄이면 같은 문장이 11번 반복돼 읽히지 않고, 카탈로그가 늘면 더 나빠진다.
   * 사용자가 읽어야 하는 것은 "몇 가지 이유로 몇 곳이 빠졌는가"다.
   */
  const renderRejectionGroups = (rejections: readonly { code: string; placeId: string }[]) => (
    <ul className="mt-2 space-y-2 text-sm text-sc-orange-text">
      {/* 묶기 전에 장소별로 표시 코드를 정한다 — 그룹 대표 하나로 문구를 정하면
          커버리지 밖 장소가 자기 것이 아닌 사유를 달게 된다 (PR #172 리뷰) */}
      {groupRejections(
        rejections.map((reason) => ({
          code: displayRejectionCode(reason as never, outOfCoveragePlaceIds),
          placeId: reason.placeId,
        })),
      ).map((group) => (
        <li key={group.code}>
          <span className="font-medium">{tr(`reason.${group.code}` as MessageKey)}</span>
          {" "}
          <span className="whitespace-nowrap">{tr("step4.rejectedCount").replace("{n}", String(group.placeIds.length))}</span>
          <p className="mt-0.5 text-xs text-sc-orange-text/85">
            {group.placeIds.map((placeId) => placeName(placeId)).join(" · ")}
          </p>
        </li>
      ))}
    </ul>
  );

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
  /**
   * 이 구간이 "공항철도로 간다"는 사실을 알려야 하는가 (#146 결정).
   *
   * 검증된 버스 대안이 **하나도 없을 때만** 적는다. 대안이 있으면 선택기가 화면에 떠
   * 있어 사용자가 이미 알고 있고, 없을 때는 선택기가 통째로 숨어 무엇으로 드나드는지
   * 알 길이 없어진다. 고를 수 없는 버튼을 흐리게 띄우는 대신 사실만 남기는 쪽이다.
   */
  const airportStationIds = useMemo(
    () => new Set((candidateData?.stations ?? []).filter((s) => s.isAirport).map((s) => s.id)),
    [candidateData],
  );
  const hasBusAlternative = (view.result?.status === "planned"
    && (view.result.gatewayAlternatives ?? []).length > 0);
  const airportRailNote = (ride: { fromStationId: string; toStationId: string }) =>
    shouldNoteAirportRail({ hasBusAlternative, airportStationIds, ride });

  // `useCallback` — 전체 보기의 지역 목록이 이 함수를 의존성으로 쓴다
  const stationName = useCallback((id: string) => resolveDisplayName({
    locale,
    current: candidateData?.stations.find((s) => s.id === id)?.name,
    saved: savedNames?.stations[id],
    fallback: tr("common.nameUnavailable"),
  }), [locale, candidateData, savedNames, tr]);
  const placeName = (id: string) => resolveDisplayName({
    locale,
    current: candidateData?.candidates.find((c) => c.id === id)?.name,
    saved: savedNames?.places[id],
    fallback: tr("common.nameUnavailable"),
  });
  /** 일정 줄의 유형 아이콘 — 추천 카드와 같은 `placeType`을 쓴다 (#146 2절) */
  const placeTypeOf = (id: string) =>
    candidateData?.candidates.find((c) => c.id === id)?.placeType;
  /**
   * 후보 선택 토글 — 시트의 상위 줄과 전체 보기가 **같은 경로**를 쓴다.
   * 갈라 두면 한쪽에서만 방문일 선호가 정리되는 식으로 어긋난다.
   */
  const togglePlace = (placeId: string) => {
    const next = new Set(selectedPlaceIds);
    if (next.has(placeId)) next.delete(placeId); else next.add(placeId);
    if (next.size === 0) setLastItineraryDiff(null);
    setPreferredVisitDates((current) => {
      if (!(placeId in current)) return current;
      const nextPreferences = { ...current };
      delete nextPreferences[placeId];
      return nextPreferences;
    });
    setAiFeedback(null);
    setSelectedPlaceIds(next);
  };

  /** 전체 보기의 좁히기 — 지역은 최인접역, 콘텐츠는 작품 */
  const browserStations = useMemo(() => {
    const ids = [...new Set((candidateData?.candidates ?? []).map((c) => c.nearestStationId))];
    return ids.map((id) => ({ id, label: stationName(id) }))
      .sort((a, b) => a.label.localeCompare(b.label, locale));
  }, [candidateData, locale, stationName]);
  const browserWorks = useMemo(
    () => (candidateData?.works ?? []).map((w) => ({ id: w.id, label: w.title[locale] })),
    [candidateData, locale],
  );
  const browsedCandidates = useMemo(() => sortedCandidates.filter((c) =>
    (browserStation === null || c.nearestStationId === browserStation)
    && (browserWork === null || c.workIds.includes(browserWork))),
  [sortedCandidates, browserStation, browserWork]);

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
      {/* `flex-wrap`을 걷었다 (#146 모바일). 390px에서 버튼 묶음이 아래로 접혀
          제목 밑에 왼쪽 정렬로 한 줄을 더 쓰고 있었다. 한 줄에 두고 로고 쪽이
          줄어들게 한다 — 버튼은 늘 오른쪽 윗줄이다 */}
      <header className="flex items-center justify-between gap-3 border-b bg-sc-surface px-5 py-4">
        {/* `SC` 마크는 걷었다 (#146). 코레일 안에 들어가는 화면을 전제하면 왼쪽 위는
            우리 마크 자리가 아니다. 이름은 남긴다 — 지우면 화면에 자기 이름이 없어진다 */}
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold tracking-wide">{tr("app.title")}</h1>
          {/* 좁은 화면에서 태그라인은 버튼 자리를 뺏는다 — 386px 미만에서만 접는다 */}
          <p className="mt-0.5 hidden truncate text-xs text-sc-muted sm:block">{tr("app.tagline")}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
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

      {/* 단계 nav와 아래 선택 요약이 이 화면에서 제일 작았는데, 둘이야말로 여정의 축이다.
          3단계 제목 줄을 걷어 확보한 44px을 여기에 돌려준다 (#146) */}
      {!showFinalItinerary && <nav className="grid grid-cols-3 border-b bg-sc-subtle text-center text-base">
        {/* 단계 표시가 곧 이동 수단이다 (#146). 시트에서 `이전`을 걷어낸 뒤로
            여기가 앞 단계로 돌아가는 유일한 길이라 `div`로 둘 수 없다.
            **아직 못 간 단계는 누를 수 없다** — 조건을 건너뛰고 결과로 갈 수 없다 */}
        {STEPS.map((key, i) => {
          const target = i + 1;
          const current = step === target;
          const reachable = target <= furthestStep;
          return (
            <button
              key={key}
              type="button"
              disabled={!reachable}
              aria-current={current ? "step" : undefined}
              onClick={() => setStep(target)}
              className={`flex min-h-[62px] items-center justify-center gap-2 border-r px-1 last:border-r-0 ${
                current ? "bg-sc-blue-soft font-medium text-sc-blue" : "text-sc-muted"
              } ${reachable && !current ? "hover:bg-sc-blue-soft/50 hover:text-sc-blue" : ""} ${
                reachable ? "" : "cursor-default opacity-60"
              }`}
            >
              <span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-current text-sm">{target}</span>
              <span className="truncate">{tr(key)}</span>
            </button>
          );
        })}
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
          {/* 제목은 한 단어, 설명은 (i) 팝오버 (#146). 세 단계가 nav와 같은 말을
              쓰게 되어 사용자가 지금 어디 있는지 두 곳에서 같은 단어로 확인한다 */}
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">{tr("step1.title")}</h2>
            <button
              type="button"
              popoverTarget="step1-guide-popover"
              aria-haspopup="dialog"
              aria-controls="step1-guide-popover"
              aria-label={tr("step1.guideOpen")}
              className="flex size-8 items-center justify-center rounded-full border text-sc-muted hover:border-sc-blue hover:text-sc-blue"
            >
              <Info aria-hidden="true" className="size-4" />
            </button>
          </div>
          <div
            id="step1-guide-popover"
            popover="auto"
            role="dialog"
            aria-labelledby="step1-guide-popover-title"
            className="m-auto w-[min(400px,calc(100vw-32px))] rounded-xl border bg-sc-surface p-4 text-left shadow-2xl backdrop:bg-black/20"
          >
            <div className="flex items-start justify-between gap-3">
              <h4 id="step1-guide-popover-title" className="text-sm font-semibold text-sc-text">
                {tr("step1.guideTitle")}
              </h4>
              <button
                type="button"
                popoverTarget="step1-guide-popover"
                popoverTargetAction="hide"
                aria-label={tr("common.close")}
                className="grid size-8 shrink-0 place-items-center rounded-full border text-sc-muted hover:border-sc-blue hover:text-sc-blue"
              >
                <X aria-hidden="true" className="size-4" />
              </button>
            </div>
            <p className="mt-2 text-xs text-sc-muted">{tr("step1.guideBody")}</p>
            <p className="mt-2 border-t pt-2 text-xs text-sc-muted">{tr("step1.subtitle")}</p>
          </div>
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
          {/* 제목은 한 단어, 설명은 (i) 팝오버 (#146). 세 단계가 nav와 같은 말을
              쓰게 되어 사용자가 지금 어디 있는지 두 곳에서 같은 단어로 확인한다 */}
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">{tr("step2.title")}</h2>
            <button
              type="button"
              popoverTarget="step2-guide-popover"
              aria-haspopup="dialog"
              aria-controls="step2-guide-popover"
              aria-label={tr("step2.guideOpen")}
              className="flex size-8 items-center justify-center rounded-full border text-sc-muted hover:border-sc-blue hover:text-sc-blue"
            >
              <Info aria-hidden="true" className="size-4" />
            </button>
          </div>
          <div
            id="step2-guide-popover"
            popover="auto"
            role="dialog"
            aria-labelledby="step2-guide-popover-title"
            className="m-auto w-[min(400px,calc(100vw-32px))] rounded-xl border bg-sc-surface p-4 text-left shadow-2xl backdrop:bg-black/20"
          >
            <div className="flex items-start justify-between gap-3">
              <h4 id="step2-guide-popover-title" className="text-sm font-semibold text-sc-text">
                {tr("step2.guideTitle")}
              </h4>
              <button
                type="button"
                popoverTarget="step2-guide-popover"
                popoverTargetAction="hide"
                aria-label={tr("common.close")}
                className="grid size-8 shrink-0 place-items-center rounded-full border text-sc-muted hover:border-sc-blue hover:text-sc-blue"
              >
                <X aria-hidden="true" className="size-4" />
              </button>
            </div>
            <p className="mt-2 text-xs text-sc-muted">{tr("step2.guideBody")}</p>
            <p className="mt-2 border-t pt-2 text-xs text-sc-muted">{tr("step2.subtitle")}</p>
          </div>
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
          {/*
            상단 제목 줄을 통째로 걷었다 (#146).

            `추천일정` 한 단어와 (i)가 한 줄(44px)을 쓰고 있었는데, nav가 바로 위에서
            `추천일정`이라고 이미 말한다. 같은 말을 두 줄로 하는 대신 그 44px을
            nav와 선택 요약 글자 크기에 돌려준다 - 둘이 이 화면에서 제일 작았다.

            여기 있던 안내는 우측 rail의 (i) 팝오버로 합쳤다. 화면이 하나이므로
            안내도 한 곳이면 된다.
          */}

          {/* #85 — 좌: 후보 선택 / 우: 계산 결과. 왕복 없이 같은 화면에서 판단한다 */}
          <div className="mt-3 grid gap-[18px] lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <PlaceRecommendationSheet
            selectedCount={selectedPlaceIds.size}
            totalCount={sortedCandidates.length}
            placedCount={selectionStateShown ? selectionCapacity!.schedulableCount : null}
            unplacedCount={selectionStateShown ? selectionCapacity!.minimumExclusionCount : null}
            themeState={themeChipState(themeExperience)}
            themeChip={(
              <ThemeExperienceChip
                result={themeExperience}
                stationName={themeStationLabel(displayedDays ?? [], themeExperience, stationName)}
                locale={locale}
                tr={tr}
                mapVisible={themeMapVisible}
                onToggleMap={() => setThemeMapVisible((visible) => !visible)}
              />
            )}
            updating={updating}
            updated={lastItineraryDiff?.changed === true && !updating}
            sortBy={sortBy}
            onSortChange={setSortBy}
            onBrowseAll={() => setBrowserOpen(true)}
            initialExpanded={false}
            tr={tr}
            routeRecommendations={routeRecommendationFeedback
              && routeRecommendationFeedback.outcome.recommendations.length > 0
              && candidateData
              ? routeRecommendationFeedback.outcome.recommendations.map((recommendation) => {
                const candidate = candidateData.candidates.find(({ id }) => id === recommendation.placeId);
                return candidate ? (
                  <RouteRecommendationCard
                    key={recommendation.placeId}
                    candidate={candidate}
                    recommendation={recommendation}
                    locale={locale}
                    stationName={stationName}
                    placeName={placeName}
                    workTitles={workTitles}
                    onAdd={() => applyRouteRecommendation(
                      recommendation,
                      routeRecommendationFeedback.submittedSequence,
                    )}
                    tr={tr}
                  />
                ) : null;
              })
              : undefined}
          >
          {candidateData ? (
          <>
          {sortedCandidates.length === 0 && (
            <li className="rounded border border-sc-orange/30 bg-sc-orange-soft p-3 text-sm text-sc-orange-text">
              {tr("step3.noCandidates")}
            </li>
          )}
          {/* #43 확정: 미확인 후보도 같은 목록에서 선택 가능 — 카드에 경고 배지 */}
          {regularCandidates.slice(0, PLACES_PAGE_SIZE).map((c) => (
            <PlaceCard key={c.id} candidate={c} locale={locale} tr={tr}
              selected={selectedPlaceIds.has(c.id)}
              stationName={stationName} workTitles={workTitles}
              aiReason={c.aiReason ?? null}
              onToggle={() => togglePlace(c.id)}
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

          {/* 전체 보기 (#146 ①) — 좁히기는 이 안에서만 한다 */}
          <PlaceBrowser
            open={browserOpen}
            onClose={() => setBrowserOpen(false)}
            count={browsedCandidates.length}
            stations={browserStations}
            works={browserWorks}
            station={browserStation}
            work={browserWork}
            onStationChange={setBrowserStation}
            onWorkChange={setBrowserWork}
            tr={tr}
          >
            {browsedCandidates.map((c) => (
              <PlaceCard key={c.id} candidate={c} locale={locale} tr={tr}
                selected={selectedPlaceIds.has(c.id)}
                stationName={stationName} workTitles={workTitles}
                aiReason={c.aiReason ?? null}
                onToggle={() => togglePlace(c.id)}
              />
            ))}
          </PlaceBrowser>

          {/* 우측 열 — 계산 결과. 장소를 켜고 끄면 여기서 바로 갱신된다 */}
          <div className="min-w-0" aria-busy={updating}>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold">{tr("step4.title")}</h3>
              {/* #43 수용 기준: 경고 누락 0건 — 배치는 유지하되 방문 전 확인을 안내.
              카드 한 통이 목록 옆에 늘 펼쳐져 있던 것을 DAY 헤더 아이콘들과 같은
              방식으로 바꿨다 (#146) — 경고 아이콘 하나에 건수를 달고 팝오버로 연다.
              경고가 없으면 아이콘도 없다: 없는 것을 자리로 알리지 않는다 */}
            {viewWarnings.length > 0 && (
              <div data-stage-warnings>
              <button
                type="button"
                popoverTarget="stage-warnings-popover"
                aria-haspopup="dialog"
                aria-controls="stage-warnings-popover"
                aria-label={withValues(tr("step4.warningsCount"), { n: String(viewWarnings.length) })}
                className="grid size-9 place-items-center rounded-full border border-sc-orange/40 bg-sc-orange-soft text-sc-orange-text hover:border-sc-orange"
              >
                {/* 아이콘만 둔다 (#146). 건수는 이름으로만 남긴다 — 화면에서 세는
                    것보다 눌러서 무엇인지 보는 쪽이 빠르고, 줄이 짧아진다 */}
                <TriangleAlert aria-hidden="true" className="size-4" />
              </button>
              <div
                id="stage-warnings-popover"
                popover="auto"
                role="dialog"
                aria-labelledby="stage-warnings-title"
                className="m-auto w-[min(420px,calc(100vw-32px))] rounded-xl border bg-sc-surface p-4 text-left shadow-2xl backdrop:bg-black/20"
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 id="stage-warnings-title" className="text-sm font-semibold text-sc-orange-text">
                    {tr("step4.warningsTitle")}
                  </h3>
                  <button
                    type="button"
                    popoverTarget="stage-warnings-popover"
                    popoverTargetAction="hide"
                    aria-label={tr("common.close")}
                    className="grid size-8 shrink-0 place-items-center rounded-full border text-sc-muted hover:border-sc-blue hover:text-sc-blue"
                  >
                    <X aria-hidden="true" className="size-4" />
                  </button>
                </div>
                <ul className="mt-2 space-y-1 text-sm text-sc-orange-text">
                  {viewWarnings.map((warning) => (
                    <li key={warning.placeId} className="flex items-start gap-1.5">
                      <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                      <span>{placeName(warning.placeId)} — {tr(`reason.${warning.detail}` as MessageKey)}</span>
                    </li>
                  ))}
                </ul>
              </div>
              </div>
            )}
            <button
              type="button"
              popoverTarget="itinerary-info-popover"
              aria-haspopup="dialog"
              aria-controls="itinerary-info-popover"
              aria-label={tr("step4.infoOpen")}
              className="flex size-8 items-center justify-center rounded-full border text-sc-muted hover:border-sc-blue hover:text-sc-blue"
            >
              <Info aria-hidden="true" className="size-4" />
            </button>
            {/* #151 — 상시 노출 대신 진입점만 둔다. 말풍선이 아니라 반짝임 아이콘이라
                맛집·날씨까지 묻는 범용 상담 기대를 만들지 않는다 */}
            <button
              ref={aiTriggerRef}
              type="button"
              disabled={aiCommandDisabled}
              aria-expanded={aiPanelOpen}
              aria-controls="itinerary-ai-panel"
              aria-label={tr("ai.entryLabel")}
              onClick={() => {
                if (aiPanelOpen) closeAiPanel();
                else setAiPanelOpen(true);
              }}
              className={`flex size-8 items-center justify-center rounded-full border ${
                aiPanelOpen
                  ? "border-sc-blue bg-sc-blue text-white"
                  : "border-sc-blue/40 text-sc-blue hover:bg-sc-blue-soft"
              } disabled:opacity-40`}
            >
              {/* 반짝임 아이콘은 "AI"로 읽히지 않았다 (#146) — 글자로 적는다.
                  옆 배지 `AI로 일정 조율`도 같은 말을 되풀이하던 것이라 걷었다 */}
              <span aria-hidden="true" className="text-xs font-bold tracking-tight">AI</span>
            </button>
            <div
              id="itinerary-info-popover"
              popover="auto"
              role="dialog"
              aria-labelledby="itinerary-info-title"
              data-itinerary-info-popover
              className="m-auto w-[min(400px,calc(100vw-32px))] rounded-xl border bg-sc-surface p-4 text-left shadow-2xl backdrop:bg-black/20"
            >
              <div className="flex items-start justify-between gap-3">
                <h4 id="itinerary-info-title" className="text-sm font-semibold text-sc-text">{tr("step4.infoTitle")}</h4>
                <button
                  type="button"
                  popoverTarget="itinerary-info-popover"
                  popoverTargetAction="hide"
                  aria-label={tr("common.close")}
                  className="grid size-8 shrink-0 place-items-center rounded-full border text-sc-muted hover:border-sc-blue hover:text-sc-blue"
                >
                  <X aria-hidden="true" className="size-4" />
                </button>
              </div>
              {/* 상단 제목 줄에 있던 안내를 여기로 합쳤다 (#146) — 화면이 하나이므로
                  안내도 한 곳이면 된다 */}
              <p className="mt-2 text-xs text-sc-muted">{tr("step3.guideBody")}</p>
              <p className="mt-2 text-xs text-sc-muted">{tr("step4.subtitle")}</p>
              {/* 목록 위에 있던 고지 (#146 모바일) */}
              <p className="mt-2 text-xs text-sc-muted">{tr("step4.estimatedNote")}</p>
              {/* #61 — 접근시간이 대중교통으로 읽히지 않도록 고지한다 */}
              <p className="mt-2 text-xs text-sc-muted">{tr("access.notice")}</p>
              <p className="mt-2 border-t pt-2 text-xs text-sc-muted">
                <strong className="font-medium text-sc-text">{tr("step4.dataNoticeTitle")}</strong>{" "}
                {tr("step4.dataNotice")}
              </p>
              <p className="mt-2 border-t pt-2 text-xs text-sc-muted">{tr("step4.validation")}</p>
            </div>
            {/* #85 리뷰 1 — 갱신 중에도 직전 일정을 지우지 않는다. 표시만 겹쳐 얹는다.
                리뷰 비차단 — 계산 시작이 아니라 선택이 바뀐 시점부터 켠다 */}
            {updating && displayedDays && (
              <span role="status" className="rounded-full bg-sc-blue-soft px-2 py-0.5 text-xs text-sc-blue">
                {tr("step4.updating")}
              </span>
            )}
          </div>

          {aiPanelOpen && (
          <ItineraryCommandPanel
            value={aiSentence}
            pending={aiPending}
            disabled={aiCommandDisabled}
            disabledMessage={selectionCapacity?.requiresAdjustment
              ? "ai.disabledOverselection"
              : "ai.disabled"}
            feedback={aiFeedback}
            lastDiff={lastItineraryDiff}
            onChange={setAiSentence}
            onSubmit={() => submitItineraryCommand(aiSentence)}
            onExample={submitItineraryCommand}
            onApply={applyCommandOutcome}
            onUndo={undoLastCommand}
            canUndo={undoPoint !== null}
            onDismiss={() => setAiFeedback(null)}
            placeName={placeName}
            tr={tr}
            onClose={closeAiPanel}
            closeDisabled={!panelDismissable(aiFeedback, aiPending)}
          />
          )}

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
                            {/* #14 v0.6 sc-result-grid — 좌측 일정 타임라인 + 우측 지도·경고·실행 지원 */}
              <div className="grid gap-[18px] md:grid-cols-[minmax(0,1fr)_minmax(360px,1fr)] md:items-start">
                {/* 모바일에서는 DAY 1 - DAY 2 - DAY 3이 통째로 가로로 흐른다 (#146).
                    세로로 쌓으면 하루를 볼 때마다 스크롤을 내려야 하는데, 여행 일정은
                    원래 시간순이라 옆으로 넘기는 쪽이 맞다 */}
                <div className="min-w-0 space-y-4" data-day-list>
              {/* 장소 단위 시각이 예약 확정 시각이 아니라는 고지는 유지하되, 자리는
                  옆 (!) 팝오버다 (#146 모바일). 390px에서 이 한 줄이 목록 위를 차지해
                  첫 화면에 DAY가 안 들어왔다 — 없애는 게 아니라 옮기는 것이다 */}
              {displayedDays.map((day, dayIndex) => {
                const baseDay = baseDays?.find((d) => d.date === day.date);
                const rows = itineraryRowsOf(day);
                /**
                 * 체류 카드가 놓일 칸 (#146).
                 *
                 * 두 타임라인이 같은 폭의 칸을 쓰므로 그냥 늘어놓으면 **N번째 체류가
                 * N번째 이동 밑에 붙는다** - 광화문(서울) 아래에 진부 권역 체류가
                 * 걸려 서로 관계가 있는 것처럼 읽혔다. 실제로 그렇게 보였다.
                 *
                 * 시각으로 맞춘다. 그 체류를 시작시킨 줄(도착) 밑에 세운다.
                 */
                const stayColumn = (startAt: string) => {
                  const at = Date.parse(startAt);
                  let last = 0;
                  rows.forEach((row, index) => { if (row.at <= at) last = index; });
                  return last + 1;
                };
                return (
                  <div
                    key={day.date}
                    className={`rounded-lg border p-4 ${dragOverDate === day.date ? "border-sc-blue bg-sc-blue-soft/40" : ""} ${
                      draggingDayDate === day.date ? "opacity-50" : ""
                    }`}
                    onDragOver={(event) => {
                      if (!visitDateEditable) return;
                      if (!draggingPlaceId && !draggingDayDate) return;
                      // 자기 자신 위로는 표시하지 않는다 — 떨어뜨려도 아무 일이 없다
                      if (draggingDayDate === day.date) return;
                      event.preventDefault();
                      setDragOverDate(day.date);
                    }}
                    onDragLeave={() => setDragOverDate((current) => (current === day.date ? null : current))}
                    onDrop={(event) => {
                      event.preventDefault();
                      setDragOverDate(null);
                      // 날짜 통 이동이 먼저다 — 통 드래그 중에는 장소 드래그가 아니다 (#146 10)
                      if (draggingDayDate) {
                        const source = displayedDays.find((d) => d.date === draggingDayDate);
                        setDraggingDayDate(null);
                        if (!source || source.date === day.date) return;
                        submitDayMove(source.items.map((item) => item.placeId), day.date);
                        return;
                      }
                      const placeId = draggingPlaceId ?? event.dataTransfer.getData("text/plain");
                      setDraggingPlaceId(null);
                      // 같은 날로 떨어뜨리면 바뀌는 것이 없다 — 재계산을 부르지 않는다
                      if (!placeId || dateOfPlace(displayedDays, placeId) === day.date) return;
                      submitVisitDateEdit(placeId, day.date);
                    }}
                  >
                    {/* #146 ① — 여행 기간과 무관하게 같은 형식을 쓴다. 2박 3일이든
                        9박 10일이든 라벨과 배치는 바뀌지 않고 숫자만 커진다.
                        날짜는 아래에 작게 둔다 — 형식은 공통이되 실제 날짜도 필요하다 */}
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    {/* 날짜를 통째로 끄는 핸들 (#146 10). 헤더 전체가 아니라 이 조각만
                        `draggable`이다 — 헤더에 있는 역 시설 버튼까지 드래그로 먹히면
                        누를 수가 없다 */}
                    <h3
                      className="cursor-grab font-medium active:cursor-grabbing"
                      draggable={visitDateEditable && day.items.length > 0}
                      onDragStart={(event) => {
                        setDraggingDayDate(day.date);
                        event.dataTransfer.setData("text/plain", `day:${day.date}`);
                        event.dataTransfer.effectAllowed = "move";
                      }}
                      onDragEnd={() => { setDraggingDayDate(null); setDragOverDate(null); }}
                      title={day.items.length > 0 ? tr("step4.dayDragHint") : undefined}
                    >
                      {/* `DAY 1`만 남긴다 (#146). 장소 수는 아래 카드를 세면 되고,
                          날짜는 상단 `선택 요약`의 여행 기간이 이미 말한다 - 같은 것을
                          세 번 적으면 정작 어느 날인지가 묻힌다 */}
                      {withValues(tr("step4.dayHeading"), { day: String(dayIndex + 1) })}
                    </h3>
                    {/* 그 날 거치는 역만 — 지금은 화면 맨 아래에 일정 전체 역이 뭉쳐 있어
                        어느 날 어느 역 이야기인지 알 수 없다 (#146 2절) */}
                    {/* 드래그와 같은 일을 하는 포커스 가능한 진입점 (#157 리뷰 2).
                        HTML5 drag는 터치에서 안 되고 키보드로도 못 쓴다 */}
                    <DayMoveMenu
                      date={day.date}
                      targets={displayedDays
                        .map((target, index) => ({ date: target.date, index }))
                        .filter((target) => target.date !== day.date)}
                      disabled={!visitDateEditable || day.items.length === 0}
                      onMove={(targetDate) =>
                        submitDayMove(day.items.map((item) => item.placeId), targetDate)}
                      tr={tr}
                    />
                    {/* 공항 진입은 여행 전체에 걸리는 정보라 매일 있지 않다 —
                        왕복이면 첫날·마지막날에만 나온다 (#146) */}
                    <DayGatewayInfo
                      legs={airportLegsOf(day, airportStationIds)}
                      alternatives={view.result?.status === "planned" && !view.reopened
                        ? (view.result.gatewayAlternatives ?? []) : []}
                      selectedId={view.selectedAlt?.kind === "gateway_bus" ? view.selectedAlt.id : null}
                      onSelect={chooseAlternative}
                      stationName={stationName}
                      date={day.date}
                      locale={locale}
                      formatTime={fmtTime}
                      tr={tr}
                    />
                    <DayStationFacilities
                      snapshot={stationFacilities}
                      stationIds={stationIdsOf(day)}
                      stationName={stationName}
                      date={day.date}
                      tr={tr}
                    />
                  </div>

                  {/* 장소 목록과 이동 구간을 따로 그리면 "몇 시에 어디로 이동해 무엇을 보는가"라는
                      하루의 흐름이 끊긴다. 시각순 한 줄씩으로 세운다 (#146 2절) */}
                  <ul className="mt-2 space-y-1.5 text-sm" data-day-rows>
                    {rows.map((row) => {
                      /* 선택 가능한 버스 대안이 없으면 선택기가 통째로 숨는다. 그때는
                         무엇으로 공항에 드나드는지 알 길이 없으므로 이동 행에 사실만
                         적는다 — 고를 수 없는 버튼을 흐리게 띄우는 것보다 낫다 (#146) */
                      /* 조율 중에는 이동이 조작 대상이 아니라 결과다. 구간·시각·소요를
                         펼쳐 두면 장소보다 이동이 화면을 더 차지한다 (#118 P0-3).
                         저장된 최종 일정에서는 지금 수준으로 편다 */
                      if (row.kind === "place") {
                        const item = row.item;
                        return (
                          <li
                            key={rowKey(row)}
                            draggable={visitDateEditable}
                            onDragStart={(event) => {
                              setDraggingPlaceId(item.placeId);
                              event.dataTransfer.setData("text/plain", item.placeId);
                              event.dataTransfer.effectAllowed = "move";
                            }}
                            onDragEnd={() => {
                              setDraggingPlaceId(null); setDragOverDate(null); setDragOverPlaceId(null);
                            }}
                            /* 같은 날 안에서 카드 위에 떨어뜨리면 **그 앞으로** 간다 (#145).
                               날짜 통에 떨어뜨리는 것(날짜 이동)과 자리가 겹치므로, 카드에서
                               멈춘 드래그만 여기서 가로채고 나머지는 통으로 흘려 보낸다 */
                            onDragOver={(event) => {
                              if (!visitDateEditable || !draggingPlaceId) return;
                              if (draggingPlaceId === item.placeId) return;
                              if (dateOfPlace(displayedDays, draggingPlaceId) !== day.date) return;
                              event.preventDefault();
                              event.stopPropagation();
                              setDragOverPlaceId(item.placeId);
                            }}
                            onDragLeave={() => setDragOverPlaceId((current) => (
                              current === item.placeId ? null : current
                            ))}
                            onDrop={(event) => {
                              const moving = draggingPlaceId ?? event.dataTransfer.getData("text/plain");
                              setDragOverPlaceId(null);
                              if (!moving || moving === item.placeId) return;
                              if (dateOfPlace(displayedDays, moving) !== day.date) return;
                              event.preventDefault();
                              // 날짜 통의 드롭까지 타면 같은 드래그가 두 번 처리된다
                              event.stopPropagation();
                              setDraggingPlaceId(null);
                              submitVisitOrderEdit(moving, item.placeId);
                            }}
                            className={`rounded-lg border bg-sc-surface px-2 py-1.5 ${
                              draggingPlaceId === item.placeId ? "opacity-50" : ""
                            } ${dragOverPlaceId === item.placeId ? "border-sc-blue bg-sc-blue-soft/40" : ""}`}
                            data-itinerary-row="place"
                          >
                            {/* 카드 한 장의 구조는 어느 줄이든 같다 (#146):
                                시각 / 아이콘 + 이름 / 소요·이동. 줄 수가 내용에 따라
                                달라지면 카드 높이가 58-83px로 들쭉날쭉해진다 —
                                이름은 두 줄에서 자른다 */}
                            <span className="block tabular-nums text-xs text-sc-muted" data-row-time>
                              {fmtTime(item.arriveAt)}
                            </span>
                            <div className="mt-1 flex items-start gap-2" data-row-main>
                              {/* 외국인 사용자는 지명만 보고 역인지 관광지인지 식당인지 모른다.
                                  추천 카드와 같은 유형 아이콘을 써서 두 화면이 저절로 일관된다 */}
                              <span className="grid size-7 shrink-0 place-items-center rounded-md bg-sc-blue-soft text-sc-blue">
                                <PlaceTypeIcon placeType={placeTypeOf(item.placeId)} />
                              </span>
                              <span className="min-w-0 flex-1 text-sc-text/90" data-row-name>
                                {placeName(item.placeId)}
                              </span>
                            </div>
                            {/* 날짜별 숫자 버튼(1·2·3)은 뺐다 (#146) — 한 줄마다 세 개씩
                                깔려 목록이 버튼밭이 됐다. 장소 하나를 옮기는 일은 드래그로,
                                하루를 통째로 옮기는 일은 DAY 헤더의 이동 메뉴로 한다 */}
                            {/* 모바일에는 드래그가 없다 (#146) — HTML5 drag는 터치에서
                                동작하지 않는다. DAY 헤더가 쓰는 것과 같은 이동 메뉴를
                                장소에도 둔다. 두 경로 모두 `submitVisitDateEdit`으로
                                들어가므로 조작 방법에 따라 결과가 갈리지 않는다 */}
                            <span className="mt-auto flex items-center justify-between gap-2 pt-1 text-xs text-sc-muted" data-row-meta>
                              <span className="min-w-0 truncate">{accessLabel(item.accessMinutes)}</span>
                              <span className="flex shrink-0 items-center gap-1">
                              {/* 드래그를 못 쓰는 경로(터치·키보드)를 위한 순서 진입점 (#145).
                                  드래그와 같은 `submitVisitOrderEdit`으로 들어간다 */}
                              <PlaceOrderMenu
                                placeId={item.placeId}
                                targets={day.items
                                  .map(({ placeId }) => placeId)
                                  .filter((id) => id !== item.placeId)}
                                disabled={!visitDateEditable}
                                placeName={placeName}
                                onMoveBefore={(targetId) => submitVisitOrderEdit(item.placeId, targetId)}
                                tr={tr}
                              />
                              <DayMoveMenu
                                date={item.placeId}
                                scope="place"
                                targets={displayedDays
                                  .map((target, index) => ({ date: target.date, index }))
                                  .filter((target) => target.date !== day.date)}
                                disabled={!visitDateEditable}
                                onMove={(targetDate) => submitVisitDateEdit(item.placeId, targetDate)}
                                tr={tr}
                              />
                              </span>
                            </span>
                          </li>
                        );
                      }
                      if (row.kind === "gateway") {
                        const leg = row.leg;
                        const detail = (
                          <>
                            <span className="shrink-0 tabular-nums text-xs text-sc-muted">{fmtTime(leg.departAt)}</span>
                            <span className="min-w-0 flex-1 text-sc-text/80">
                              {leg.fromName[locale]} → {leg.toName[locale]}
                            </span>
                            <span className="shrink-0 text-xs text-sc-muted/70">{leg.serviceName[locale]}</span>
                          </>
                        );
                        return (
                          <li key={rowKey(row)} data-itinerary-row="gateway">
                            <MoveRow
                              collapsed={!reopened}
                              icon={<BusFront aria-hidden="true" className="size-4" />}
                              label={tr("step4.moveRow")}
                              route={`${leg.fromName[locale]} → ${leg.toName[locale]}`}
                              startAt={fmtTime(leg.departAt)}
                              duration={leg.serviceName[locale]}
                            >
                              {detail}
                            </MoveRow>
                          </li>
                        );
                      }
                      const ride = row.ride;
                      return (
                        <li key={rowKey(row)} data-itinerary-row="train">
                          <MoveRow
                            collapsed={!reopened}
                            icon={<TrainFront aria-hidden="true" className="size-4" />}
                            label={tr("step4.moveRow")}
                            route={`${stationName(ride.fromStationId)} → ${stationName(ride.toStationId)}`}
                            note={airportRailNote(ride) ? tr("step4.airportRailUsed") : undefined}
                            startAt={fmtTime(ride.departAt)}
                            duration={legDurationLabel(ride.departAt, ride.arriveAt, tr)}
                            onOpenDetail={() => setOpenTrainLeg({
                              trainNo: ride.trainNo,
                              fromName: stationName(ride.fromStationId),
                              toName: stationName(ride.toStationId),
                              departAt: ride.departAt,
                              arriveAt: ride.arriveAt,
                            })}
                            detailLabel={tr("step4.trainDetail")}
                          >
                            <span className="shrink-0 tabular-nums text-xs text-sc-muted">{fmtTime(ride.departAt)}</span>
                            <span className="min-w-0 flex-1 text-sc-text/80">
                              {stationName(ride.fromStationId)} → {stationName(ride.toStationId)}
                            </span>
                            <span className="shrink-0 text-xs text-sc-muted/70">
                              {legDurationLabel(ride.departAt, ride.arriveAt, tr)}
                            </span>
                          </MoveRow>
                        </li>
                      );
                    })}
                  </ul>
                    {/*
                      두 번째 타임라인 — 체류 시간 (#146).

                      위 줄이 "언제 어디로 움직이는가"라면 이건 "그 권역에서 실제로 쓸 수
                      있는 시간이 얼마인가"다. 다른 질문이라 같은 줄에 섞지 않고 따로 눕힌다.
                      카드 크기는 위 줄과 같다 — 두 타임라인이 같은 격자 위에 놓여야
                      시각이 서로 대응하는 것으로 읽힌다.

                      #33 — 엔진 값 포맷만, 경계·시각 재해석 금지
                    */}
                    {day.regionWindows.length > 0 && (
                      <div className="mt-3">
                        <h4 className="text-xs font-medium text-sc-muted">{tr("step4.stayTitle")}</h4>
                        <ul className="mt-2 space-y-1.5 text-sm" data-day-rows data-day-stays>
                          {day.regionWindows.map((window) => (
                            <li
                              key={window.startAt}
                              className="rounded-lg border border-sc-orange/40 bg-sc-orange-soft/70 px-2 py-1.5"
                              data-itinerary-row="stay"
                              style={{ gridColumnStart: stayColumn(window.startAt) }}
                            >
                              <span className="block tabular-nums text-xs text-sc-muted" data-row-time>
                                {fmtTime(window.startAt)}
                              </span>
                              <span className="mt-1 flex items-start gap-2" data-row-main>
                                <span className="grid size-7 shrink-0 place-items-center rounded-md bg-sc-orange-soft text-sc-orange-text">
                                  <Hourglass aria-hidden="true" className="size-4" />
                                </span>
                                <span className="min-w-0 flex-1 text-sc-text/90" data-row-name>
                                  {stationName(window.stationId)} {tr("region.block")}
                                </span>
                              </span>
                              <span className="mt-auto block pt-1 text-xs text-sc-orange-text" data-row-meta>
                                {stayLabel(window.availableMinutes)}
                              </span>
                            </li>
                          ))}
                        </ul>
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
                  {renderRejectionGroups(viewRejected)}
                </div>
              )}
              {/* #80 — 권역 단위 테마체험 제안. 일정에는 자동으로 포함되지 않는다 (#14 v0.6) */}
              {/* #24 A5 역 시설·짐 보관 카드는 DAY 헤더 팝오버로 옮겼다 (#146).
                  같은 정보가 두 곳에 있으면 어느 쪽이 그 날 이야기인지 알 수 없다 */}
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
              {view.result.rejectedPlaces.length > 0
                && renderRejectionGroups(view.result.rejectedPlaces)}
            </div>
          )}

          {/*
            액션 줄 (#146).

            "항공편 시각 변경"은 뺐다 — 상단 `여행 조건` 탭이 같은 곳으로 가는 길이라
            중복이었다. 남은 둘은 데스크톱에서 바닥 독(시트 헤더) 오른쪽 끝으로 간다.
            순서는 왼쪽이 조작, 오른쪽 끝이 주 액션이다.
          */}
          <StageUtilityPortal targetId="stage-sheet-actions">
            <div
              className="mt-4 flex flex-wrap items-center justify-end gap-2 lg:mt-0"
              data-stage-actions
            >
              <button className="rounded border px-3 py-2 text-sm" onClick={plan}>{tr("step4.recalculate")}</button>
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
          </StageUtilityPortal>
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

function RouteRecommendationCard({
  candidate,
  recommendation,
  locale,
  stationName,
  placeName,
  workTitles,
  onAdd,
  tr,
}: {
  candidate: PlaceCandidate;
  recommendation: RouteRecommendation;
  locale: Locale;
  stationName: (id: string) => string;
  placeName: (id: string) => string;
  workTitles: (ids: string[]) => string;
  onAdd: () => void;
  tr: (key: MessageKey) => string;
}) {
  const travelImpact = recommendation.travelMinutesDelta > 0
    ? tr("ai.recommendTravelAdded").replace("{n}", String(recommendation.travelMinutesDelta))
    : recommendation.travelMinutesDelta < 0
      ? tr("ai.recommendTravelReduced").replace("{n}", String(Math.abs(recommendation.travelMinutesDelta)))
      : tr("ai.recommendTravelSame");
  const matchedWorks = workTitles(recommendation.matchedWorkIds);

  return (
    <li className="rounded-lg border border-sc-blue/25 bg-sc-surface p-3" data-route-recommendation-card>
      <div className="flex items-start gap-2">
        <PlaceThumbnail
          label={tr("step3.photoPlaceholder")}
          photo={placePhoto(candidate.id)}
          locale={locale}
        >
          <PlaceTypeIcon placeType={candidate.placeType} />
        </PlaceThumbnail>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-sc-text">{candidate.name[locale]}</p>
          <p className="mt-1 text-xs text-sc-muted">
            {stationName(candidate.nearestStationId)} · {tr(
              recommendation.routeMatch === "same_station"
                ? "ai.recommendSameStation"
                : "ai.recommendSameRegion",
            )}
          </p>
          <p className="mt-1 text-xs font-medium text-sc-blue">{travelImpact}</p>
          {matchedWorks && (
            <p className="mt-1 text-xs text-sc-muted">
              {tr("ai.recommendWorkMatch").replace("{works}", matchedWorks)}
            </p>
          )}
          {recommendation.displacedPlaceIds.map((placeId) => (
            <p key={`drop-${placeId}`} className="mt-1 text-xs text-sc-orange-text">
              {tr("ai.recommendDisplaces").replace("{place}", placeName(placeId))}
            </p>
          ))}
          {recommendation.movedPlaceIds.map((placeId) => (
            <p key={`move-${placeId}`} className="mt-1 text-xs text-sc-orange-text">
              {tr("ai.recommendMoves").replace("{place}", placeName(placeId))}
            </p>
          ))}
        </div>
        <button
          type="button"
          className="min-h-10 shrink-0 rounded-lg bg-sc-blue px-3 text-xs font-semibold text-white"
          onClick={onAdd}
          aria-label={tr("step3.addPlace").replace("{place}", candidate.name[locale])}
        >
          {tr("ai.recommendAdd")}
        </button>
      </div>
    </li>
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
  // 카드는 고르는 데 필요한 요약만 유지한다. 작품·회차·장면·출처는 top-layer 팝오버로
  // 분리해 고정 높이 카드가 잘리거나 내부 스크롤을 만들지 않게 한다.
  /**
   * **인스턴스마다 고유해야 한다** (PR #156 리뷰 1). 같은 후보가 시트의 상위 줄과
   * 전체 보기에 동시에 렌더되므로, 후보 id로만 만들면 dialog·title id가 두 개씩 생기고
   * 전체 보기의 상세 버튼이 뒤에 깔린 시트의 팝오버를 연다.
   */
  const instanceId = useId();
  const detailPopoverId = `place-detail-${candidate.id}-${instanceId}`;
  const detailTitleId = `${detailPopoverId}-title`;
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
      className={`rounded-xl border ${selected ? "border-sc-blue ring-2 ring-sc-blue/40" : ""}`}
      data-recommendation-card
    >
      {/* #146 1절 — 카드에는 사진과 이름만 둔다. 역·접근시간·운영시간·작품 근거는
          전부 상세 팝업으로 넘겨 카드가 빡빡해지지 않게 한다 */}
      <div className={sheetStyles.photoCard}>
        <PlaceThumbnail
          label={tr("step3.photoPlaceholder")}
          photo={photo}
          locale={locale}
          variant="cover"
          sizes="(max-width: 768px) 45vw, 240px"
        >
          <PlaceTypeIcon placeType={candidate.placeType} />
        </PlaceThumbnail>

        {/* 사진 위 이름은 어두운 그라디언트 없이도 읽혀야 한다 — CSS의 paint-order 참고.
            우하단 상세 버튼 자리는 `.photoCardBar`가 버튼 기하에서 파생해 비워 둔다 */}
        <div className={sheetStyles.photoCardBar}>
          {/* 운영시간 미확인은 고르기 전에 알아야 한다 (#43). 좌상단은 사진 출처가 쓰므로
              이름과 한 덩어리로 둔다 — 어차피 이 장소에 대한 단서다 */}
          {!hoursLabel && (
            <span className="inline-flex items-center gap-1 rounded bg-sc-orange-soft px-1.5 py-0.5 text-xs text-sc-orange-text shadow">
              <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0" />
              {tr("step3.hoursUnverified")}
            </span>
          )}
          <p
            className={`text-sm font-semibold ${
              // 사진 위에서만 흰 글자 + 검은 테두리를 쓴다. 플레이스홀더는 우리가 만든
              // 밝은 배경이라 대비가 이미 보장되고, 흰 글자를 쓰면 오히려 안 읽힌다
              photo ? sheetStyles.photoCardTitle : "text-sc-text"
            }`}
            data-place-card-title
          >
            {candidate.name[locale]}
          </p>
        </div>

        <button
          type="button"
          className={`${sheetStyles.cornerButton} ${sheetStyles.cornerButtonSelect} text-sm shadow ${
            selected ? "bg-sc-blue text-white" : "border bg-sc-surface/90"
          }`}
          onClick={onToggle}
          aria-label={tr(selected ? "step3.removePlace" : "step3.addPlace").replace("{place}", candidate.name[locale])}
          aria-pressed={selected}
        >
          {selected ? "✓" : "+"}
        </button>

        <button
          type="button"
          data-place-detail-toggle
          popoverTarget={detailPopoverId}
          aria-haspopup="dialog"
          aria-controls={detailPopoverId}
          aria-label={tr("step3.showDetail")}
          className={`${sheetStyles.cornerButton} ${sheetStyles.cornerButtonDetail} border bg-sc-surface/90 text-sc-blue shadow`}
        >
          <Info aria-hidden="true" className="size-4" />
        </button>
      </div>

      <div
        id={detailPopoverId}
        popover="auto"
        role="dialog"
        aria-labelledby={detailTitleId}
        data-place-detail-popover
        className="m-auto max-h-[min(520px,calc(100dvh-32px))] w-[min(480px,calc(100vw-32px))] overflow-auto rounded-xl border bg-sc-surface p-4 text-left shadow-2xl backdrop:bg-black/20"
      >
        <div className="flex items-start justify-between gap-3">
          <h4 id={detailTitleId} className="text-base font-semibold text-sc-text">{candidate.name[locale]}</h4>
          <button
            type="button"
            popoverTarget={detailPopoverId}
            popoverTargetAction="hide"
            aria-label={tr("common.close")}
            className="grid size-8 shrink-0 place-items-center rounded-full border text-sc-muted hover:border-sc-blue hover:text-sc-blue"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>
        {/* 카드에서 내린 요약을 여기서 전부 보여 준다 (#146 1절) */}
        <p className="mt-2 text-xs text-sc-muted" data-place-card-access>
          {stationName(candidate.nearestStationId)} · {tr("access.byCar").replace("{n}", String(candidate.accessEstimate.minutes))}
        </p>
        <p className="mt-1 text-xs text-sc-muted">
          {hoursLabel ?? tr("step3.hoursUnverified")}
        </p>
        {candidate.selectionGroups.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {candidate.selectionGroups.map((group) => (
              <span key={group} className="rounded bg-sc-subtle px-1.5 py-0.5 text-xs text-sc-muted">
                {tr(group === "work" ? "step3.relationSelected" : "step3.relationActor")}
              </span>
            ))}
          </div>
        )}
        <div className="mt-3 border-t pt-3">
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
      </div>
    </li>
  );
}
