/**
 * 배경 타일 공급자 어댑터.
 *
 * 좌표 계산(`map-tiles.ts`)은 표준 `z/x/y`로만 말한다. 공급자마다 URL에 이 셋을 넣는 순서와
 * 이름이 다르므로, 그 차이를 여기 한 곳에 가둔다 — 좌표 계약을 건드리지 않고 공급자를 바꾸거나
 * 순서를 고칠 수 있다 (PR #137 리뷰에서 지영님이 짚은 분리).
 *
 * VWorld WMTS는 OGC 표준을 따르면 `TileMatrix/TileRow/TileCol` = `z/y/x` 순서인데, 실제
 * REST 경로가 어느 쪽인지는 **키가 살아난 뒤 타일 한 장으로 판별**해야 한다. 그래서 순서를
 * 상수가 아니라 설정으로 둔다 — 판별되면 이 값 하나만 바꾼다.
 *
 * 키는 이 모듈 밖으로 나가지 않는다. 브라우저가 공급자를 직접 부르면 키가 클라이언트 번들에
 * 들어가므로, 호출은 서버 프록시(`app/api/map-tiles/...`)만 한다.
 *
 * ## 공급자를 고를 때 첫 번째 조건 — 좌표계
 *
 * **EPSG:3857(웹 메르카토르) 타일만 쓸 수 있다.** 우리 좌표는 구면 메르카토르이고
 * (`korea-map-projection.ts`), 3857과는 축척·평행이동만 다른 아핀 관계라 배경을 그냥 깔면
 * 맞는다. 다른 좌표계는 **진짜 재투영**이 필요해서 `<image>` 격자로는 위치가 어긋나고
 * 확대할수록 벌어진다.
 *
 * 실제로 한 번 걸렸다. 국토정보플랫폼(map.ngii.go.kr)의 `korean_map`은 **EPSG:5179**
 * (Korea 2000 통일좌표계)뿐이라 쓸 수 없었다. 축척 단계 이름(`L05`-`L18`)을 우리 줌에
 * 맞춰도 그건 이름만 맞추는 것이고 실제 축척과 위치가 따로 논다. 공급자 문서에서
 * **지원 TileMatrixSet에 EPSG:3857이 있는지부터** 보고 고른다.
 */
import "server-only";

import { env } from "./env";

/** URL에 z/x/y를 넣는 순서 */
export type TileAxisOrder = "zyx" | "zxy";

export type TileSource = {
  id: string;
  /** 화면에 반드시 표기해야 하는 출처 (이용 조건) */
  attribution: string;
  axisOrder: TileAxisOrder;
  /**
   * 공급자가 요구하는 요청 헤더 — 인증 방식이 공급자마다 다르므로 어댑터가 들고 다닌다.
   * 프록시는 이걸 그대로 얹기만 하고 어느 공급자인지 알 필요가 없다.
   */
  headers: Readonly<Record<string, string>>;
  /** 키가 없으면 null — 호출부는 배경 없이 그린다 */
  urlOf: (zoom: number, x: number, y: number) => string | null;
};

const VWORLD_BASE = "https://api.vworld.kr/req/wmts/1.0.0";
/** `Base`(일반) · `gray` · `midnight` · `Satellite` · `Hybrid` 중 일반 지도 */
const VWORLD_LAYER = "Base";

/**
 * VWorld는 등록 도메인을 `Referer`로 검사한다. 서버에서 부르면 헤더가 없으므로 등록한 값을
 * 명시해 보낸다 — 이것이 프록시를 두는 실무적 이유 하나다(브라우저 없이도 호출이 성립한다).
 *
 * **환경마다 다르다** (PR #158 리뷰 2번). 지금 인증키에 등록된 주소는 개발용
 * `http://localhost:3000/`뿐이라 그것을 기본값으로 두되, 배포에서는 반드시 그 환경의
 * 도메인을 `VWORLD_REFERER`로 준다. 값이 등록 도메인과 다르면 공급자가 거부하고 배경만
 * 조용히 빠지므로, 키만 넣으면 어디서나 된다고 오해하지 않도록 여기 적어 둔다.
 */
export const DEV_VWORLD_REFERER = "http://localhost:3000/";

export function vworldReferer(): string {
  return env.VWORLD_REFERER ?? DEV_VWORLD_REFERER;
}

/**
 * 타일 캐시 스위치 — **지금은 꺼 둔다** (2026-08-11 팀 결정).
 *
 * 캐시가 있으면 오프라인 시연이 되고 요청 수도 줄지만, VWorld 타일을 우리 디스크에 두고
 * 다시 내보내는 것이 이용 약관상 되는지 확인 전이다. 확인되면 이 값만 켜면 된다 —
 * 캐시 코드(`map-tile-cache.ts`)는 지우지 않고 남겨 둔다.
 */
export const TILE_CACHE_ENABLED = false;

