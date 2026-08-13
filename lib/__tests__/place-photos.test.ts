import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadRepositories } from "../repositories/json";
import {
  PLACE_PHOTOS,
  REJECTED_PLACE_PHOTOS,
  SCENE_STILLS,
  ZONE_PHOTOS,
  photoCredit,
  placePhoto,
  zonePhoto,
} from "../place-photos";
import { loadThemeZones } from "../theme-zones-snapshot";

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

  it("다른 하위 시설 사진으로 확인된 장소는 플레이스홀더를 유지한다", () => {
    for (const placeId of Object.keys(REJECTED_PLACE_PHOTOS)) {
      expect(placePhoto(placeId), placeId).toBeNull();
    }
    expect(REJECTED_PLACE_PHOTOS["place-namsan-library"]).toContain("구내식당");
  });

  it("등록되지 않은 장소는 추정 사진 없이 null로 떨어진다", () => {
    expect(placePhoto("place-without-verified-photo")).toBeNull();
  });
});

describe("방송 장면 캡처", () => {
  it("등록된 캡처는 실제 파일과 방송사 크레딧을 가진다", () => {
    const { places } = loadRepositories();
    const placeIds = new Set(places.map((place) => place.id));

    for (const [placeId, still] of Object.entries(SCENE_STILLS)) {
      expect(placeIds.has(placeId), placeId).toBe(true);
      expect(still.src, placeId).toBe(`/place-photos/scene-${placeId}.jpg`);
      expect(still.broadcaster, placeId).toMatch(/^(tvN|SBS)$/);
      expect(
        existsSync(join(process.cwd(), "public", still.src.replace(/^\//, ""))),
        placeId,
      ).toBe(true);
      expect(
        statSync(join(process.cwd(), "public", still.src.replace(/^\//, ""))).size,
        placeId,
      ).toBeLessThanOrEqual(64 * 1024);
    }
  });

  it("같은 장소에 캡처가 있으면 관광공사 사진보다 앞선다", () => {
    const photo = placePhoto("place-gwanghwamun-gate");
    expect(photo?.kind).toBe("scene_still");
    // 관광공사 사진은 지우지 않는다 — 캡처를 내리면 그대로 되돌아간다
    expect(PLACE_PHOTOS["place-gwanghwamun-gate"]).toBeDefined();
  });

  it("장면 캡처는 화면 배지를 달지 않고 크레딧은 툴팁에만 남는다", () => {
    const photo = placePhoto("place-sinchon-mural-tunnel");
    expect(photo).not.toBeNull();
    const credit = photoCredit(photo!, "ko");
    expect(credit.badge).toBeNull();
    expect(credit.href).toBeNull();
    expect(credit.label).toContain("tvN");
    // 방송 화면에 공공누리 표기가 붙으면 사실과 다르다
    expect(credit.label).not.toContain("공공누리");
  });

  it("관광공사 사진은 배지를 뗄 수 없다 — 제1유형의 조건이 출처표시다", () => {
    const credit = photoCredit(placePhoto("place-bexco")!, "ko");
    expect(credit.badge).toBe("KTO · KOGL 1");
    expect(credit.href).toContain("tong.visitkorea.or.kr");
  });

  it("검색 대상 15곳 전부가 캡처를 갖는다", () => {
    for (const placeId of [
      "place-yeongjin-beach", "place-lala-muri", "place-woljeongsa-temple",
      "place-woljeongsa-fir-forest", "place-samyang-ranch", "place-balwangsan-cable-car",
      "place-deoksugung-stone-wall-road", "place-sinchon-mural-tunnel",
      "place-gwanghwamun-gate", "place-unhyeongung-western-house",
      "place-gyeonggijeon-shrine", "place-busan-cinema-center",
      "place-gwanghwamun-square", "place-sowol-ro", "place-forest-of-wisdom",
    ]) {
      expect(placePhoto(placeId)?.kind, placeId).toBe("scene_still");
    }
    // 벡스코는 캡처가 없어 관광공사 사진을 유지한다
    expect(placePhoto("place-bexco")?.kind).toBe("kto");
  });
});

describe("테마체험 권역 사진", () => {
  it("등록된 권역은 실제 파일과 대체 텍스트를 가진다", () => {
    const zones = loadThemeZones();
    const zoneIds = new Set((zones ?? []).map((zone) => zone.id));

    for (const [zoneId, photo] of Object.entries(ZONE_PHOTOS)) {
      expect(zoneIds.has(zoneId), zoneId).toBe(true);
      expect(photo.alt.ko.length, zoneId).toBeGreaterThan(0);
      const file = join(process.cwd(), "public", photo.src.replace(/^\//, ""));
      expect(existsSync(file), zoneId).toBe(true);
      // 팝오버 배너라 카드보다 크지만, 발표장 전송량 상한은 둔다
      expect(statSync(file).size, zoneId).toBeLessThanOrEqual(96 * 1024);
    }
  });

  it("등록되지 않은 권역은 사진 없이 null로 떨어진다", () => {
    expect(zonePhoto("zone-seoul-bukchon-hanok")).toBeNull();
  });
});
