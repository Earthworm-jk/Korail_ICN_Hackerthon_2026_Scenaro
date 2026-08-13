/**
 * 카드 사진은 출처 성격이 두 가지고, **둘을 같은 타입으로 묶으면 안 된다**.
 *
 * 한국관광공사 사진은 공공누리 제1유형이라 출처만 표시하면 자유롭게 쓰지만,
 * 방송 장면 캡처는 방송사 저작물이다. 예전 타입은 `provider`·`license`가
 * `"한국관광공사 TourAPI"`·`"공공누리 제1유형"` 리터럴로 고정돼 있어서, 여기에
 * 장면 캡처를 끼워 넣으면 **방송 화면에 공공누리 딱지가 붙는다.** 그건 사실과
 * 다른 표기다. 그래서 `kind`로 가르고, 크레딧 문구도 각자 갖는다.
 */
export type KtoPlacePhoto = {
  kind: "kto";
  src: string;
  alt: { ko: string; en: string };
  provider: "한국관광공사 TourAPI";
  sourcePlaceName: string;
  sourceUrl: string;
  license: "공공누리 제1유형";
  licenseUrl: "https://www.kogl.or.kr/info/licenseType1.do";
  verifiedAt: "2026-08-10";
  verificationMethod: "TourAPI 이름·좌표 대조 후 이미지 육안 확인";
};

/**
 * 방송 장면 캡처. 저작권은 방송사에 있고 우리가 링크할 원본 URL도 없다 —
 * 출처는 방송분 자체이므로 `sourceUrl` 대신 방송사·작품·회차를 크레딧으로 쓴다.
 */
export type SceneStillPhoto = {
  kind: "scene_still";
  src: string;
  alt: { ko: string; en: string };
  broadcaster: string;
  workTitle: { ko: string; en: string };
  episodeLabel: string | null;
  rights: "방송사 저작물 — 시연용 인용";
  verifiedAt: "2026-08-14";
  verificationMethod: "캡처 화면 육안 확인 — 장소·작품 대조";
};

export type PlacePhoto = KtoPlacePhoto | SceneStillPhoto;

/**
 * 정확한 장소 자체가 확인되고 공공누리 제1유형으로 제공된 사진만 등록한다.
 * 등록되지 않은 장소는 추정 사진 대신 공통 플레이스홀더를 유지한다.
 */
