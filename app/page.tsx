import PlannerWizard from "./planner-wizard";
import { loadStationFacilities } from "@/lib/station-facilities";
import { loadStationCoordinates } from "@/lib/station-coordinates";

// 서버 진입점 — 상호작용 화면은 Client Component로 분리 (#18 원칙)
// 역 편의시설 스냅샷은 서버에서 읽어 검증 후 내린다 (#24 A5, 런타임 실호출 없음)
// 역 좌표 스냅샷도 같은 규칙 — v0.6 지도가 역·공항 점을 실좌표에 찍는다 (#14)
// #48 랭킹 스냅샷은 여기서 내리지 않는다 — 원시 점수 RSC 직렬화 방지 (PR #70 리뷰),
// 안전 파생값(aiRank·aiReason)만 getCandidatePlaces 응답에 실린다
export default function Home() {
  const stationFacilities = loadStationFacilities();
  const stationCoordinates = loadStationCoordinates();
  return (
    <main className="flex-1">
      <PlannerWizard
        stationFacilities={stationFacilities}
        stationCoordinates={stationCoordinates}
      />
    </main>
  );
}
