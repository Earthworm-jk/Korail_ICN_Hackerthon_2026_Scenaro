/**
 * 배경 타일 프록시 (#118 지도 배경).
 *
 * 브라우저는 이 경로만 부르고 공급자를 직접 부르지 않는다. 이유가 셋이다.
 *
 * 1. **키가 클라이언트로 안 나간다.** 다른 키(`OPENAI`·`TRAIN`·`AIRPORT`)와 같은 원칙이다.
 *    공개 저장소라 번들에 들어가면 누구나 꺼내 쓸 수 있다.
 * 2. **등록 도메인 검사를 서버가 맞춘다.** VWorld는 `Referer`로 검사하는데, 서버가 등록한
 *    값을 명시해 보내므로 localhost 등록 여부에 걸리지 않는다.
 * 3. **캐시할 자리가 생긴다.** 오프라인 시연이 여기서 풀린다.
 *
 * 실패를 던지지 않는다. 배경이 없다고 지도가 깨지면 안 되므로, 키가 없거나 공급자가 죽으면
 * 204(내용 없음)로 조용히 답하고 화면은 배경 없이 그대로 그린다.
 */
import { NextResponse } from "next/server";
import { MAX_TILE_ZOOM, MIN_TILE_ZOOM } from "@/lib/map-tiles";
import { readTile, writeTile } from "@/lib/map-tile-cache";
import { VWORLD_REFERER, activeTileSource } from "@/lib/map-tile-source";

/** 공급자 응답을 기다리는 한계. 배경 한 장 때문에 화면이 멎으면 안 된다 */
const UPSTREAM_TIMEOUT_MS = 6_000;

/** 브라우저·CDN 캐시 — 타일은 거의 안 바뀐다 */
const CACHE_CONTROL = "public, max-age=86400, stale-while-revalidate=604800";

function parseCoordinate(raw: string): number | null {
  if (!/^\d{1,7}$/.test(raw)) return null;
  return Number(raw);
}

/** 배경 없음 — 오류가 아니라 "이 타일은 그리지 않는다"는 뜻이다 */
function noTile(): NextResponse {
  return new NextResponse(null, { status: 204 });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ zoom: string; x: string; y: string }> },
) {
  const raw = await params;
  const zoom = parseCoordinate(raw.zoom);
  const x = parseCoordinate(raw.x);
  const y = parseCoordinate(raw.y);
  if (zoom === null || x === null || y === null) return noTile();
  if (zoom < MIN_TILE_ZOOM || zoom > MAX_TILE_ZOOM) return noTile();

  // 줌 밖 좌표를 그대로 넘기면 공급자에 없는 타일을 묻게 된다
  const count = 2 ** zoom;
  if (x >= count || y >= count) return noTile();

  const source = activeTileSource();
  const cached = await readTile(source.id, zoom, x, y);
  if (cached !== null) {
    return new NextResponse(new Uint8Array(cached), {
      headers: { "Content-Type": "image/png", "Cache-Control": CACHE_CONTROL, "X-Tile-Cache": "hit" },
    });
  }

  const url = source.urlOf(zoom, x, y);
  if (url === null) return noTile(); // 키 없음

  try {
    const upstream = await fetch(url, {
      headers: { Referer: VWORLD_REFERER },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (!upstream.ok) return noTile();

    const body = Buffer.from(await upstream.arrayBuffer());
    // 공급자는 오류도 200으로 준다 — XML 예외 본문을 타일로 캐시하면 안 된다
    const isPng = body.length > 8 && body[0] === 0x89 && body[1] === 0x50;
    if (!isPng) return noTile();

    await writeTile(source.id, zoom, x, y, body);
    return new NextResponse(new Uint8Array(body), {
      headers: { "Content-Type": "image/png", "Cache-Control": CACHE_CONTROL, "X-Tile-Cache": "miss" },
    });
  } catch {
    return noTile(); // 타임아웃·네트워크 오류
  }
}