export const PLACE_PHOTOS = {
  "place-woljeongsa-temple": {
    src: "/place-photos/place-woljeongsa-temple.jpg",
    alt: { ko: "월정사의 전각과 석등", en: "Temple halls and a stone lantern at Woljeongsa" },
    provider: "한국관광공사 TourAPI",
    sourcePlaceName: "월정사",
    sourceUrl: "https://tong.visitkorea.or.kr/cms/resource/54/3304054_image2_1.jpg",
    license: "공공누리 제1유형",
    licenseUrl: "https://www.kogl.or.kr/info/licenseType1.do",
    verifiedAt: "2026-08-10",
    verificationMethod: "TourAPI 이름·좌표 대조 후 이미지 육안 확인",
  },
  "place-deoksugung-stone-wall-road": {
    src: "/place-photos/place-deoksugung-stone-wall-road.jpg",
    alt: { ko: "가을의 덕수궁 돌담길", en: "Deoksugung Stone Wall Road in autumn" },
    provider: "한국관광공사 TourAPI",
    sourcePlaceName: "덕수궁 돌담길",
    sourceUrl: "https://tong.visitkorea.or.kr/cms/resource/50/2658350_image2_1.jpg",
    license: "공공누리 제1유형",
    licenseUrl: "https://www.kogl.or.kr/info/licenseType1.do",
    verifiedAt: "2026-08-10",
    verificationMethod: "TourAPI 이름·좌표 대조 후 이미지 육안 확인",
  },
  "place-gyeonggijeon-shrine": {
    src: "/place-photos/place-gyeonggijeon-shrine.jpg",
    alt: { ko: "대나무 사이로 보이는 경기전의 문", en: "A gate at Gyeonggijeon framed by bamboo" },
    provider: "한국관광공사 TourAPI",
    sourcePlaceName: "경기전",
    sourceUrl: "https://tong.visitkorea.or.kr/cms/resource_photo/45/3365745_image2_1.jpg",
    license: "공공누리 제1유형",
    licenseUrl: "https://www.kogl.or.kr/info/licenseType1.do",
    verifiedAt: "2026-08-10",
    verificationMethod: "TourAPI 이름·좌표 대조 후 이미지 육안 확인",
  },
  "place-bexco": {
    src: "/place-photos/place-bexco.jpg",
    alt: { ko: "벡스코 전시장 외관", en: "Exterior of the BEXCO convention center" },
    provider: "한국관광공사 TourAPI",
    sourcePlaceName: "벡스코",
    sourceUrl: "https://tong.visitkorea.or.kr/cms/resource/45/4092545_image2_1.jpg",
    license: "공공누리 제1유형",
    licenseUrl: "https://www.kogl.or.kr/info/licenseType1.do",
    verifiedAt: "2026-08-10",
    verificationMethod: "TourAPI 이름·좌표 대조 후 이미지 육안 확인",
  },
  "place-simgok-port": {
    src: "/place-photos/place-simgok-port.jpg",
    alt: { ko: "심곡항의 붉은 등대와 방파제", en: "Red lighthouse and breakwater at Simgok Port" },
    provider: "한국관광공사 TourAPI",
    sourcePlaceName: "심곡항",
    sourceUrl: "https://tong.visitkorea.or.kr/cms/resource/88/3383888_image2_1.JPG",
    license: "공공누리 제1유형",
    licenseUrl: "https://www.kogl.or.kr/info/licenseType1.do",
    verifiedAt: "2026-08-10",
    verificationMethod: "TourAPI 이름·좌표 대조 후 이미지 육안 확인",
  },
  "place-gwanghalluwon-garden": {
    src: "/place-photos/place-gwanghalluwon-garden.jpg",
    alt: { ko: "연못 위의 광한루", en: "Gwanghallu pavilion reflected in its pond" },
    provider: "한국관광공사 TourAPI",
    sourcePlaceName: "광한루원",
    sourceUrl: "https://tong.visitkorea.or.kr/cms/resource/15/4060015_image2_1.jpg",
    license: "공공누리 제1유형",
    licenseUrl: "https://www.kogl.or.kr/info/licenseType1.do",
    verifiedAt: "2026-08-10",
    verificationMethod: "TourAPI 이름·좌표 대조 후 이미지 육안 확인",
  },
  "place-gwanghwamun-gate": {
    src: "/place-photos/place-gwanghwamun-gate.jpg",
    alt: { ko: "높은 곳에서 바라본 광화문", en: "Elevated view of Gwanghwamun Gate" },
    provider: "한국관광공사 TourAPI",
    sourcePlaceName: "광화문",
    sourceUrl: "https://tong.visitkorea.or.kr/cms/resource/72/3069472_image2_1.JPG",
    license: "공공누리 제1유형",
    licenseUrl: "https://www.kogl.or.kr/info/licenseType1.do",
    verifiedAt: "2026-08-10",
    verificationMethod: "TourAPI 이름·좌표 대조 후 이미지 육안 확인",
  },
  "place-forest-of-wisdom": {
    src: "/place-photos/place-forest-of-wisdom.jpg",
    alt: { ko: "책장이 이어진 지혜의 숲 내부", en: "Wall-to-wall bookshelves inside Forest of Wisdom" },
    provider: "한국관광공사 TourAPI",
    sourcePlaceName: "지혜의 숲",
    sourceUrl: "https://tong.visitkorea.or.kr/cms/resource/23/3039023_image2_1.jpg",
    license: "공공누리 제1유형",
    licenseUrl: "https://www.kogl.or.kr/info/licenseType1.do",
    verifiedAt: "2026-08-10",
    verificationMethod: "TourAPI 이름·좌표 대조 후 이미지 육안 확인",
  },
  "place-bosingak-site": {
    src: "/place-photos/place-bosingak-site.jpg",
    alt: { ko: "도심 속 보신각 전경", en: "Bosingak pavilion in central Seoul" },
    provider: "한국관광공사 TourAPI",
    sourcePlaceName: "보신각터",
    sourceUrl: "https://tong.visitkorea.or.kr/cms/resource/23/3568323_image2_1.jpg",
    license: "공공누리 제1유형",
    licenseUrl: "https://www.kogl.or.kr/info/licenseType1.do",
    verifiedAt: "2026-08-10",
    verificationMethod: "TourAPI 이름·좌표 대조 후 이미지 육안 확인",
  },
  "place-waryong-park": {
    src: "/place-photos/place-waryong-park.jpg",
    alt: { ko: "와룡공원 입구", en: "Entrance to Waryong Park" },
    provider: "한국관광공사 TourAPI",
    sourcePlaceName: "와룡공원",
    sourceUrl: "https://tong.visitkorea.or.kr/cms/resource/93/1395493_image2_1.jpg",
    license: "공공누리 제1유형",
    licenseUrl: "https://www.kogl.or.kr/info/licenseType1.do",
    verifiedAt: "2026-08-10",
    verificationMethod: "TourAPI 이름·좌표 대조 후 이미지 육안 확인",
  },
} as const satisfies Record<string, Omit<KtoPlacePhoto, "kind">>;

