"use client";
/**
 * v0.6 시안 한반도 지도 (#14 — 클릭형 HTML이 계약 기준)
 *
 * 시안의 `sc-map-panel` 두 벌을 한 컴포넌트로 옮겼다.
 *   3단계 `data-map-kind="places"` — 선택 가능한 촬영지 위치
 *   4단계 `data-map-kind="route"`  — 일정 rides 순서를 잇는 전체 이동 동선
 *
 * 원칙:
 * - 모든 점은 실좌표 투영이다. 좌표가 없는 장소는 임의 위치로 대체하지 않고 표시에서 뺀다 (A3).
 *   대신 몇 곳이 빠졌는지 화면에 밝힌다 — 조용히 사라지면 사용자는 누락을 알 수 없다.
 * - 동선은 권역이 이어지는 순서를 보여주는 보조 시각화다 (#14 §6). 실제 도로·경로처럼
 *   보이지 않도록 역 지점만 잇고, 지도 옆에 그 사실을 항상 문구로 붙인다.
 * - 라벨은 역(권역) 단위다. 시안은 데모용 2-4개를 손으로 배치했지만 실제 시드는 촬영지가
 *   서로 1px 미만까지 겹친다(월정사-전나무 숲길 0.25px). 장소마다 라벨을 달면 읽을 수 없어
 *   역 허브 모델(역 단위 체류)에 맞춰 권역 라벨로 바꿨다 — PR 본문 잔차 표에 기록.
 */
import type { ReactNode } from "react";
import { catmullRomPath, project, VIEW_BOX } from "@/lib/korea-map-projection";
import { KOREA_OUTLINE_PATH } from "@/lib/korea-outline";
import { routeStationSequence } from "@/lib/map-route";
import {
  LABEL_FONT_SIZE,
  LABEL_LINE_HEIGHT,
  layoutLabels,
  type LabelSeed,
  type PlacedLabel,
} from "@/lib/map-labels";
import type { MessageKey } from "@/lib/i18n/messages";

export type MapPlace = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  stationId: string;
  selected: boolean;
};

export type MapStation = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  isAirport: boolean;
};

function MapLabels({ labels }: { labels: readonly PlacedLabel[] }) {
  return (
    <>
      {labels.map((label) => {
        // 지시선은 라벨이 실제로 밀렸을 때만 — 붙어 있으면 선이 오히려 지저분하다
        const moved = Math.abs(label.y - label.from.y) > 2;
        return (
          <g key={label.key}>
            {moved && (
              <line
                x1={label.from.x}
                y1={label.from.y}
                x2={label.x + (label.anchor === "start" ? -2 : 2)}
                y2={label.y - 3}
                className="stroke-sc-line"
                strokeWidth={0.8}
              />
            )}
            {/* 알약 배경 — 해안선·동선 위에 글씨가 얹히면 읽히지 않는다 (발표자료 라벨 방식) */}
            <rect
              x={label.left - 3.5}
              y={label.top}
              width={label.right - label.left + 7}
              height={label.bottom - label.top}
              rx={4}
              className="fill-sc-surface stroke-sc-line"
              strokeWidth={0.6}
              opacity={0.94}
            />
            <text
              x={label.x}
              y={label.y}
              textAnchor={label.anchor}
              fontSize={LABEL_FONT_SIZE}
              className="fill-sc-text font-medium"
            >
              {label.lines.map((line, index) => (
                <tspan
                  key={line}
                  x={label.x}
                  dy={index === 0 ? 0 : LABEL_LINE_HEIGHT}
                >
                  {line}
                </tspan>
              ))}
            </text>
          </g>
        );
      })}
    </>
  );
}

function LegendSwatch({ className }: { className: string }) {
  return <i aria-hidden className={`inline-block h-2.5 w-2.5 rounded-full ${className}`} />;
}

