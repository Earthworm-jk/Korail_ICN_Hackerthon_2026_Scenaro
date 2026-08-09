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
 * - 철도 구간은 실제 선로 선형으로 그린다(OSM 스냅샷). 팀 결정: #14 §6이 막은 것은 우리가
 *   서비스하지 않는 버스·택시·도보 경로를 계산한 것처럼 보이게 하는 표현이다.
 * - 그 밖의 구간(공항버스 등)은 권역이 이어지는 순서를 보여주는 보조 곡선이다. 실제 도로·경로처럼
 *   보이지 않도록 역 지점만 잇고, 지도 옆에 그 사실을 항상 문구로 붙인다.
 * - 라벨은 역(권역) 단위다. 시안은 데모용 2-4개를 손으로 배치했지만 실제 시드는 촬영지가
 *   서로 1px 미만까지 겹친다(월정사-전나무 숲길 0.25px). 장소마다 라벨을 달면 읽을 수 없어
 *   역 허브 모델(역 단위 체류)에 맞춰 권역 라벨로 바꿨다 — PR 본문 잔차 표에 기록.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { catmullRomPath, polylinePath, project } from "@/lib/korea-map-projection";
import {
  BASE_VIEWPORT,
  MAX_SCALE,
  MIN_SCALE,
  ZOOM_STEP,
  boundsOf,
  fitTo,
  isZoomed,
  panBy,
  pointFromClient,
  scaleOf,
  screenUnit,
  viewBoxOf,
  wheelZoomFactor,
  zoomAt,
  zoomByStep,
  type Viewport,
} from "@/lib/map-viewport";
import { KOREA_OUTLINE_PATH } from "@/lib/korea-outline";
import {
  railRouteSegments,
  routePairKey,
  routeStationSequence,
  type RailLineGeometry,
} from "@/lib/map-route";
import { layoutLabels, type LabelSeed, type PlacedLabel } from "@/lib/map-labels";
import type { Locale, MessageKey } from "@/lib/i18n/messages";

/**
 * 오버레이 라벨 키 앞에 붙이는 표식.
 * 역 라벨과 같은 배치기를 쓰되 그리기만 구분한다 — 권역 이름이 역 이름처럼 보이면 안 된다.
 */
const OVERLAY_LABEL_PREFIX = "overlay:";
/** 권역 표식(점선 고리)의 반지름 — theme-experience.tsx가 그리는 값과 같아야 라벨이 고리를 피한다 */
const OVERLAY_MARKER_RADIUS = 10;
/** 역·공항 점의 반지름 (아래 circle과 같은 값) */
const STATION_MARKER_RADIUS = 7;
/** 촬영지 점의 반지름 */
const PLACE_MARKER_RADIUS = 6;

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

