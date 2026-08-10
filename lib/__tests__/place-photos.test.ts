import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadRepositories } from "../repositories/json";
import {
  PLACE_PHOTOS,
  REJECTED_PLACE_PHOTOS,
  placePhoto,
} from "../place-photos";

describe("TourAPI 장소 사진", () => {
  it("검증된 10곳만 정적 사진과 제1유형 출처 메타를 가진다", () => {
    const { places } = loadRepositories();
    const placesById = new Map(places.map((place) => [place.id, place]));

    expect(Object.keys(PLACE_PHOTOS)).toHaveLength(10);
    for (const [placeId, photo] of Object.entries(PLACE_PHOTOS)) {
      const place = placesById.get(placeId);
      expect(place, placeId).toBeDefined();
      expect(place?.name.ko, placeId).toBe(photo.sourcePlaceName);
      expect(photo.sourceUrl, placeId).toMatch(/^https:\/\/tong\.visitkorea\.or\.kr\//);
      expect(photo.license, placeId).toBe("공공누리 제1유형");
      expect(photo.verifiedAt, placeId).toBe("2026-08-10");
      expect(
        existsSync(join(process.cwd(), "public", photo.src.replace(/^\//, ""))),
        placeId,
      ).toBe(true);
    }
  });

  it("카드용 로컬 사진은 발표장 초기 전송량을 위해 썸네일 크기로 유지한다", () => {
    let totalBytes = 0;

    for (const [placeId, photo] of Object.entries(PLACE_PHOTOS)) {
      const bytes = statSync(
        join(process.cwd(), "public", photo.src.replace(/^\//, "")),
      ).size;
      totalBytes += bytes;
      expect(bytes, placeId).toBeLessThanOrEqual(64 * 1024);
    }

    expect(totalBytes).toBeLessThanOrEqual(500 * 1024);
  });

  it("다른 하위 시설 사진으로 확인된 두 장소는 플레이스홀더를 유지한다", () => {
    for (const placeId of Object.keys(REJECTED_PLACE_PHOTOS)) {
      expect(placePhoto(placeId), placeId).toBeNull();
    }
    expect(REJECTED_PLACE_PHOTOS["place-busan-cinema-center"]).toContain("라이브러리");
    expect(REJECTED_PLACE_PHOTOS["place-namsan-library"]).toContain("구내식당");
  });

  it("등록되지 않은 장소는 추정 사진 없이 null로 떨어진다", () => {
    expect(placePhoto("place-without-verified-photo")).toBeNull();
  });
});
