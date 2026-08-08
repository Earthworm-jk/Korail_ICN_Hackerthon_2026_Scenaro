"use client";
/**
 * 4단계 위저드 골격 — 여행 조건 → K-콘텐츠 → 촬영지 → 일정 결과 (ver.0.3·#14 ver.0.4 확정)
 * - 배우·작품 복수 선택 칩, 필수 방문 없음(전부 자유 선택), 방문지별 시각 미표기(역 단위 체류)
 * - 편집 = 촬영지 재선택·항공 시각 변경 후 전체 재계산 (무상태)
 * - 저장·로그인(lazy login)·대안 시간표는 자리만 — 후속 슬롯에서 연결
 */
import { useCallback, useMemo, useState } from "react";
import { searchEntities, type ActorSummary, type WorkSummary } from "@/lib/actions/search";
import {
  getCandidatePlaces,
  type CandidateResponse,
  type PlaceCandidate,
} from "@/lib/actions/places";
import { planItinerary } from "@/lib/actions/itinerary";
import { excludedPlaceIdsFrom, selectableCandidateIds } from "@/lib/candidates";
import { getFlightInfo } from "@/lib/actions/flights";
import type { ItineraryResult } from "@/lib/engine/types";
import { t, type Locale, type MessageKey } from "@/lib/i18n/messages";

const KST = "Asia/Seoul";

function fmtTime(iso: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: KST, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(iso));
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return `${kst.getUTCFullYear()}-${p(kst.getUTCMonth() + 1)}-${p(kst.getUTCDate())}T${p(kst.getUTCHours())}:${p(kst.getUTCMinutes())}`;
}

function fromLocalInput(value: string): string {
  return `${value}:00+09:00`;
}

type FlightField = {
  flightNo: string;
  at: string; // datetime-local (KST)
  notFound: boolean;
};

const STEPS: MessageKey[] = ["nav.step1", "nav.step2", "nav.step3", "nav.step4"];