/** `unit` — 화면에서의 크기를 배율과 무관하게 유지하려고 곱하는 값 (map-viewport의 screenUnit) */
function MapLabels({ labels, unit }: { labels: readonly PlacedLabel[]; unit: number }) {
  return (
    <>
      {labels.map((label) => {
        // 지시선은 라벨이 실제로 밀렸을 때만 — 붙어 있으면 선이 오히려 지저분하다.
        // 확대한 창에서는 긴 이름이 창 안으로 밀려 들어가며 가로로도 떠난다 (map-labels 참고)
        const moved =
          Math.abs(label.y - label.from.y) > 2 * unit || Math.abs(label.x - label.from.x) > 12 * unit;
        const overlay = label.key.startsWith(OVERLAY_LABEL_PREFIX);
        return (
          <g key={label.key}>
            {moved && (
              <line
                x1={label.from.x}
                y1={label.from.y}
                x2={label.x + (label.anchor === "start" ? -2 : 2) * unit}
                y2={label.y - 3 * unit}
                className="stroke-sc-line"
                strokeWidth={0.8 * unit}
              />
            )}
            {/* 알약 배경 — 해안선·동선 위에 글씨가 얹히면 읽히지 않는다 (발표자료 라벨 방식).
                오버레이(권역) 이름은 점선 원과 같은 색·같은 파선으로 묶어 역 이름과 구분한다 */}
            <rect
              x={label.left - 3.5 * unit}
              y={label.top}
              width={label.right - label.left + 7 * unit}
              height={label.bottom - label.top}
              rx={4 * unit}
              className={overlay ? "fill-sc-surface stroke-sc-blue" : "fill-sc-surface stroke-sc-line"}
              strokeWidth={overlay ? 0.9 * unit : 0.6 * unit}
              strokeDasharray={overlay ? `${3 * unit} ${2 * unit}` : undefined}
              opacity={0.94}
            />
            <text
              x={label.x}
              y={label.y}
              textAnchor={label.anchor}
              fontSize={label.fontSize}
              className={overlay ? "fill-sc-blue-text font-medium" : "fill-sc-text font-medium"}
            >
              {label.lines.map((line, index) => (
                <tspan
                  key={line}
                  x={label.x}
                  dy={index === 0 ? 0 : label.lineHeight}
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

/**
 * 지도 창 상태를 오버레이 슬롯과 나누는 통로.
 *
 * `experienceOverlay`는 이미 그려진 ReactNode로 들어오기 때문에 지도가 그 안의 좌표도 이름도
 * 알 수 없다. prop을 더 만들면 지도를 부르는 화면(planner-wizard)까지 고쳐야 하는데, 그 파일은
 * 다른 작업이 통째로 다시 쓰는 중이다. 오버레이가 스스로 알리게 해서 두 파일 안에서 끝낸다.
 */

/** 오버레이가 지도에 등록하는 항목 — 지점과, 지도에 적을 이름 */
export type MapOverlayEntry = { point: { x: number; y: number }; label?: string };

type MapViewContextValue = {
  /** 화면에서 같은 크기를 유지하려면 곱할 값 — 오버레이도 이걸 써야 확대 시 원이 커지지 않는다 */
  unit: number;
  /**
   * 표시 언어. 지도는 `tr`만 받아서 자기 문구는 번역할 수 있지만, 오버레이가 얹는 이름은
   * 데이터(권역명 등)라 언어를 골라야 한다. 지도를 부르는 화면을 고치지 않고 전하는 통로다.
   */
  locale: Locale;
  /** 오버레이 항목 등록 — key마다 하나. null이면 해제 */
  setOverlayEntry: (key: string, entry: MapOverlayEntry | null) => void;
};

const MapViewContext = createContext<MapViewContextValue>({
  unit: 1,
  locale: "ko",
  setOverlayEntry: () => {},
});

/** 오버레이가 현재 배율과 언어를 읽는다 */
export function useMapView(): Pick<MapViewContextValue, "unit" | "locale"> {
  const { unit, locale } = useContext(MapViewContext);
  return { unit, locale };
}

/**
 * 오버레이가 자기 항목을 지도에 등록한다 — 켜지면 등록된 항목이 다 보이도록 창을 맞추고
 * 이름을 지도에 얹으며, 끄면 전체 보기로 돌아온다.
 *
 * 좌표·이름 객체는 렌더마다 새로 생기므로 값으로 비교해 같은 항목에 반복 등록이 가지 않게 한다.
 */
export function useMapOverlayEntry(key: string, entry: MapOverlayEntry | null): void {
  const { setOverlayEntry } = useContext(MapViewContext);
  const encoded = entry ? JSON.stringify(entry) : "";

  useEffect(() => {
    if (!encoded) {
      setOverlayEntry(key, null);
      return;
    }
    setOverlayEntry(key, JSON.parse(encoded) as MapOverlayEntry);
    return () => setOverlayEntry(key, null);
  }, [key, encoded, setOverlayEntry]);
}

function ZoomControls({
  view,
  onZoom,
  onReset,
  tr,
}: {
  view: Viewport;
  onZoom: (factor: number) => void;
  onReset: () => void;
  tr: (key: MessageKey) => string;
}) {
  const scale = scaleOf(view);
  const button =
    "flex size-7 items-center justify-center rounded-md border bg-sc-surface text-sm leading-none text-sc-muted hover:border-sc-blue hover:text-sc-blue disabled:opacity-40 disabled:hover:border-inherit disabled:hover:text-sc-muted";

  /*
   * 지도 위가 아니라 제목 줄에 둔다. 확대·팬을 하면 라벨이 창 어디로든 오기 때문에 지도 위
   * 어느 모서리에 놓아도 역 이름을 가리는 자리가 생긴다 — 실제로 오른쪽 위에서는 강원 권역
   * 라벨을, 오른쪽 아래에서는 부산역 라벨을 덮었다.
   */
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        className={button}
        aria-label={tr("map.zoomIn")}
        disabled={scale >= MAX_SCALE - 1e-9}
        onClick={() => onZoom(ZOOM_STEP)}
      >
        +
      </button>
      <button
        type="button"
        className={button}
        aria-label={tr("map.zoomOut")}
        disabled={scale <= MIN_SCALE + 1e-9}
        onClick={() => onZoom(1 / ZOOM_STEP)}
      >
        −
      </button>
      <button
        type="button"
        className={`${button} text-[10px]`}
        aria-label={tr("map.resetView")}
        disabled={!isZoomed(view)}
        onClick={onReset}
      >
        ⟲
      </button>
    </div>
  );
}

export type KoreaMapPanelProps = {
  kind: "places" | "route";
  /** 좌표가 확인된 촬영지만 넘긴다 */
  places: readonly MapPlace[];
  /** 라벨·동선에 쓰는 역 좌표 */
  stations: readonly MapStation[];
  /** kind="route" — 일정 rides에서 편 역 순서 (routeStationSequence) */
  routeStationIds?: readonly string[];
  /** 실제 선로 선형 축 (data/rail-geometry.json). 비면 동선 전체가 기존 곡선으로 그려진다 */
  railLines?: readonly RailLineGeometry[];
  /** 도로 수단으로 이동하는 구간 키 (routePairKey) — 축에 있어도 선로로 그리지 않는다 */
  roadPairKeys?: ReadonlySet<string>;
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
  /** 테마체험 대표 지점이 지도에 표시 중일 때만 붙는 범례 항목 */
  experienceLegend?: ReactNode;
  /** 대표 지점 표시 중일 때 지도 아래 붙는 안내 — 원을 권역 경계로 읽지 않도록 */
  experienceNotice?: ReactNode;
};

export function KoreaMapPanel({
  kind,
  places,
  stations,
  routeStationIds = [],
  railLines = [],
  roadPairKeys,
  omittedCount = 0,
  tr,
  headingAction,
  sticky = false,
  experienceOverlay,
  experienceLegend,
  experienceNotice,
}: KoreaMapPanelProps) {
  const isRoute = kind === "route";
  const stationById = new Map(stations.map((station) => [station.id, station]));

  // 보이는 창. 좌표계(360×430)는 그대로고 이 값만 움직인다
  const [view, setView] = useState<Viewport>(BASE_VIEWPORT);
  const svgRef = useRef<SVGSVGElement | null>(null);
  /** 화면에 닿아 있는 포인터 — 2개면 핀치 */
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchDistanceRef = useRef(0);
  /** 이벤트 핸들러가 최신 창을 읽는 통로 — 휠은 갱신을 기다리지 않고 지금 판단해야 한다 */
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);
  const unit = screenUnit(view);

  /**
   * 오버레이(테마체험 필터) 항목 등록부.
   *
   * 등록되면 항목이 다 보이도록 창을 맞추고, 이름은 역 라벨과 같은 배치기를 태운다 —
   * 필터를 켰는데 이름 없는 원만 뜨면 무엇이 켜졌는지 알 수 없다. 등록이 없는 화면(대부분)은
   * 아무 일도 없어야 하므로 "맞춘 적이 있는지"를 따로 들고 있는다.
   */
  const overlayRef = useRef(new Map<string, MapOverlayEntry>());
  const fittedRef = useRef(false);
  const [overlaySeeds, setOverlaySeeds] = useState<LabelSeed[]>([]);

  const setOverlayEntry = useCallback((key: string, entry: MapOverlayEntry | null) => {
    const entries = overlayRef.current;
    if (entry) entries.set(key, entry);
    else entries.delete(key);

    setOverlaySeeds(
      [...entries].flatMap(([id, item]) =>
        item.label
          ? [
              {
                key: `${OVERLAY_LABEL_PREFIX}${id}`,
                text: item.label,
                x: item.point.x,
                y: item.point.y,
                radius: OVERLAY_MARKER_RADIUS,
              },
            ]
          : [],
      ),
    );

    const points = [...entries.values()].map((item) => item.point);
    if (points.length > 0) {
      fittedRef.current = true;
      setView(fitTo(points));
    } else if (fittedRef.current) {
      fittedRef.current = false;
      setView(BASE_VIEWPORT);
    }
  }, []);

  const locale: Locale = tr("app.locale") === "en" ? "en" : "ko";
  const mapView = useMemo<MapViewContextValue>(
    () => ({ unit, locale, setOverlayEntry }),
    [unit, locale, setOverlayEntry],
  );

  /**
   * 휠 확대·축소.
   *
   * React의 onWheel은 passive로 붙어 preventDefault가 듣지 않으므로 직접 건다.
   * 축소 한계에서 더 축소하려는 휠은 막지 않고 페이지로 흘려보낸다 — 그러지 않으면 세로로 긴
   * 지도가 페이지 스크롤을 통째로 삼킨다. 확대해 둔 지도는 배율 1로 돌아온 뒤부터 다시 스크롤된다.
   */
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const onWheel = (event: WheelEvent) => {
      // 배율 변화는 이벤트 횟수가 아니라 이동량에 비례한다 (map-viewport의 wheelZoomFactor)
      const factor = wheelZoomFactor(event.deltaY, event.deltaMode);
      // 판단은 setView 밖에서 한다. 갱신 함수는 나중에 실행될 수 있어서 그 안에서 결정하면
      // preventDefault를 부를 시점을 놓치고 확대와 페이지 스크롤이 동시에 일어난다
      const scale = scaleOf(viewRef.current);
      // 더 이상 창이 바뀌지 않는 방향의 휠은 삼키지 않고 페이지 스크롤로 넘긴다 (PR #111 리뷰).
      // 세로로 긴 지도가 양 끝 배율에서 페이지 스크롤을 가두는 것을 막는다
      const stuck =
        factor === 1 ||
        (factor > 1 && scale >= MAX_SCALE - 1e-9) ||
        (factor < 1 && scale <= MIN_SCALE + 1e-9);
      if (stuck) return;

      event.preventDefault();
      const rect = svg.getBoundingClientRect();
      setView((current) =>
        zoomAt(current, factor, pointFromClient(current, rect, event.clientX, event.clientY)),
      );
    };

    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  const zoomBy = useCallback((factor: number) => setView((v) => zoomByStep(v, factor)), []);
  const resetView = useCallback(() => setView(BASE_VIEWPORT), []);

  const handlePointerDown = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const pointers = pointersRef.current;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture(event.pointerId);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchDistanceRef.current = Math.hypot(a.x - b.x, a.y - b.y);
    }
  }, []);

  const handlePointerMove = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    const pointers = pointersRef.current;
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;

    // 두 손가락 — 벌린 만큼 확대, 중심은 두 손가락 사이
    if (pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const before = pinchDistanceRef.current || distance;
      pinchDistanceRef.current = distance;
      if (before <= 0 || distance <= 0) return;
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      setView((v) => zoomAt(v, distance / before, pointFromClient(v, rect, midX, midY)));
      return;
    }

    // 한 손가락·마우스 드래그 — 화면 이동량을 표시 단위로 환산해 그대로 옮긴다
    const dx = event.clientX - previous.x;
    const dy = event.clientY - previous.y;
    setView((v) => panBy(v, (dx / rect.width) * v.width, (dy / rect.height) * v.height));
  }, []);

  const handlePointerEnd = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) pinchDistanceRef.current = 0;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  /** 키보드 — 드래그·휠만 두면 포인터 없이 쓰는 사용자에게 지도가 고정된 그림이 된다 */
  const handleKeyDown = useCallback((event: ReactKeyboardEvent<SVGSVGElement>) => {
    const step = 0.2; // 창의 20%씩
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [1, 0],
      ArrowRight: [-1, 0],
      ArrowUp: [0, 1],
      ArrowDown: [0, -1],
    };
    if (event.key === "+" || event.key === "=") setView((v) => zoomByStep(v, ZOOM_STEP));
    else if (event.key === "-" || event.key === "_") setView((v) => zoomByStep(v, 1 / ZOOM_STEP));
    else if (event.key === "0") setView(BASE_VIEWPORT);
    else if (moves[event.key]) {
      const [mx, my] = moves[event.key];
      setView((v) => panBy(v, mx * v.width * step, my * v.height * step));
    } else return;
    event.preventDefault();
  }, []);

  const placePoints = places.map((place) => ({
    place,
    at: project(place.latitude, place.longitude),
  }));

  // 동선 — 일정 순서 그대로. 좌표를 모르는 역은 선에서 뺀다(없는 자리를 지어내지 않는다)
  const routeStations = isRoute
    ? routeStationIds.map((id) => stationById.get(id)).filter((s): s is MapStation => s !== undefined)
    : [];
  // 철도 구간은 실선형, 나머지는 기존 곡선. 축을 못 찾아도 선이 사라지지 않게 폴백이 남는다
  const routeSegments = railRouteSegments(
    routeStations.map((station) => station.id),
    railLines,
    roadPairKeys,
  );
  const routePaths = routeSegments.map((segment, index) => ({
    key: `${segment.kind}-${index}`,
    d:
      segment.kind === "rail"
        ? polylinePath(segment.points)
        : catmullRomPath(
            segment.stationIds
              .map((id) => stationById.get(id))
              .filter((station): station is MapStation => station !== undefined)
              .map((station) => project(station.latitude, station.longitude)),
          ),
  }));
  // ODbL 1.0 — OSM 선형을 실제로 그린 화면에서만 출처를 띄운다
  const hasRailGeometry = routeSegments.some((segment) => segment.kind === "rail");

  // 라벨: route는 역 이름, places는 권역(가까운 역) 이름 한 번씩
  const labelSeeds: LabelSeed[] = isRoute
    ? [...new Map(routeStations.map((s) => [s.id, s])).values()].map((station) => {
        const at = project(station.latitude, station.longitude);
        return { key: station.id, text: station.name, x: at.x, y: at.y, radius: STATION_MARKER_RADIUS };
      })
    : [...new Map(placePoints.map(({ place }) => [place.stationId, place.stationId])).values()]
        .map((stationId): LabelSeed | null => {
          const group = placePoints.filter(({ place }) => place.stationId === stationId);
          const station = stationById.get(stationId);
          if (!station || group.length === 0) return null;
          const x = group.reduce((sum, g) => sum + g.at.x, 0) / group.length;
          const y = group.reduce((sum, g) => sum + g.at.y, 0) / group.length;
          return { key: stationId, text: station.name, x, y, radius: PLACE_MARKER_RADIUS };
        })
        .filter((seed): seed is LabelSeed => seed !== null);

  /**
   * 배치는 현재 창과 배율로 다시 계산한다.
   *
   * 창 밖 지점은 시드에서 뺀다 — 확대하면 화면 밖 역들이 경계에 라벨을 쌓아 보이는 지점의
   * 자리를 빼앗는다. 화면에 없는 점의 이름은 어차피 읽을 수 없다.
   */
  const bounds = boundsOf(view);
  const labels = layoutLabels(
    [...labelSeeds, ...overlaySeeds].filter(
      (seed) =>
        seed.x >= bounds.left && seed.x <= bounds.right && seed.y >= bounds.top && seed.y <= bounds.bottom,
    ),
    { bounds, scale: scaleOf(view) },
  );
  const hasPoints = placePoints.length > 0 || routeStations.length > 0;
  const zoomed = isZoomed(view);
  const hintId = `map-zoom-hint-${kind}`;

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
          {hasPoints && <ZoomControls view={view} onZoom={zoomBy} onReset={resetView} tr={tr} />}
        </div>
      </div>

      {hasPoints ? (
        <div>
        {/* 조작 방법은 화면에 또 한 줄을 늘리지 않고 지도 설명으로만 붙인다 —
            지도 아래에는 이미 출처·주의 문구가 여러 줄 있다 */}
        <span id={hintId} className="sr-only">{tr("map.zoomHint")}</span>
        <MapViewContext value={mapView}>
        <svg
          ref={svgRef}
          viewBox={viewBoxOf(view)}
          role="img"
          aria-label={tr(isRoute ? "map.ariaRoute" : "map.ariaPlaces")}
          aria-describedby={hintId}
          tabIndex={0}
          onKeyDown={handleKeyDown}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
          /**
           * 확대 전에는 세로 스와이프를 페이지에 양보한다 (pan-y). 4단계 지도는 sticky라
           * 화면을 거의 채우는데, 처음부터 손가락을 다 가져가면 그 위에서는 페이지가 스크롤되지
           * 않는다. 확대한 뒤에는 지도를 끄는 게 목적이므로 제스처를 전부 받는다.
           */
          style={{ touchAction: zoomed ? "none" : "pan-y" }}
          className={`block w-full focus-visible:outline-2 focus-visible:outline-sc-blue ${zoomed ? "cursor-grab active:cursor-grabbing" : ""}`}
        >
          <desc>{tr(isRoute ? "map.descRoute" : "map.descPlaces")}</desc>
          <path
            d={KOREA_OUTLINE_PATH}
            fillRule="evenodd"
            className="fill-sc-blue-soft stroke-sc-line"
            strokeWidth={0.8 * unit}
            strokeLinejoin="round"
          />

          {isRoute &&
            routePaths.map(({ key, d }) =>
              d ? (
                <path
                  key={key}
                  d={d}
                  fill="none"
                  className="stroke-sc-orange"
                  strokeWidth={3 * unit}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ) : null,
            )}

          {placePoints.map(({ place, at }) => (
            <circle
              key={place.id}
              cx={at.x}
              cy={at.y}
              r={6 * unit}
              className="fill-sc-orange stroke-sc-surface"
              strokeWidth={(place.selected ? 5 : 3) * unit}
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
                  r={7 * unit}
                  className={`stroke-sc-surface ${station.isAirport ? "fill-sc-airport" : "fill-sc-blue"}`}
                  strokeWidth={3 * unit}
                >
                  <title>{station.name}</title>
                </circle>
              );
            })}

          <MapLabels labels={labels} unit={unit} />

          {/*
            테마체험 권역 슬롯 — 맨 위에 그린다.
            시안은 점 아래였다. 그 자리에 두면 지금 데이터에서는 보이지 않는다: 검수된 대표 지점이
            역과 1km 안팎이라(정동·덕수궁 대표 지점과 서울역은 확대해도 표시 좌표로 0.4 차이) 역
            점에 덮이고, 그 위를 다시 라벨 알약이 덮는다. 필터가 켜서 보여주려는 대상이 가려지면
            필터를 켠 의미가 없다. 채움은 15% 투명이라 밑의 점·글자를 지우지 않는다.
          */}
          {experienceOverlay}
        </svg>
        </MapViewContext>
        </div>
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
            {experienceLegend}
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

      {/* #14 §6 — 실제 경로 계산으로 읽히지 않도록 동선 지도에는 항상 붙인다.
          선로를 실제로 그린 화면에서는 어디까지가 실선형인지도 함께 밝힌다 */}
      {isRoute && (
        <p className="mt-2 text-xs text-sc-muted">
          {tr(hasRailGeometry ? "map.routeNoticeRail" : "map.routeNotice")}
        </p>
      )}
      {experienceNotice}

      {omittedCount > 0 && (
        <p className="mt-2 text-xs text-sc-orange-text">
          {tr("map.omitted").replace("{n}", String(omittedCount))}
        </p>
      )}

      <p className="mt-2 text-xs text-sc-muted">
        {tr("map.source")}
        {/* ODbL 1.0 의무 표기 — 라이선스 링크까지 함께 (OSM 저작권 안내 규정) */}
        {hasRailGeometry && (
          <>
            {" · "}
            <a
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2 hover:text-sc-blue"
            >
              {tr("map.sourceRail")}
            </a>
          </>
        )}
      </p>
    </aside>
  );
}