/**
 * 방송 장면 캡처. 파일은 `scene-` 접두사로 두어 같은 장소의 관광공사 사진을
 * 덮어쓰지 않는다 — 캡처를 내리면 관광공사 사진으로 그대로 되돌아간다.
 *
 * 등록 기준은 관광공사 사진과 같다: **그 장소인 줄 알아볼 수 있어야 한다.**
 * 인물 클로즈업이나 장소가 안 나오는 컷은 캡처가 있어도 등록하지 않는다
 * (아래 `HELD_SCENE_STILLS`).
 */
export const SCENE_STILLS = {
  "place-yeongjin-beach": {
    src: "/place-photos/scene-place-yeongjin-beach.jpg",
    alt: {
      ko: "파도가 부서지는 영진해변 방파제 위에 마주 선 김신과 지은탁",
      en: "Kim Shin and Eun-tak facing each other on the Yeongjin Beach breakwater",
    },
    broadcaster: "tvN",
    workTitle: { ko: "도깨비", en: "Guardian: The Lonely and Great God" },
    episodeLabel: null,
  },
  "place-lala-muri": {
    src: "/place-photos/scene-place-lala-muri.jpg",
    alt: {
      ko: "밤에 불이 켜진 한옥집 마당에 마주 선 두 인물",
      en: "Two figures in the lit courtyard of a hanok house at night",
    },
    broadcaster: "tvN",
    workTitle: { ko: "도깨비", en: "Guardian: The Lonely and Great God" },
    episodeLabel: "1화",
  },
  "place-woljeongsa-fir-forest": {
    src: "/place-photos/scene-place-woljeongsa-fir-forest.jpg",
    alt: {
      ko: "눈 덮인 월정사 전나무 숲길에 마주 선 김신과 지은탁",
      en: "Kim Shin and Eun-tak in the snow-covered fir forest trail at Woljeongsa",
    },
    broadcaster: "tvN",
    workTitle: { ko: "도깨비", en: "Guardian: The Lonely and Great God" },
    episodeLabel: null,
  },
  "place-samyang-ranch": {
    src: "/place-photos/scene-place-samyang-ranch.jpg",
    alt: {
      ko: "눈 덮인 삼양목장 능선을 홀로 걷는 김신",
      en: "Kim Shin walking alone along a snowy ridge at Samyang Roundhill",
    },
    broadcaster: "tvN",
    workTitle: { ko: "도깨비", en: "Guardian: The Lonely and Great God" },
    episodeLabel: null,
  },
  "place-balwangsan-cable-car": {
    src: "/place-photos/scene-place-balwangsan-cable-car.jpg",
    alt: {
      ko: "설경이 펼쳐진 발왕산 전망대에 선 두 사람",
      en: "Two characters at the Balwangsan observatory over a snowy valley",
    },
    broadcaster: "tvN",
    workTitle: { ko: "도깨비", en: "Guardian: The Lonely and Great God" },
    episodeLabel: null,
  },
  "place-sinchon-mural-tunnel": {
    src: "/place-photos/scene-place-sinchon-mural-tunnel.jpg",
    alt: {
      ko: "터널 출구의 빛을 등지고 나란히 걷는 김신과 저승사자",
      en: "Kim Shin and the Grim Reaper walking side by side toward the tunnel light",
    },
    broadcaster: "tvN",
    workTitle: { ko: "도깨비", en: "Guardian: The Lonely and Great God" },
    episodeLabel: "10화",
  },
  "place-gwanghwamun-gate": {
    src: "/place-photos/scene-place-gwanghwamun-gate.jpg",
    alt: {
      ko: "광화문 홍예문을 지나 광장으로 걸어 나가는 두 사람",
      en: "Two characters walking out through the Gwanghwamun archway",
    },
    broadcaster: "tvN",
    workTitle: { ko: "도깨비", en: "Guardian: The Lonely and Great God" },
    episodeLabel: null,
  },
  "place-unhyeongung-western-house": {
    src: "/place-photos/scene-place-unhyeongung-western-house.jpg",
    alt: {
      ko: "운현궁 양관 현관 계단 앞에 모여 선 세 사람",
      en: "Three characters at the entrance steps of the Unhyeongung Western House",
    },
    broadcaster: "tvN",
    workTitle: { ko: "도깨비", en: "Guardian: The Lonely and Great God" },
    episodeLabel: null,
  },
  "place-gyeonggijeon-shrine": {
    src: "/place-photos/scene-place-gyeonggijeon-shrine.jpg",
    alt: {
      ko: "경기전 어진박물관 전시실에서 어진을 바라보는 인물",
      en: "A character viewing royal portraits inside the Gyeonggijeon portrait museum",
    },
    broadcaster: "SBS",
    workTitle: { ko: "더 킹: 영원의 군주", en: "The King: Eternal Monarch" },
    episodeLabel: null,
  },
  "place-busan-cinema-center": {
    src: "/place-photos/scene-place-busan-cinema-center.jpg",
    alt: {
      ko: "영화의전당 야외광장에서 쓰러진 정태을을 안고 나오는 이곤과 경호대",
      en: "Lee Gon carrying Jeong Tae-eul out of the Busan Cinema Center plaza with his guards",
    },
    broadcaster: "SBS",
    workTitle: { ko: "더 킹: 영원의 군주", en: "The King: Eternal Monarch" },
    episodeLabel: null,
  },
  "place-gwanghwamun-square": {
    src: "/place-photos/scene-place-gwanghwamun-square.jpg",
    alt: {
      ko: "야간의 광화문광장, 이순신 동상 앞에 선 백마",
      en: "A white horse before the Admiral Yi statue at Gwanghwamun Square at night",
    },
    broadcaster: "SBS",
    workTitle: { ko: "더 킹: 영원의 군주", en: "The King: Eternal Monarch" },
    episodeLabel: null,
  },
  "place-woljeongsa-temple": {
    src: "/place-photos/scene-place-woljeongsa-temple.jpg",
    alt: {
      ko: "눈 덮인 월정사 진입로와 다리",
      en: "The snow-covered approach road and bridge at Woljeongsa",
    },
    broadcaster: "tvN",
    workTitle: { ko: "도깨비", en: "Guardian: The Lonely and Great God" },
    episodeLabel: "9화",
  },
  "place-deoksugung-stone-wall-road": {
    src: "/place-photos/scene-place-deoksugung-stone-wall-road.jpg",
    alt: {
      ko: "덕수궁 돌담을 배경으로 뒤돌아보는 김신",
      en: "Kim Shin looking back with the Deoksugung stone wall behind him",
    },
    broadcaster: "tvN",
    workTitle: { ko: "도깨비", en: "Guardian: The Lonely and Great God" },
    episodeLabel: "1화·14화",
  },
  "place-sowol-ro": {
    src: "/place-photos/scene-place-sowol-ro.jpg",
    alt: {
      ko: "관제실 모니터로 소월로 CCTV 화면을 확인하는 장면",
      en: "Checking the Sowol-ro CCTV feed on a control room monitor",
    },
    broadcaster: "SBS",
    workTitle: { ko: "더 킹: 영원의 군주", en: "The King: Eternal Monarch" },
    episodeLabel: "4화",
  },
  "place-forest-of-wisdom": {
    src: "/place-photos/scene-place-forest-of-wisdom.jpg",
    alt: {
      ko: "책장이 늘어선 열람 공간에 마주 앉은 두 사람",
      en: "Two characters seated across a reading table lined with bookshelves",
    },
    broadcaster: "SBS",
    workTitle: { ko: "더 킹: 영원의 군주", en: "The King: Eternal Monarch" },
    episodeLabel: "15화",
  },
} as const satisfies Record<
  string,
  Omit<SceneStillPhoto, "kind" | "rights" | "verifiedAt" | "verificationMethod">
