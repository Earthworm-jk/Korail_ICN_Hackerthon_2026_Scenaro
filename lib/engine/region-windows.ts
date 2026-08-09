/**
 * 역·권역 단위 현지 활용 가능 시간 (#33 확정 계약)
 *
 * presence 모델: 공항 출발 가능 시각부터 열차 이동 사이사이의 "역 체류 구간"을 만들고
 * KST 자정에서 분할한다. 공항역(isAirport) 체류(수속·대기)는 현지 활용이 아니므로 창을
 * 만들지 않는다 — 그 경계는 GATEWAY_ARRIVAL(공항역 출발 leg 도착)로 다음 창에 나타난다.
 * 공항철도든 추후 검증 공항버스(GatewayLeg)든 "공항에서 출발한 진입 구간의 도착"이라는
 * 같은 규칙을 쓴다.
 *
 * availableMinutes 산식(#33 코멘트 확정 — ENGINE_SPEC §7과 동일 문구):
 *   날짜별 max(0, min(endAt, 21:00 KST) - max(startAt, 09:00 KST)). 자정 분할로 창은 항상
 *   단일 날짜에 속하므로 클리핑은 날짜당 1회다. 접근시간·체류시간·dailySlackMinutes는 배치
 *   검증에 이미 사용되므로 다시 차감하지 않는다(이중 차감 금지 — startAt/endAt은 역 경계).
 *   값의 의미: "역 도착·출발 경계 안에서 서비스 기본 활동시간 기준으로 확보된 권역 창".
 *   활동 시간대는 사용자 설정이 아니라 내부 보수 기본값(#14 ver.0.4 — 속도·여유 UI 미노출).
 */
import type { RegionWindow } from "./types";

type TransitTiming = {
  fromStationId: string;
  toStationId: string;
  departAt: string;
  arriveAt: string;
};