/** 4단계 지도가 읽는 일정의 최소 형태 — 엔진 타입에 직접 묶지 않는다 */
export type ItineraryDayLike = {
  rides: readonly { fromStationId: string; toStationId: string; departAt: string }[];
  gatewayLegs?: readonly { fromStationId: string; toStationId: string; departAt: string }[];
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
  railLines,
  tr,
  headingAction,
  sticky,
  experienceOverlay,
  experienceLegend,
  experienceNotice,
}: {
  days: readonly ItineraryDayLike[];
  /** 좌표가 확인된 후보 장소 전체 — 이 안에서 일정 배치분만 걸러 쓴다 */
  places: readonly MapPlace[];
  stations: readonly MapStation[];
  /** 실제 선로 선형 축 — 없으면 동선 전체가 기존 곡선으로 그려진다 */
  railLines?: readonly RailLineGeometry[];
  tr: (key: MessageKey) => string;
  headingAction?: ReactNode;
  sticky?: boolean;
  experienceOverlay?: ReactNode;
  experienceLegend?: ReactNode;
  experienceNotice?: ReactNode;
}) {
  // #58 통합: 공항버스 대안을 선택한 일정도 화면 타임라인과 같은 순서로 그린다.
  // GatewayLeg를 빼면 지도 동선만 공항 구간이 사라져 일정과 모순된다.
  const routeStationIds = routeStationSequence(days.flatMap((day) => [
    ...(day.gatewayLegs ?? []),
    ...day.rides,
  ].sort((a, b) => Date.parse(a.departAt) - Date.parse(b.departAt))));
  // GatewayLeg는 공항버스 — 도로 수단이다. 같은 OD를 지나는 선로 축이 생기더라도
  // 버스 이동을 선로 위에 얹지 않는다 (#14 §6은 도로 수단에 그대로 적용된다)
  const roadPairKeys = new Set(
    days.flatMap((day) =>
      (day.gatewayLegs ?? []).map((leg) => routePairKey(leg.fromStationId, leg.toStationId)),
    ),
  );
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
      railLines={railLines}
      roadPairKeys={roadPairKeys}
      omittedCount={placedIds.size - placed.length}
      tr={tr}
      headingAction={headingAction}
      sticky={sticky}
      experienceOverlay={experienceOverlay}
      experienceLegend={experienceLegend}
      experienceNotice={experienceNotice}
    />
  );
}