>;

/**
 * 테마체험 권역 사진. 장소 카드(82px)와 달리 팝오버 배너로 넓게 깔리므로 긴 변 640px다.
 * 권역은 장소 하나가 아니라 구역이라 대표 전경을 쓴다.
 */
export type ZonePhoto = {
  src: string;
  alt: { ko: string; en: string };
};

export const ZONE_PHOTOS = {
  "zone-seoul-jeongdong-daehan": {
    src: "/place-photos/zone-seoul-jeongdong-daehan.jpg",
    alt: {
      ko: "덕수궁 전각과 석조전, 그 너머 정동 일대와 도심 빌딩 전경",
      en: "Deoksugung halls and Seokjojeon with the Jeongdong district and city skyline beyond",
    },
  },
} as const satisfies Record<string, ZonePhoto>;

export function zonePhoto(zoneId: string): ZonePhoto | null {
  return ZONE_PHOTOS[zoneId as keyof typeof ZONE_PHOTOS] ?? null;
}

export const REJECTED_PLACE_PHOTOS = {
  "place-namsan-library": "남산도서관 전체가 아니라 구내식당 사진",
} as const;

export function placePhoto(placeId: string): PlacePhoto | null {
  const still = SCENE_STILLS[placeId as keyof typeof SCENE_STILLS];
  if (still) {
    return {
      kind: "scene_still",
      ...still,
      rights: "방송사 저작물 — 시연용 인용",
      verifiedAt: "2026-08-14",
      verificationMethod: "캡처 화면 육안 확인 — 장소·작품 대조",
    };
  }

  const kto = PLACE_PHOTOS[placeId as keyof typeof PLACE_PHOTOS];
  return kto ? { kind: "kto", ...kto } : null;
}

