import type { CSSProperties } from "react";
import type { CandidateWarning, DayPlan } from "@/lib/engine/types";
import type { ItineraryDisplayMetrics } from "@/lib/itinerary-view";
import type { Locale, MessageKey } from "@/lib/i18n/messages";
import type { SaveStatus } from "./save-stub";
import styles from "./final-itinerary-page.module.css";

const KST = "Asia/Seoul";

type Translator = (key: MessageKey) => string;

type FinalLeg = {
  id: string;
  departAt: string;
  arriveAt: string;
  from: string;
  to: string;
  service: string;
};

function fmtTime(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", {
    timeZone: KST,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function fmtDate(date: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", {
    timeZone: KST,
    month: "short",
    day: "numeric",
    weekday: "short",
  }).format(new Date(`${date}T12:00:00+09:00`));
}

function dayLegs(
  day: DayPlan,
  locale: Locale,
  stationName: (id: string) => string,
): FinalLeg[] {
  return [
    ...(day.gatewayLegs ?? []).map((leg) => ({
      id: leg.id,
      departAt: leg.departAt,
      arriveAt: leg.arriveAt,
      from: leg.fromName[locale],
      to: leg.toName[locale],
      service: leg.serviceName[locale],
    })),
    ...day.rides.map((ride) => ({
      id: `${ride.trainNo}-${ride.departAt}`,
      departAt: ride.departAt,
      arriveAt: ride.arriveAt,
      from: stationName(ride.fromStationId),
      to: stationName(ride.toStationId),
      service: ride.trainNo,
    })),
  ].sort((a, b) => a.departAt.localeCompare(b.departAt));
}

function durationMinutes(departAt: string, arriveAt: string): number | null {
  const minutes = Math.round((Date.parse(arriveAt) - Date.parse(departAt)) / 60_000);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : null;
}