/**
 * Stadia Maps `alidade_smooth` — **지금 쓰는 공급자** (#162).
 *
 * VWorld에서 옮긴 이유는 둘 다 실측이다.
 *
 * 1. **응답** — 같은 화면 12장을 받을 때 VWorld는 5장 성공에 3-29초, Stadia는 12장 전부에
 *    평균 212ms였다. VWorld 실패는 키 한도가 아니라 공급자 용량 문제(Apache 기본 503)라
 *    우리 쪽에서 손쓸 여지가 없었다.
 * 2. **밀도** — VWorld `Base`는 도로를 노랗게 칠하는 일반 지도라 우리 경로선과 같은 굵기로
 *    경쟁한다. `alidade_smooth`는 마커·오버레이가 많은 지도용으로 저채도·낮은 POI 밀도로
 *    설계된 스타일이라, 필터 없이 원본 그대로 물러난다.
 *
 * 좌표계는 EPSG:3857 표준 XYZ라 `map-tiles.ts`의 변환이 그대로 맞는다. 축 순서는 슬리피
 * 관례인 `z/x/y`로 VWorld(`z/y/x`)와 다르고, 그 차이는 `axisOrder`가 흡수한다.
 *
 * ## 인증 — 우리는 server-side application이다 (PR #164 리뷰 2번)
 *
 * 브라우저가 공급자를 직접 부르지 않고 **우리 프록시가 부른다.** Stadia 기준으로 이건
 * 브라우저 앱이 아니라 서버 앱이고, 그쪽 인증 방식은 도메인·Referer 검사가 아니라
 * **API 키**다. 그래서 키를 쿼리스트링이 아니라 `Authorization: Stadia-Auth` 헤더로 보낸다 —
 * 쿼리스트링은 서버 로그·리퍼러·중간 캐시에 그대로 남는다.
 *
 * **배포 필수값은 `STADIA_API_KEY` 하나다.** `STADIA_REFERER`는 키가 없는 로컬 개발에서만
 * 쓰는 뒷문이다(Stadia가 `localhost`는 키 없이 통과시킨다). 키 없이 배포하면 401이 오고
 * 배경만 조용히 빠진다 — 정적 지도는 그대로 남으므로 기능은 죽지 않는다.
 */
const STADIA_BASE = "https://tiles.stadiamaps.com/tiles";
const STADIA_STYLE = "alidade_smooth";

/**
 * 키 없는 로컬 개발용 `Referer`. 우리 개발 서버가 실제로 `localhost`이므로 이 값은 사실이다.
 *
 * **배포에서는 쓰지 않는다.** 키가 있으면 이 헤더를 아예 보내지 않고 `Authorization`으로
 * 인증한다 — 배포 서버가 localhost인 척할 자리가 없어진다.
 */
export const DEV_STADIA_REFERER = "http://localhost:3000/";

export function stadiaSource(axisOrder: TileAxisOrder = "zxy"): TileSource {
  const key = env.STADIA_API_KEY;
  return {
    id: `stadia:${STADIA_STYLE}:${axisOrder}`,
    attribution: "© Stadia Maps · © OpenMapTiles · © OpenStreetMap",
    axisOrder,
    // 키가 있으면 서버 인증, 없으면 로컬 뒷문 — 둘을 같이 보내지 않는다
    headers: key
      ? { Authorization: `Stadia-Auth ${key}` }
      : { Referer: env.STADIA_REFERER ?? DEV_STADIA_REFERER },
    urlOf: (zoom, x, y) => {
      const path = axisOrder === "zyx" ? `${zoom}/${y}/${x}` : `${zoom}/${x}/${y}`;
      return `${STADIA_BASE}/${STADIA_STYLE}/${path}.png`;
    },
  };
}

export function vworldSource(axisOrder: TileAxisOrder = "zyx"): TileSource {
  const key = env.VWORLD_API_KEY;
  return {
    headers: { Referer: vworldReferer() },
    /**
     * 캐시 키의 일부다 — **설정이 바뀌면 id도 바뀌어야 한다** (PR #158 리뷰 1번).
     *
     * 공급자 이름만 넣으면 축 순서나 레이어를 바꿔도 같은 `(z,x,y)`가 예전 파일을 그대로
     * 맞혀서, 배경이 어긋난 채 굳는다. 순서 판별이 끝나 값을 바꾸는 순간이 정확히 그 경우다.
     */
    id: `vworld:${VWORLD_LAYER}:${axisOrder}`,
    attribution: "공간정보 오픈플랫폼(VWorld)",
    axisOrder,
    urlOf: (zoom, x, y) => {
      if (!key) return null;
      const path = axisOrder === "zyx" ? `${zoom}/${y}/${x}` : `${zoom}/${x}/${y}`;
      return `${VWORLD_BASE}/${encodeURIComponent(key)}/${VWORLD_LAYER}/${path}.png`;
    },
  };
}

/**
 * 지금 쓰는 공급자 (#162 합의).
 *
 * VWorld 어댑터는 지우지 않고 남긴다 — 공급자를 갈아탈 자리가 여기 하나라는 것이 #137·#158
 * 추상화의 값이고, 그것을 실제로 한 번 써서 확인한 셈이다.
 */
export function activeTileSource(): TileSource {
  return stadiaSource("zxy");
}
