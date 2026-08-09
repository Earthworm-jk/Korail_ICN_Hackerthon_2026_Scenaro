/**
 * 역 편의시설 표시 항목 파생 (#24 A5) — 아이콘·마크업과 분리한 순수 함수.
 *
 * 표시 규칙의 근거:
 * - 없는 시설을 숨기지 않는다. 숨기면 "시설이 없음"과 "정보가 아직 없음"이 화면에서 같아진다.
 *   스냅샷에 없는 역은 호출부가 애초에 목록에서 빼고 별도 안내를 띄우므로, 여기 오는 값은
 *   전부 "확인된 유무"다 (A3).
 * - 수량 0은 원천이 "설치 없음"으로 준 값이므로 없음으로 취급하고 0을 그대로 보여준다.
 */
import type { StationFacilityT } from "./station-facilities";
import type { MessageKey } from "./i18n/messages";

export type FacilityEntryId = "elevator" | "escalator" | "toilet" | "nursing" | "info";

export type FacilityEntry = {
  id: FacilityEntryId;
  labelKey: MessageKey;
  available: boolean;
  count: number | null; // 수량이 있는 시설만 숫자, 유무만 아는 시설은 null
};

/** 표시 순서 고정 — 수량형 2종 뒤 유무형 3종 */
export function facilityEntries(facility: StationFacilityT): FacilityEntry[] {
  return [
    {
      id: "elevator",
      labelKey: "support.facilitiesElevator",
      available: facility.elevatorCount > 0,
      count: facility.elevatorCount,
    },
    {
      id: "escalator",
      labelKey: "support.facilitiesEscalator",
      available: facility.escalatorCount > 0,
      count: facility.escalatorCount,
    },
    { id: "toilet", labelKey: "support.facilitiesToilet", available: facility.hasToilet, count: null },
    { id: "nursing", labelKey: "support.facilitiesNursing", available: facility.hasNursingRoom, count: null },
    { id: "info", labelKey: "support.facilitiesInfo", available: facility.hasInfoCenter, count: null },
  ];
}
