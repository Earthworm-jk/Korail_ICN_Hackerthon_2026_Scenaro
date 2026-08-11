/**
 * 배경 타일 디스크 캐시.
 *
 * 두 가지를 한 번에 푼다.
 *
 * 1. **오프라인 시연** — 시연 전에 한 번 훑어두면 발표장 인터넷이 끊겨도 배경이 뜬다.
 *    열차·항공을 오프라인 스냅샷으로 다루는 이 제품의 원칙과 같은 방식이다.
 * 2. **요청 수** — 같은 타일을 다시 부르지 않는다. 공급자 이용 정책에도 안전하다.
 *
 * 실패를 던지지 않는다. 캐시는 있으면 좋은 것이지 없으면 안 되는 것이 아니므로, 읽기·쓰기가
 * 실패하면 그냥 원본을 부른다 — 지도가 안 뜨는 것보다 느린 편이 낫다.
 */
import "server-only";

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** `.next` 밖에 둔다 — 빌드가 지워도 캐시가 남아야 오프라인 시연에 쓸 수 있다 */
const CACHE_DIR = join(process.cwd(), ".tile-cache");

/**
 * 공급자·좌표를 파일명 하나로 접는다.
 *
 * 공급자 id를 넣는 이유는 순서(zyx/zxy)나 레이어를 바꿨을 때 옛 타일이 그대로 쓰이면
 * 배경이 어긋난 채 굳기 때문이다. id가 바뀌면 캐시도 자연히 갈린다.
 */
function cacheKey(sourceId: string, zoom: number, x: number, y: number): string {
  const digest = createHash("sha256").update(`${sourceId}:${zoom}:${x}:${y}`).digest("hex");
  return `${digest.slice(0, 32)}.png`;
}

export async function readTile(
  sourceId: string, zoom: number, x: number, y: number,
): Promise<Buffer | null> {
  try {
    return await readFile(join(CACHE_DIR, cacheKey(sourceId, zoom, x, y)));
  } catch {
    return null; // 없거나 못 읽으면 원본을 부른다
  }
}

export async function writeTile(
  sourceId: string, zoom: number, x: number, y: number, body: Buffer,
): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(join(CACHE_DIR, cacheKey(sourceId, zoom, x, y)), body);
  } catch {
    // 디스크가 가득 찼거나 권한이 없어도 화면은 그대로 떠야 한다
  }
}