export default function PlannerWizard() {
  const [locale, setLocale] = useState<Locale>("ko");
  const [step, setStep] = useState(1);
  const tr = useCallback((key: MessageKey) => t(locale, key), [locale]);

  // step 1 — 여행 조건
  const [arrival, setArrival] = useState<FlightField>({ flightNo: "", at: "2026-08-12T10:00", notFound: false });
  const [departure, setDeparture] = useState<FlightField>({ flightNo: "", at: "2026-08-14T18:00", notFound: false });
  const [exitOffset, setExitOffset] = useState(120);
  const [departureBuffer, setDepartureBuffer] = useState(120);

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

  // step 4 — 결과
  const [result, setResult] = useState<ItineraryResult | null>(null);
  const [planning, setPlanning] = useState(false);
  // PR #30 리뷰 ③: 입력 오류(invalid)와 예상 밖 장애(unexpected)를 구분하고, 실패 시 기존 결과를 유지한다
  const [planError, setPlanError] = useState<"invalid" | "unexpected" | null>(null);

  const lookup = useCallback(async (direction: "arrival" | "departure") => {
    const field = direction === "arrival" ? arrival : departure;
    const setField = direction === "arrival" ? setArrival : setDeparture;
    if (!field.flightNo.trim()) return;
    const res = await getFlightInfo(field.flightNo, direction);
    if (res.ok) {
      setField({ ...field, at: toLocalInput(res.flight.scheduledAt), notFound: false });
    } else {
      setField({ ...field, notFound: true });
    }
  }, [arrival, departure]);

  const runSearch = useCallback(async (value: string) => {
    setQuery(value);
    if (!value.trim()) { setResults({ actors: [], works: [] }); setSearched(false); return; }
    setResults(await searchEntities(value));
    setSearched(true);
  }, []);

  const loadCandidates = useCallback(async () => {
    const data = await getCandidatePlaces({
      selectedActorIds: selectedActors.map((a) => a.id),
      selectedWorkIds: selectedWorks.map((w) => w.id),
    });
    setCandidateData(data);
    // #14·PR #30 리뷰 ①: 미확인 후보는 표시 전용 — 초기 선택은 검증 후보만
    setSelectedPlaceIds(new Set(selectableCandidateIds(data.candidates)));
    setStep(3);
  }, [selectedActors, selectedWorks]);

  const plan = useCallback(async () => {
    if (!candidateData) return;
    setPlanning(true);
    setPlanError(null);
    setStep(4);
    try {
      const res = await planItinerary({
        arrivalAt: fromLocalInput(arrival.at),
        departureAt: fromLocalInput(departure.at),
        airportExitOffsetMin: exitOffset,
        departureBufferMinutes: departureBuffer,
        selectedActorIds: selectedActors.map((a) => a.id),
        selectedWorkIds: selectedWorks.map((w) => w.id),
        excludedPlaceIds: excludedPlaceIdsFrom(candidateData.candidates, selectedPlaceIds),
      });
      if (res.ok) setResult(res.result);
      else setPlanError("invalid"); // 1단계 검증을 우회한 요청 — 기존 결과 유지
    } catch {
      setPlanError("unexpected"); // 네트워크·서버 장애 — 기존 결과 유지
    } finally {
      setPlanning(false);
    }
  }, [candidateData, selectedPlaceIds, arrival.at, departure.at, exitOffset, departureBuffer, selectedActors, selectedWorks]);

  const sortedCandidates = useMemo(() => {
    if (!candidateData) return [];
    const relRank = (c: PlaceCandidate) => (c.relation === "selected_work" ? 0 : 1);
    const list = [...candidateData.candidates];
    // PRD 5.3 확정 정렬 — UI 전용, 엔진 순위와 분리
    list.sort((a, b) =>
      sortBy === "relevance"
        ? relRank(a) - relRank(b) || b.officialSourceCount - a.officialSourceCount || a.id.localeCompare(b.id, "en")
        : b.officialSourceCount - a.officialSourceCount || relRank(a) - relRank(b) || a.id.localeCompare(b.id, "en"),
    );
    return list;
  }, [candidateData, sortBy]);

  const verifiedCandidates = sortedCandidates.filter((c) => c.openingHours.type !== "unverified");
  const unverifiedCandidates = sortedCandidates.filter((c) => c.openingHours.type === "unverified");

  const stationName = (id: string) =>
    candidateData?.stations.find((s) => s.id === id)?.name[locale] ?? id;
  const placeName = (id: string) =>
    candidateData?.candidates.find((c) => c.id === id)?.name[locale] ?? id;
  const workTitles = (ids: string[]) =>
    ids.map((id) => candidateData?.works.find((w) => w.id === id)?.title[locale] ?? id).join(" · ");

  const toggleChip = <T extends { id: string }>(list: T[], set: (v: T[]) => void, item: T) => {
    set(list.some((x) => x.id === item.id) ? list.filter((x) => x.id !== item.id) : [...list, item]);
  };

  // PR #30 리뷰 ③: 필수값·입출국 순서는 1단계에서 막는다 (와이어프레임 계약)
  const step1Error: MessageKey | null =
    !arrival.at || !departure.at
      ? "step1.errRequired"
      : Date.parse(fromLocalInput(departure.at)) <= Date.parse(fromLocalInput(arrival.at))
        ? "step1.errOrder"
        : null;

  return (
    <div className="mx-auto max-w-3xl p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{tr("app.title")}</h1>
          <p className="text-sm text-gray-500">{tr("app.tagline")}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-amber-100 px-2 py-1 text-xs text-amber-800">{tr("app.snapshotBadge")}</span>
          <button
            className="rounded border px-2 py-1 text-xs"
            onClick={() => setLocale(locale === "ko" ? "en" : "ko")}
          >
            {locale === "ko" ? "EN" : "한국어"}
          </button>
        </div>
      </header>

      <nav className="mt-6 grid grid-cols-4 gap-1 text-center text-sm">
        {STEPS.map((key, i) => (
          <div
            key={key}
            className={`rounded border-b-2 px-1 py-2 ${step === i + 1 ? "border-blue-600 bg-blue-50 font-semibold text-blue-700" : "border-transparent text-gray-400"}`}
          >
            {i + 1}. {tr(key)}
          </div>
        ))}
      </nav>

      {step === 1 && (
        <section className="mt-6">
          <h2 className="text-lg font-semibold">{tr("step1.title")}</h2>
          <p className="text-sm text-gray-500">{tr("step1.subtitle")}</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {([
              ["arrival", arrival, setArrival] as const,
              ["departure", departure, setDeparture] as const,
            ]).map(([direction, field, setField]) => (
              <div key={direction} className="rounded-lg border p-4">
                <h3 className="font-medium">
                  {tr(direction === "arrival" ? "step1.arrival" : "step1.departure")}
                  <span className="ml-2 rounded bg-teal-50 px-1.5 py-0.5 text-xs text-teal-700">ICN</span>
                </h3>
                <label className="mt-3 block text-xs text-gray-500">{tr("step1.flightNo")}</label>
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
                {field.notFound && <p className="mt-1 text-xs text-red-600">{tr("step1.notFound")}</p>}
                <label className="mt-3 block text-xs text-gray-500">{tr("step1.scheduledAt")}</label>
                <input
                  type="datetime-local"
                  className="mt-1 w-full rounded border px-2 py-1 text-sm"
                  value={field.at}
                  onChange={(e) => setField({ ...field, at: e.target.value })}
                />
              </div>
            ))}
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border p-4">
              <label className="text-sm font-medium">{tr("step1.exitOffset")}</label>
              <div className="mt-2 flex gap-2">
                {[90, 120].map((v) => (
                  <button
                    key={v}
                    className={`rounded border px-3 py-1 text-sm ${exitOffset === v ? "border-blue-600 bg-blue-50 text-blue-700" : ""}`}
                    onClick={() => setExitOffset(v)}
                  >
                    {v}{tr("step1.minutes")}
                  </button>
                ))}
                <input
                  type="number"
                  min={0}
                  className="w-24 rounded border px-2 py-1 text-sm"
                  placeholder={tr("step1.exitOffsetCustom")}
                  onChange={(e) => setExitOffset(Number(e.target.value) || 0)}
                />
              </div>
            </div>
            <div className="rounded-lg border p-4">
              <label className="text-sm font-medium">{tr("step1.departureBuffer")}</label>
              <div className="mt-2 flex gap-2">
                {[90, 120, 180].map((v) => (
                  <button
                    key={v}
                    className={`rounded border px-3 py-1 text-sm ${departureBuffer === v ? "border-blue-600 bg-blue-50 text-blue-700" : ""}`}
                    onClick={() => setDepartureBuffer(v)}
                  >
                    {v}{tr("step1.minutes")}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-end gap-3">
            {step1Error && <p className="text-sm text-red-600">{tr(step1Error)}</p>}
            <button
              className="rounded bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-40"
              disabled={step1Error !== null}
              onClick={() => setStep(2)}
            >
              {tr("common.next")}: {tr("nav.step2")}
            </button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="mt-6">
          <h2 className="text-lg font-semibold">{tr("step2.title")}</h2>
          <p className="text-sm text-gray-500">{tr("step2.subtitle")}</p>
          <input
            className="mt-4 w-full rounded border px-3 py-2"
            placeholder={tr("step2.placeholder")}
            value={query}
            onChange={(e) => runSearch(e.target.value)}
          />
          {searched && results.actors.length === 0 && results.works.length === 0 && (
            <p className="mt-3 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              {tr("step2.noResult")}
            </p>
          )}
          <ul className="mt-3 space-y-1">
            {results.actors.map((a) => (
              <li key={a.id}>
                <button
                  className="w-full rounded border px-3 py-2 text-left text-sm hover:bg-gray-50"
                  onClick={() => toggleChip(selectedActors, setSelectedActors, a)}
                >
                  {a.name[locale]} <span className="ml-1 text-xs text-gray-400">{tr("step2.actor")}</span>
                </button>
              </li>
            ))}
            {results.works.map((w) => (
              <li key={w.id}>
                <button
                  className="w-full rounded border px-3 py-2 text-left text-sm hover:bg-gray-50"
                  onClick={() => toggleChip(selectedWorks, setSelectedWorks, w)}
                >
                  {w.title[locale]} <span className="ml-1 text-xs text-gray-400">{tr("step2.work")}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-4 rounded-lg border bg-gray-50 p-3">
            <h3 className="text-sm font-medium">{tr("step2.selected")}</h3>
            {selectedActors.length === 0 && selectedWorks.length === 0 ? (
              <p className="mt-1 text-sm text-gray-400">{tr("step2.empty")}</p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-2">
                {selectedActors.map((a) => (
                  <button
                    key={a.id}
                    className="rounded-full bg-blue-100 px-3 py-1 text-sm text-blue-800"
                    onClick={() => toggleChip(selectedActors, setSelectedActors, a)}
                  >
                    {a.name[locale]} · {tr("step2.actor")} ×
                  </button>
                ))}
                {selectedWorks.map((w) => (
                  <button
                    key={w.id}
                    className="rounded-full bg-violet-100 px-3 py-1 text-sm text-violet-800"
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
              className="rounded bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-40"
              disabled={selectedActors.length === 0 && selectedWorks.length === 0}
              onClick={loadCandidates}
            >
              {tr("common.next")}: {tr("nav.step3")}
            </button>
          </div>
        </section>
      )}

      {step === 3 && candidateData && (
        <section className="mt-6">
          <h2 className="text-lg font-semibold">{tr("step3.title")}</h2>
          <p className="text-sm text-gray-500">{tr("step3.subtitle")}</p>
          <div className="mt-3 flex gap-2 text-sm">
            {(["relevance", "official"] as const).map((mode) => (
              <button
                key={mode}
                className={`rounded border px-3 py-1 ${sortBy === mode ? "border-blue-600 bg-blue-50 text-blue-700" : ""}`}
                onClick={() => setSortBy(mode)}
              >
                {tr(mode === "relevance" ? "step3.sortRelevance" : "step3.sortOfficial")}
              </button>
            ))}
          </div>
          {sortedCandidates.length === 0 && (
            <p className="mt-4 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              {tr("step3.noCandidates")}
            </p>
          )}
          <ul className="mt-3 space-y-2">
            {verifiedCandidates.map((c) => (
              <PlaceCard key={c.id} candidate={c} locale={locale} tr={tr}
                selected={selectedPlaceIds.has(c.id)}
                stationName={stationName} workTitles={workTitles}
                onToggle={() => {
                  const next = new Set(selectedPlaceIds);
                  if (next.has(c.id)) next.delete(c.id); else next.add(c.id);
                  setSelectedPlaceIds(next);
                }}
              />
            ))}
          </ul>
          {unverifiedCandidates.length > 0 && (
            <div className="mt-4 rounded-lg border border-dashed p-3">
              <h3 className="text-sm font-medium text-gray-600">{tr("step3.needsCheck")}</h3>
              <p className="text-xs text-gray-400">{tr("step3.needsCheckDesc")}</p>
              <ul className="mt-2 space-y-2">
                {unverifiedCandidates.map((c) => (
                  // #14·PR #30 리뷰 ①: 참고 표시 전용 — 선택 조작 없음
                  <PlaceCard key={c.id} candidate={c} locale={locale} tr={tr}
                    selected={false}
                    stationName={stationName} workTitles={workTitles}
                  />
                ))}
              </ul>
            </div>
          )}
          <div className="mt-4 flex justify-between">
            <button className="rounded border px-4 py-2 text-sm" onClick={() => setStep(2)}>{tr("common.back")}</button>
            <button
              className="rounded bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-40"
              disabled={selectedPlaceIds.size === 0}
              onClick={plan}
            >
              {tr("step3.generate")}
            </button>
          </div>
        </section>
      )}

      {step === 4 && (
        <section className="mt-6">
          <h2 className="text-lg font-semibold">{tr("step4.title")}</h2>
          <p className="text-sm text-gray-500">{tr("step4.subtitle")}</p>

          {planning && <p className="mt-6 text-center text-sm text-gray-500">{tr("step4.generating")}</p>}

          {!planning && planError && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {tr(planError === "invalid" ? "step4.errInvalid" : "step4.errUnexpected")}
            </div>
          )}

          {!planning && result && result.ok && result.status === "planned" && (
            <div className="mt-4 space-y-4">
              {result.days.map((day) => (
                <div key={day.date} className="rounded-lg border p-4">
                  <h3 className="font-medium">{day.date}</h3>
                  <ul className="mt-2 space-y-1 text-sm">
                    {day.rides.map((ride) => (
                      <li key={`${ride.trainNo}-${ride.departAt}`} className="text-gray-700">
                        🚆 {fmtTime(ride.departAt)} {stationName(ride.fromStationId)} → {fmtTime(ride.arriveAt)} {stationName(ride.toStationId)}
                        <span className="ml-2 text-xs text-gray-400">{tr("step4.train")} {ride.trainNo}</span>
                      </li>
                    ))}
                    {/* #14: 장소 단위 시각 미표기 — 역 단위 활용시간은 엔진 출력 계약 추가 후 표시 (#33) */}
                    {day.items.map((item) => (
                      <li key={item.placeId} className="text-gray-700">
                        📍 {placeName(item.placeId)}
                        <span className="ml-2 text-xs text-gray-500">{item.accessMinutesLabel}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {result.rejectedPlaces.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                  <h3 className="text-sm font-medium text-amber-800">{tr("step4.rejectedTitle")}</h3>
                  <ul className="mt-2 space-y-1 text-sm text-amber-800">
                    {result.rejectedPlaces.map((reason) => (
                      <li key={`${reason.placeId}-${reason.code}`}>
                        {placeName(reason.placeId)} — {tr(`reason.${reason.code}` as MessageKey)}
                        {"detail" in reason && <> ({tr(`reason.${reason.detail}` as MessageKey)})</>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {!planning && result && result.ok && result.status === "empty" && (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
              <h3 className="font-medium text-amber-800">{tr("step4.emptyTitle")}</h3>
              <p className="mt-1 text-sm text-amber-700">{tr("step4.emptyDesc")}</p>
              {result.rejectedPlaces.length > 0 && (
                <ul className="mt-2 space-y-1 text-sm text-amber-800">
                  {result.rejectedPlaces.map((reason) => (
                    <li key={`${reason.placeId}-${reason.code}`}>
                      {placeName(reason.placeId)} — {tr(`reason.${reason.code}` as MessageKey)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {!planning && result && !result.ok && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {tr("step4.failTitle")}
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-2">
              <button className="rounded border px-3 py-2 text-sm" onClick={() => setStep(3)}>{tr("step4.editPlaces")}</button>
              <button className="rounded border px-3 py-2 text-sm" onClick={() => setStep(1)}>{tr("step4.editFlights")}</button>
              <button className="rounded border px-3 py-2 text-sm" onClick={plan}>{tr("step4.recalculate")}</button>
            </div>
            <button className="rounded bg-gray-300 px-4 py-2 text-sm text-gray-600" title={tr("step4.saveStub")} disabled>
              ♡ {tr("step4.save")}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function PlaceCard({ candidate, locale, tr, selected, onToggle, stationName, workTitles }: {
  candidate: PlaceCandidate;
  locale: Locale;
  tr: (key: MessageKey) => string;
  selected: boolean;
  onToggle?: () => void; // 없으면 표시 전용 카드 (#14·PR #30 리뷰 ①)
  stationName: (id: string) => string;
  workTitles: (ids: string[]) => string;
}) {
  const oh = candidate.openingHours;
  const hoursLabel =
    oh.type === "always_open" ? tr("step3.alwaysOpen")
    : oh.type === "hours" ? `${oh.open}–${oh.close}`
    : tr("step3.hoursUnverified");
  const source = oh.type !== "unverified" ? `${oh.source} · ${oh.verifiedAt} ${tr("step3.verifiedAt")}` : null;

  return (
    <li className={`rounded-lg border p-3 ${selected ? "border-blue-400 bg-blue-50/40" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm">
          <p className="font-medium">
            {candidate.name[locale]}
            <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
              {tr(candidate.relation === "selected_work" ? "step3.relationSelected" : "step3.relationActor")}
            </span>
          </p>
          <p className="mt-1 text-xs text-gray-500">
            {workTitles(candidate.workIds)} · {stationName(candidate.nearestStationId)} · {tr("step3.accessAbout")} {candidate.accessEstimate.minutes}{tr("step3.accessEstimate")}
          </p>
          <p className="mt-0.5 text-xs text-gray-500">
            {hoursLabel}{source ? ` · ${source}` : ""}
          </p>
        </div>
        {onToggle ? (
          <button
            className={`shrink-0 rounded px-3 py-1 text-sm ${selected ? "bg-blue-600 text-white" : "border"}`}
            onClick={onToggle}
          >
            {selected ? "✓" : "+"}
          </button>
        ) : (
          <span className="shrink-0 rounded bg-gray-100 px-3 py-1 text-xs text-gray-500">
            {tr("step3.viewOnly")}
          </span>
        )}
      </div>
    </li>
  );
}