/**
 * 카드 구석 배지와 접근성 문구 — 출처 성격에 따라 다르다.
 *
 * 장면 캡처는 `badge`가 `null`이다. 사진 위에 아무것도 얹지 않는 편이 낫다는 판단이고,
 * 관광공사 사진은 반대로 배지를 뗄 수 없다 — 공공누리 제1유형의 조건이 출처표시다.
 * 캡처의 방송사 크레딧은 화면에서 빠져도 `label`(툴팁·스크린리더)에는 남는다.
 */
export function photoCredit(
  photo: PlacePhoto,
  locale: "ko" | "en",
): { badge: string | null; label: string; href: string | null } {
  if (photo.kind === "scene_still") {
    const title = photo.workTitle[locale];
    const episode = photo.episodeLabel
      ? locale === "ko"
        ? ` ${photo.episodeLabel}`
        : ` ep.${photo.episodeLabel.replace("화", "")}`
      : "";
    return {
      badge: null,
      label:
        locale === "ko"
          ? `방송 장면 캡처 · ${photo.broadcaster} 〈${title}〉${episode} · 저작권 ${photo.broadcaster}`
          : `Broadcast still · ${photo.broadcaster} "${title}"${episode} · © ${photo.broadcaster}`,
      href: null,
    };
  }

  return {
    badge: "KTO · KOGL 1",
    label:
      locale === "ko"
        ? `${photo.sourcePlaceName} 사진 원본 · ${photo.provider} · ${photo.license}`
        : `Original ${photo.sourcePlaceName} photo · Korea Tourism Organization TourAPI · KOGL Type 1`,
    href: photo.sourceUrl,
  };
}
