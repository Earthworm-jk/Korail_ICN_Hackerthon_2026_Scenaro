import type { CSSProperties } from "react";
import type { DayPlan } from "@/lib/engine/types";
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

export function FinalItineraryPage({
  days,
  locale,
  placeName,
  stationName,
  saveStatus,
  saveStatusLabel,
  onBackToAdjust,
  onSave,
  tr,
}: {
  days: DayPlan[];
  locale: Locale;
  placeName: (id: string) => string;
  stationName: (id: string) => string;
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

      <div className={`${styles.dayGrid} mt-4`} style={dayCountStyle}>
        {days.map((day, index) => {
          const legs = dayLegs(day, locale, stationName);
          const firstLeg = legs[0];
          const lastLeg = legs.at(-1);
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
                  {tr("final.daySummary")
                    .replace("{places}", String(day.items.length))
                    .replace("{legs}", String(legs.length))}
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

              {legs.length > 0 && (
                <details className="mt-4 rounded-lg border bg-sc-subtle/60">
                  <summary className="flex min-h-10 list-none items-center justify-between gap-2 px-3 py-2 text-sm font-medium">
                    <span>{tr("final.transportDetails")}</span>
                    <span className="text-xs text-sc-muted">
                      {tr("final.legCount").replace("{n}", String(legs.length))}
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