export type KoreaMapPanelProps = {
  kind: "places" | "route";
  /** 좌표가 확인된 촬영지만 넘긴다 */
  places: readonly MapPlace[];
  /** 라벨·동선에 쓰는 역 좌표 */
  stations: readonly MapStation[];
  /** kind="route" — 일정 rides에서 편 역 순서 (routeStationSequence) */
  routeStationIds?: readonly string[];
  /** 좌표가 없어 표시에서 제외한 장소 수 — 0이면 문구를 숨긴다 */
  omittedCount?: number;
  tr: (key: MessageKey) => string;
  /** 헤딩 우측 액션 슬롯 (3단계 "선택한 장소만 보기" 등) */
  headingAction?: ReactNode;
  /** 긴 일정을 스크롤하는 동안 지도를 붙잡아 둔다 (4단계) */
  sticky?: boolean;
  /**
   * 테마체험 권역 오버레이 자리 — 이 트랙 범위 밖(#78 P1, 별도 스레드).
   * SVG 좌표계 안에 그대로 렌더되므로 권역 원·라벨을 이 슬롯으로 넘기면 된다.
   */
  experienceOverlay?: ReactNode;
};

export function KoreaMapPanel({
  kind,
  places,
  stations,
  routeStationIds = [],
  omittedCount = 0,
  tr,
  headingAction,
  sticky = false,
  experienceOverlay,
}: KoreaMapPanelProps) {
  const isRoute = kind === "route";
  const stationById = new Map(stations.map((station) => [station.id, station]));

  const placePoints = places.map((place) => ({
    place,
    at: project(place.latitude, place.longitude),
  }));

  // 동선 — 일정 순서 그대로. 좌표를 모르는 역은 선에서 뺀다(없는 자리를 지어내지 않는다)
  const routeStations = isRoute
    ? routeStationIds.map((id) => stationById.get(id)).filter((s): s is MapStation => s !== undefined)
    : [];
  const routePath = catmullRomPath(routeStations.map((s) => project(s.latitude, s.longitude)));

  // 라벨: route는 역 이름, places는 권역(가까운 역) 이름 한 번씩
  const labelSeeds: LabelSeed[] = isRoute
    ? [...new Map(routeStations.map((s) => [s.id, s])).values()].map((station) => {
        const at = project(station.latitude, station.longitude);
        return { key: station.id, text: station.name, x: at.x, y: at.y };
      })
    : [...new Map(placePoints.map(({ place }) => [place.stationId, place.stationId])).values()]
        .map((stationId) => {
          const group = placePoints.filter(({ place }) => place.stationId === stationId);
          const station = stationById.get(stationId);
          if (!station || group.length === 0) return null;
          const x = group.reduce((sum, g) => sum + g.at.x, 0) / group.length;
          const y = group.reduce((sum, g) => sum + g.at.y, 0) / group.length;
          return { key: stationId, text: station.name, x, y };
        })
        .filter((seed): seed is LabelSeed => seed !== null);

  const labels = layoutLabels(labelSeeds);
  const hasPoints = placePoints.length > 0 || routeStations.length > 0;

  return (
    <aside
      className={`min-w-0 rounded-2xl border bg-sc-surface p-4 sm:p-[18px] ${sticky ? "md:sticky md:top-4" : ""}`}
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-2.5 gap-y-2">
        <h3 className="font-medium whitespace-nowrap">
          {tr(isRoute ? "map.routeTitle" : "map.placesTitle")}
        </h3>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <span className="text-xs text-sc-muted">{tr("map.modeBadge")}</span>
          {headingAction}
        </div>
      </div>

      {hasPoints ? (
        <svg
          viewBox={VIEW_BOX}
          role="img"
          aria-label={tr(isRoute ? "map.ariaRoute" : "map.ariaPlaces")}
          className="block w-full"
        >
          <desc>{tr(isRoute ? "map.descRoute" : "map.descPlaces")}</desc>
          <path
            d={KOREA_OUTLINE_PATH}
            fillRule="evenodd"
            className="fill-sc-blue-soft stroke-sc-line"
            strokeWidth={0.8}
            strokeLinejoin="round"
          />

          {/* 테마체험 권역 슬롯 — 경계 위, 점 아래 (시안 순서와 동일) */}
          {experienceOverlay}

          {isRoute && routePath && (
            <path
              d={routePath}
              fill="none"
              className="stroke-sc-orange"
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {placePoints.map(({ place, at }) => (
            <circle
              key={place.id}
              cx={at.x}
              cy={at.y}
              r={6}
              className="fill-sc-orange stroke-sc-surface"
              strokeWidth={place.selected ? 5 : 3}
              opacity={place.selected ? 1 : 0.28}
            >
              <title>{place.name}</title>
            </circle>
          ))}

          {isRoute &&
            [...new Map(routeStations.map((s) => [s.id, s])).values()].map((station) => {
              const at = project(station.latitude, station.longitude);
              return (
                <circle
                  key={station.id}
                  cx={at.x}
                  cy={at.y}
                  r={7}
                  className={`stroke-sc-surface ${station.isAirport ? "fill-sc-airport" : "fill-sc-blue"}`}
                  strokeWidth={3}
                >
                  <title>{station.name}</title>
                </circle>
              );
            })}

          <MapLabels labels={labels} />
        </svg>
      ) : (
        <p className="rounded-lg border bg-sc-subtle px-3 py-6 text-center text-sm text-sc-muted">
          {tr("map.noCoordinates")}
        </p>
      )}

      <div className="mt-2 flex flex-wrap gap-2.5 text-xs text-sc-muted">
        {isRoute ? (
          <>
            <span className="inline-flex items-center gap-1.5">
              <LegendSwatch className="bg-sc-airport" />
              {tr("map.legendAirport")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <LegendSwatch className="bg-sc-blue" />
              {tr("map.legendStation")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <LegendSwatch className="bg-sc-orange" />
              {tr("map.legendPlace")}
            </span>
          </>
        ) : (
          <>
            <span className="inline-flex items-center gap-1.5">
              <LegendSwatch className="bg-sc-orange" />
              {tr("map.legendPlace")}
            </span>
            <span>{tr("map.legendStationHint")}</span>
          </>
        )}
      </div>

      {/* #14 §6 — 실제 경로 계산으로 읽히지 않도록 동선 지도에는 항상 붙인다 */}
      {isRoute && <p className="mt-2 text-xs text-sc-muted">{tr("map.routeNotice")}</p>}

      {omittedCount > 0 && (
        <p className="mt-2 text-xs text-sc-orange-text">
          {tr("map.omitted").replace("{n}", String(omittedCount))}
        </p>
      )}

      <p className="mt-2 text-xs text-sc-muted">{tr("map.source")}</p>
    </aside>
  );
}

/** 4단계 지도가 읽는 일정의 최소 형태 — 엔진 타입에 직접 묶지 않는다 */
export type ItineraryDayLike = {
  rides: readonly { fromStationId: string; toStationId: string }[];
  items: readonly { placeId: string }[];
};

/**
 * 일정 → 동선 지도. 일정에서 뽑는 파생(역 순서·배치된 장소)을 여기서 끝낸다.
 *
 * 위저드에 두지 않는 이유가 하나 더 있다: 일정 배열에서 만든 Set을 위저드 본문에 남기면
 * React Compiler가 displayedDays를 변경 가능으로 보고 savedEntry의 수동 메모이제이션을
 * 버린다(react-hooks/preserve-manual-memoization). 파생을 이 경계 안에 가두면 위저드는
 * 일정을 prop으로 넘기기만 한다 — 삽입 라인도 그만큼 줄어든다.
 */
export function ItineraryRouteMap({
  days,
  places,
  stations,
  tr,
  headingAction,
  sticky,
  experienceOverlay,
}: {
  days: readonly ItineraryDayLike[];
  /** 좌표가 확인된 후보 장소 전체 — 이 안에서 일정 배치분만 걸러 쓴다 */
  places: readonly MapPlace[];
  stations: readonly MapStation[];
  tr: (key: MessageKey) => string;
  headingAction?: ReactNode;
  sticky?: boolean;
  experienceOverlay?: ReactNode;
}) {
  const routeStationIds = routeStationSequence(days.flatMap((day) => day.rides));
  const placedIds = new Set(days.flatMap((day) => day.items.map((item) => item.placeId)));
  const placed = places
    .filter((place) => placedIds.has(place.id))
    .map((place) => ({ ...place, selected: true }));

  return (
    <KoreaMapPanel
      kind="route"
      places={placed}
      stations={stations}
      routeStationIds={routeStationIds}
      omittedCount={placedIds.size - placed.length}
      tr={tr}
      headingAction={headingAction}
      sticky={sticky}
      experienceOverlay={experienceOverlay}
    />
  );
}
