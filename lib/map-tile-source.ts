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
  /** 키가 없으면 null — 호출부는 배경 없이 그린다 */
  urlOf: (zoom: number, x: number, y: number) => string | null;
};

const VWORLD_BASE = "https://api.vworld.kr/req/wmts/1.0.0";
/** `Base`(일반) · `gray` · `midnight` · `Satellite` · `Hybrid` 중 일반 지도 */
const VWORLD_LAYER = "Base";

/**
 * VWorld는 등록 도메인을 `Referer`로 검사한다. 서버에서 부르면 헤더가 없으므로 등록한 값을
 * 명시해 보낸다 — 이것이 프록시를 두는 실무적 이유 하나다(브라우저 없이도 호출이 성립한다).
 */
export const VWORLD_REFERER = "http://localhost:3000/";

export function vworldSource(axisOrder: TileAxisOrder = "zyx"): TileSource {
  const key = env.VWORLD_API_KEY;
  return {
    id: "vworld",
    attribution: "국토교통부 국토지리정보원 VWorld",
    axisOrder,
    urlOf: (zoom, x, y) => {
      if (!key) return null;
      const path = axisOrder === "zyx" ? `${zoom}/${y}/${x}` : `${zoom}/${x}/${y}`;
      return `${VWORLD_BASE}/${encodeURIComponent(key)}/${VWORLD_LAYER}/${path}.png`;
    },
  };
}

/** 지금 쓰는 공급자. 순서 판별이 끝나면 여기 인자만 바꾼다 */
export function activeTileSource(): TileSource {
  return vworldSource("zyx");
}
