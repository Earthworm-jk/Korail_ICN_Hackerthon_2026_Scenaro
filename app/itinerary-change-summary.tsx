import type { MessageKey } from "@/lib/i18n/messages";
import type { ItineraryDiff } from "@/lib/itinerary-diff";
import { StageUtilityPortal } from "./stage-utility-portal";

type Props = {
  diff: ItineraryDiff;
  placeName: (placeId: string) => string;
  reasonLabel: (reason: NonNullable<ItineraryDiff["places"]["dropped"][number]["reason"]>) => string;
  tr: (key: MessageKey) => string;
};

function withValues(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
    template,
  );
}

/**
 * 재계산 전후 변화 요약 (#118 P0-2).
 *
 * 지도 경로 애니메이션만으로는 무엇이 달라졌는지 알 수 없다. 화면에는 먼저 변화량을 짧게
 * 보여주고, 장소 이름·날짜·제외 사유는 접힌 상세에서 확인하게 한다. 일정 카드 옆의 좁은
 * 태블릿 패널을 다시 긴 문장으로 채우지 않기 위해서다.
 */
export function ItineraryChangeSummary({ diff, placeName, reasonLabel, tr }: Props) {
  if (!diff.changed) {
    return (
      <StageUtilityPortal>
        <details
          data-stage-utility="change"
          data-itinerary-change="unchanged"
          className="group rounded-lg border border-sc-blue/25 bg-sc-blue-soft"
        >
          <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
            {tr("step4.changeUnchangedTitle")} {tr("step4.changeUnchanged")}
          </span>
          <summary className="flex min-h-11 list-none items-center justify-between gap-3 px-3 py-2.5 text-sm marker:content-none">
            <span className="min-w-0">
              <strong className="block font-medium text-sc-blue">{tr("step4.changeDockTitle")}</strong>
              <span className="block text-xs text-sc-text/70">{tr("step4.changeUnchangedShort")}</span>
            </span>
            <span aria-hidden className="shrink-0 text-sc-muted transition-transform group-open:rotate-180">⌄</span>
          </summary>
          <div className="border-t border-sc-blue/15 px-3 pb-3 pt-2 text-sm text-sc-text/75">
            {tr("step4.changeUnchanged")}
          </div>
        </details>
      </StageUtilityPortal>
    );
  }

  const changedRideCount = Math.max(diff.rides.added.length, diff.rides.dropped.length);
  const detailCount =
    diff.places.added.length + diff.places.moved.length + diff.places.dropped.length;
  const dockChangeCount = detailCount + changedRideCount;

  const summaryCounts = [
    diff.places.added.length > 0
      ? withValues(tr("step4.changeAddedCount"), { n: diff.places.added.length })
      : null,
    diff.places.moved.length > 0
      ? withValues(tr("step4.changeMovedCount"), { n: diff.places.moved.length })
      : null,
    diff.places.dropped.length > 0
      ? withValues(tr("step4.changeDroppedCount"), { n: diff.places.dropped.length })
      : null,
    changedRideCount > 0
      ? withValues(tr("step4.changeRideCount"), { n: changedRideCount })
      : null,
  ].filter((value): value is string => value !== null);

  return (
    <StageUtilityPortal>
      <details
        data-stage-utility="change"
        data-itinerary-change="changed"
        className="group rounded-lg border border-sc-blue/30 bg-sc-blue-soft"
      >
        <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {tr("step4.changeTitle")} {summaryCounts.join(" · ")}
        </span>
        <summary className="flex min-h-11 list-none items-center justify-between gap-3 px-3 py-2.5 text-sm marker:content-none">
          <span className="min-w-0">
            <strong className="block font-semibold text-sc-blue">{tr("step4.changeDockTitle")}</strong>
            <span className="block text-xs text-sc-text/70">
              {withValues(tr("step4.changeDockSummary"), { n: dockChangeCount })}
            </span>
          </span>
          <span aria-hidden className="shrink-0 text-sc-muted transition-transform group-open:rotate-180">⌄</span>
        </summary>

        <div className="border-t border-sc-blue/15 px-3 pb-3 pt-2 text-sm text-sc-text/80">
          <div className="flex flex-wrap gap-1.5 text-xs font-medium">
          {diff.places.added.length > 0 && (
            <span className="rounded-full bg-sc-surface px-2 py-1">
              {withValues(tr("step4.changeAddedCount"), { n: diff.places.added.length })}
            </span>
          )}
          {diff.places.moved.length > 0 && (
            <span className="rounded-full bg-sc-surface px-2 py-1">
              {withValues(tr("step4.changeMovedCount"), { n: diff.places.moved.length })}
            </span>
          )}
          {diff.places.dropped.length > 0 && (
            <span className="rounded-full bg-sc-surface px-2 py-1">
              {withValues(tr("step4.changeDroppedCount"), { n: diff.places.dropped.length })}
            </span>
          )}
          {changedRideCount > 0 && (
            <span className="rounded-full bg-sc-surface px-2 py-1">
              {withValues(tr("step4.changeRideCount"), { n: changedRideCount })}
            </span>
          )}
          </div>

          {detailCount > 0 && (
          <section className="mt-3" aria-label={tr("step4.changeDetails")}>
            <h4 className="font-medium text-sc-blue">{tr("step4.changeDetails")}</h4>
          <ul className="mt-2 space-y-1.5">
            {diff.places.added.map(({ placeId }) => (
              <li key={`added-${placeId}`}>
                {withValues(tr("step4.changeAdded"), { place: placeName(placeId) })}
              </li>
            ))}
            {diff.places.moved.map(({ placeId, fromDate, toDate }) => (
              <li key={`moved-${placeId}`}>
                {withValues(tr("step4.changeMoved"), {
                  place: placeName(placeId),
                  from: fromDate,
                  to: toDate,
                })}
              </li>
            ))}
            {diff.places.dropped.map(({ placeId, reason }) => (
              <li key={`dropped-${placeId}`}>
                {withValues(tr("step4.changeDropped"), { place: placeName(placeId) })}
                {reason ? ` · ${withValues(tr("step4.changeReason"), { reason: reasonLabel(reason) })}` : ""}
              </li>
            ))}
          </ul>
          </section>
          )}
        </div>
      </details>
    </StageUtilityPortal>
  );
}