function durationLabel(minutes: number, tr: Translator): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}${tr("region.minutes")}`;
  return `${hours}${tr("region.hours")}${rest > 0 ? ` ${rest}${tr("region.minutes")}` : ""}`;
}

function longestLeg(
  days: DayPlan[],
  locale: Locale,
  stationName: (id: string) => string,
): { leg: FinalLeg; minutes: number; includesGateway: boolean } | null {
  const includesGateway = days.some((day) => day.gatewayLegs !== undefined);
  const legs = days.flatMap((day) => dayLegs(day, locale, stationName));
  let longest: { leg: FinalLeg; minutes: number } | null = null;
  for (const leg of legs) {
    const minutes = durationMinutes(leg.departAt, leg.arriveAt);
    if (minutes !== null && (longest === null || minutes > longest.minutes)) {
      longest = { leg, minutes };
    }
  }
  return longest ? { ...longest, includesGateway } : null;
}

/**
 * 개수 문구 (#131).
 *
 * 영어는 1일 때만 단수형을 쓴다. 한국어는 수에 따라 형태가 바뀌지 않으므로 항상 `other`를
 * 쓰고, 키는 두 언어에 같은 이름으로 존재한다(ko/en 키 대칭).
 *
 * **분기는 여기 한 곳에만 둔다.** 호출부마다 `n === 1`을 적으면 새 개수 문구가 생길 때
 * 한 곳을 빠뜨리고, 그게 정확히 `1 places`가 나오던 경로였다.
 */
function countLabel(
  tr: (key: MessageKey) => string,
  locale: Locale,
  key: "final.dayPlaceCount" | "final.dayLegCount" | "final.legCount" | "final.warningCount",
  n: number,
): string {
  const form = locale === "en" && n === 1 ? "one" : "other";
  return tr(`${key}.${form}` as MessageKey).replace("{n}", String(n));
}

export function FinalItineraryPage({
  days,
  metrics,
  locale,
  placeName,
  stationName,
  warnings,
  warningLabel,
  saveStatus,
  saveStatusLabel,
  onBackToAdjust,
  onSave,
  tr,
}: {
  days: DayPlan[];
  metrics?: ItineraryDisplayMetrics | null;
  locale: Locale;
  placeName: (id: string) => string;
  stationName: (id: string) => string;
  warnings: CandidateWarning[];
  warningLabel: (detail: CandidateWarning["detail"]) => string;
  saveStatus: SaveStatus;
  saveStatusLabel: string;
  onBackToAdjust: () => void;
  onSave: () => void;
  tr: Translator;
}) {
  const placeCount = days.reduce((total, day) => total + day.items.length, 0);
  const legCount = days.reduce(
    (total, day) => total + day.rides.length + (day.gatewayLegs?.length ?? 0),
    0,
  );
  const longest = longestLeg(days, locale, stationName);
  const dayCountStyle = {
    "--final-day-count": Math.max(1, days.length),
  } as CSSProperties;

  return (
    <section className={styles.page} data-final-itinerary>
      <div className="flex flex-wrap items-start justify-between gap-4 border-b pb-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sc-blue">
            {tr("final.eyebrow")}
          </p>
          <h2 className="mt-1 text-2xl font-semibold">{tr("final.title")}</h2>
          <p className="mt-1 text-sm text-sc-muted">{tr("final.subtitle")}</p>
        </div>
        <dl className="grid grid-cols-3 gap-2 text-center">
          {[
            [tr("final.days"), days.length],
            [tr("final.places"), placeCount],
            [tr("final.legs"), legCount],
          ].map(([label, value]) => (
            <div key={label} className="min-w-[76px] rounded-lg border bg-sc-subtle px-3 py-2">
              <dt className="text-xs text-sc-muted">{label}</dt>
              <dd className="text-lg font-semibold text-sc-blue">{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      {(metrics || longest) && (
        <section className="mt-4 rounded-xl border bg-sc-subtle p-4" aria-labelledby="final-travel-summary">
          <h3 id="final-travel-summary" className="text-xs font-semibold uppercase tracking-wide text-sc-muted">
            {tr("final.travelSummary")}
          </h3>
          <dl className="mt-3 grid gap-2 sm:grid-cols-3">
            {metrics && (
              <>
                <div className="rounded-lg bg-sc-surface px-3 py-2.5">
                  <dt className="text-xs text-sc-muted">{tr("final.totalTravelTime")}</dt>
                  <dd className="mt-1 text-base font-semibold text-sc-blue">
                    {durationLabel(metrics.totalTravelMinutes, tr)}
                  </dd>
                </div>
                {metrics.transferCount !== null && (
                  <div className="rounded-lg bg-sc-surface px-3 py-2.5">
                    <dt className="text-xs text-sc-muted">{tr("final.transfers")}</dt>
                    <dd className="mt-1 text-base font-semibold text-sc-blue">
                      {tr("final.transferCount").replace("{n}", String(metrics.transferCount))}
                    </dd>
                  </div>
                )}
              </>
            )}
            {longest && (
              <div className="rounded-lg bg-sc-surface px-3 py-2.5">
                <dt className="text-xs text-sc-muted">
                  {tr(longest.includesGateway ? "final.longestTransportLeg" : "final.longestTrainLeg")}
                </dt>
                <dd className="mt-1 text-base font-semibold text-sc-blue">
                  {durationLabel(longest.minutes, tr)}
                </dd>
                <dd className="mt-0.5 text-xs text-sc-muted">
                  {longest.leg.from} → {longest.leg.to}
                </dd>
              </div>
            )}
          </dl>
          <p className="mt-3 text-xs leading-relaxed text-sc-muted">
            {tr(metrics ? "final.travelScopeNote" : "final.longestScopeNote")}
          </p>
        </section>
      )}

      <div className={`${styles.dayGrid} mt-4`} style={dayCountStyle}>
        {days.map((day, index) => {
          const legs = dayLegs(day, locale, stationName);
          const firstLeg = legs[0];
          const lastLeg = legs.at(-1);
          const dayPlaceIds = new Set(day.items.map((item) => item.placeId));
          const dayWarnings = warnings.filter((warning) => dayPlaceIds.has(warning.placeId));
          return (
            <article
              key={day.date}
              className={`${styles.dayCard} rounded-xl border bg-sc-surface p-4 shadow-sm`}
              data-final-day={day.date}
            >
              <div className="flex items-baseline justify-between gap-2 border-b pb-3">
                <div>
                  <p className="text-xs font-semibold text-sc-blue">
                    {tr("final.dayNumber").replace("{n}", String(index + 1))}
                  </p>
                  <h3 className="mt-0.5 text-lg font-semibold">{fmtDate(day.date, locale)}</h3>
                </div>
                <span className="rounded-full bg-sc-blue-soft px-2.5 py-1 text-xs font-medium text-sc-blue">
                  {countLabel(tr, locale, "final.dayPlaceCount", day.items.length)}
                  {" · "}
                  {countLabel(tr, locale, "final.dayLegCount", legs.length)}
                </span>
              </div>

              <div className="mt-3 rounded-lg bg-sc-subtle px-3 py-2.5">
                <p className="text-xs font-medium text-sc-muted">{tr("final.movementWindow")}</p>
                {firstLeg && lastLeg ? (
                  <p className="mt-1 text-sm font-medium leading-snug">
                    {fmtTime(firstLeg.departAt, locale)} {firstLeg.from}
                    <span aria-hidden className="mx-1 text-sc-blue">→</span>
                    {fmtTime(lastLeg.arriveAt, locale)} {lastLeg.to}
                  </p>
                ) : (
                  <p className="mt-1 text-sm text-sc-muted">{tr("final.noMovement")}</p>
                )}
              </div>

              <div className="mt-4">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-sc-muted">
                  {tr("final.placesTitle")}
                </h4>
                <ol className="mt-2 space-y-2">
                  {day.items.map((item, placeIndex) => (
                    <li key={item.placeId} className="flex gap-2 text-sm leading-snug">
                      <span
                        aria-hidden
                        className="grid size-5 shrink-0 place-items-center rounded-full bg-sc-blue text-[11px] font-semibold text-white"
                      >
                        {placeIndex + 1}
                      </span>
                      <span className="font-medium">{placeName(item.placeId)}</span>
                    </li>
                  ))}
                </ol>
              </div>

              {dayWarnings.length > 0 && (
                <details
                  className="mt-4 rounded-lg border border-sc-orange bg-sc-orange-soft/50"
                  data-final-warning
                >
                  <summary className="flex min-h-10 list-none items-center justify-between gap-2 px-3 py-2 text-sm font-medium text-sc-orange-text">
                    <span>{tr("step4.warningsTitle")}</span>
                    <span className="text-xs">
                      {countLabel(tr, locale, "final.warningCount", dayWarnings.length)}
                    </span>
                  </summary>
                  <ul className="space-y-2 border-t border-sc-orange px-3 py-3 text-xs leading-relaxed text-sc-orange-text">
                    {dayWarnings.map((warning) => (
                      <li key={`${warning.placeId}-${warning.detail}`}>
                        <span className="font-semibold">{placeName(warning.placeId)}</span>
                        {" — "}{warningLabel(warning.detail)}
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              {legs.length > 0 && (
                <details className="mt-4 rounded-lg border bg-sc-subtle/60">
                  <summary className="flex min-h-10 list-none items-center justify-between gap-2 px-3 py-2 text-sm font-medium">
                    <span>{tr("final.transportDetails")}</span>
                    <span className="text-xs text-sc-muted">
                      {countLabel(tr, locale, "final.legCount", legs.length)}
                    </span>
                  </summary>
                  <ol className="space-y-2 border-t px-3 py-3 text-xs text-sc-muted">
                    {legs.map((leg) => (
                      <li key={leg.id}>
                        <span className="font-medium text-sc-text">{fmtTime(leg.departAt, locale)}</span>
                        {" "}{leg.from} → {leg.to}
                        <span className="ml-1">· {leg.service}</span>
                      </li>
                    ))}
                  </ol>
                </details>
              )}
            </article>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <button
          type="button"
          className="rounded-lg border px-4 py-2.5 text-sm font-medium hover:border-sc-blue"
          onClick={onBackToAdjust}
        >
          {tr("final.backToAdjust")}
        </button>
        <div className="flex items-center gap-3">
          <span
            role="status"
            className={`text-sm ${saveStatus === "saved" ? "text-sc-green" : saveStatus === "error" ? "text-sc-red" : "text-sc-muted"}`}
          >
            {saveStatusLabel}
          </span>
          <button
            type="button"
            className="rounded-lg bg-sc-blue px-5 py-2.5 text-sm font-semibold text-white"
            onClick={onSave}
          >
            {tr("final.save")}
          </button>
        </div>
      </div>
    </section>
  );
}
