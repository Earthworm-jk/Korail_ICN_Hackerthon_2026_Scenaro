export type PlacePhoto = {
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
} as const satisfies Record<string, PlacePhoto>;

export const REJECTED_PLACE_PHOTOS = {
  "place-busan-cinema-center": "영화의전당 전체가 아니라 라이브러리 자료실 사진",
  "place-namsan-library": "남산도서관 전체가 아니라 구내식당 사진",
} as const;

export function placePhoto(placeId: string): PlacePhoto | null {
  return PLACE_PHOTOS[placeId as keyof typeof PLACE_PHOTOS] ?? null;
}