const KOREA_OFFSET_MS = 9 * 60 * 60 * 1_000;
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** 하루 활동 가능 시간대 (KST 09:00-21:00, 내부 기본 — #33 코멘트 확정) — 심야·숙박 제외.
 *  같은 경계를 planner의 findVisitWindow 배치에도 적용해 출력 창과 실제 배치가 어긋나지 않는다 (PR #45 리뷰). */
export const DAY_ACTIVITY_START = "09:00";
export const DAY_ACTIVITY_END = "21:00";

export type StationRegionInfo = {
  id: string;
  regionId: string;
  isAirport?: boolean;
};

export function buildRegionWindows(params: {
  rides: TransitTiming[]; // 시간순 정렬 필요 (철도·GatewayLeg 포함 전체)
  airportReadyAt: string;
  airportArrivalDeadline: string;
  startStationId: string;
  stations: StationRegionInfo[];
}): RegionWindow[] {
  const stationById = new Map(params.stations.map((station) => [station.id, station]));
  const rides = [...params.rides].sort(
    (a, b) => Date.parse(a.departAt) - Date.parse(b.departAt),
  );

  // 1단계 — 역 체류 구간(분할 전): [도착, 다음 출발]
  type Presence = {
    stationId: string;
    start: number;
    end: number;
    startBoundary: RegionWindow["startBoundary"];
    endBoundary: RegionWindow["endBoundary"];
  };
  const presences: Presence[] = [];
  let cursorStation = params.startStationId;
  let cursorTime = Date.parse(params.airportReadyAt);
  let cursorStartBoundary: RegionWindow["startBoundary"] = "AIRPORT_READY";

  for (const ride of rides) {
    presences.push({
      stationId: cursorStation,
      start: cursorTime,
      end: Date.parse(ride.departAt),
      startBoundary: cursorStartBoundary,
      endBoundary: "TRAIN_DEPARTURE",
    });
    const fromAirport = stationById.get(ride.fromStationId)?.isAirport === true;
    cursorStation = ride.toStationId;
    cursorTime = Date.parse(ride.arriveAt);
    cursorStartBoundary = fromAirport ? "GATEWAY_ARRIVAL" : "TRAIN_ARRIVAL";
  }
  presences.push({
    stationId: cursorStation,
    start: cursorTime,
    end: Date.parse(params.airportArrivalDeadline),
    startBoundary: cursorStartBoundary,
    endBoundary: "AIRPORT_DEADLINE",
  });

  // 2단계 — 공항역 체류 제외, 빈 구간 제거, KST 자정 분할
  const windows: RegionWindow[] = [];
  for (const presence of presences) {
    if (stationById.get(presence.stationId)?.isAirport === true) continue;
    if (presence.end <= presence.start) continue;
    const regionId = stationById.get(presence.stationId)?.regionId ?? "";

    let segmentStart = presence.start;
    let segmentStartBoundary = presence.startBoundary;
    while (segmentStart < presence.end) {
      const nextMidnight = koreaMidnightAfter(segmentStart);
      const segmentEnd = Math.min(presence.end, nextMidnight);
      const availableMinutes = activityOverlapMinutes(segmentStart, segmentEnd);
      // PR #45 리뷰: 엔진은 "활용 가능한 창"만 반환한다 — 0분 창은 날짜 블록 잡음이므로 미출력
      if (availableMinutes > 0) {
        windows.push({
          stationId: presence.stationId,
          regionId,
          startAt: new Date(segmentStart).toISOString(),
          endAt: new Date(segmentEnd).toISOString(),
          availableMinutes,
          startBoundary: segmentStartBoundary,
          endBoundary: segmentEnd === presence.end ? presence.endBoundary : "DAY_END",
        });
      }
      segmentStart = segmentEnd;
      segmentStartBoundary = "DAY_START";
    }
  }
  return windows;
}

/**
 * 창의 성격 (#101)
 *
 * `availableMinutes`는 "역 경계 안에서 확보된 분"일 뿐 **쓸 수 있는 시간이라는 뜻이 아니다.**
 * 열차와 열차 사이의 빈 창은 환승 대기이고, 화면이 이걸 "약 54분 활용 가능"이라고만 하면
 * 사용자는 그 시간에 서울을 돌아볼 수 있다고 읽는다. 실제로는 접근시간 왕복과 엔진 버퍼
 * 때문에 아무것도 배치되지 않는다.
 */
export type RegionWindowKind =
  /** 열차 사이의 빈 창 — 환승 대기. 사용자가 확보한 시간이 아니다 */
  | "transfer_wait"
  /** 방문이 배치된 창 — 실제로 쓰고 있는 시간 */
  | "stay";

type VisitSpan = { arriveAt: string; departAt: string };

/**
 * 창 하나의 성격을 판정한다.
 *
 * 판정은 두 조건이 **모두** 맞을 때만 환승 대기다.
 * 1. 열차·공항 진입편 도착으로 시작해 열차 출발로 끝난다 (경계)
 * 2. 그 구간에 배치된 방문이 없다 (실측)
 *
 * 경계만 보면 안 된다 — 열차 사이라도 방문이 들어간 창은 쓰고 있는 시간이다.
 * 방문 유무만 봐도 안 된다 — 여행 시작·마감 경계의 빈 창은 환승이 아니다.
 *
 * #103이 도입할 "사용자가 의도적으로 확보한 자유시간"은 여기서 판정하지 않는다.
 * 그건 사용자의 편집 이력이지 창의 모양으로 알 수 있는 것이 아니다.
 */
export function classifyRegionWindow(
  window: Pick<RegionWindow, "startAt" | "endAt" | "startBoundary" | "endBoundary">,
  visits: readonly VisitSpan[],
): RegionWindowKind {
  const betweenTrains =
    (window.startBoundary === "TRAIN_ARRIVAL" || window.startBoundary === "GATEWAY_ARRIVAL")
    && window.endBoundary === "TRAIN_DEPARTURE";
  if (!betweenTrains) return "stay";

  const start = Date.parse(window.startAt);
  const end = Date.parse(window.endAt);
  const hasVisit = visits.some(
    (visit) => Date.parse(visit.arriveAt) < end && Date.parse(visit.departAt) > start,
  );
  return hasVisit ? "stay" : "transfer_wait";
}

/** 창과 그 날짜의 활동 가능 시간대(09:00-21:00 KST)의 겹침 — 산식 단일 지점 */
function activityOverlapMinutes(start: number, end: number): number {
  const date = koreaDate(start);
  const activityStart = koreaDateTime(date, DAY_ACTIVITY_START);
  const activityEnd = koreaDateTime(date, DAY_ACTIVITY_END);
  const overlap = Math.min(end, activityEnd) - Math.max(start, activityStart);
  return Math.max(0, Math.round(overlap / MINUTE_MS));
}

function koreaMidnightAfter(epoch: number): number {
  const startOfDay = koreaDateTime(koreaDate(epoch), "00:00");
  return startOfDay + DAY_MS;
}

function koreaDate(epoch: number): string {
  return new Date(epoch + KOREA_OFFSET_MS).toISOString().slice(0, 10);
}

function koreaDateTime(date: string, time: string): number {
  return Date.parse(`${date}T${time}:00+09:00`);
}
