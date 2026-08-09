import PlannerWizard from "./planner-wizard";
import { loadStationFacilities } from "@/lib/station-facilities";
import { loadPlaceRankings } from "@/lib/place-rankings-snapshot";

// 서버 진입점 — 상호작용 화면은 Client Component로 분리 (#18 원칙)
// 역 편의시설·촬영지 랭킹 스냅샷은 서버에서 읽어 검증 후 내린다 (#24 A5·#48, 런타임 실호출 없음)
// 랭킹 스냅샷 미탑재는 null — 관계·출처·ID 결정적 폴백이 확정 경로다 (#48)
export default function Home() {
  const stationFacilities = loadStationFacilities();
  const placeRankings = loadPlaceRankings();
  return (
    <main className="flex-1">
      <PlannerWizard stationFacilities={stationFacilities} placeRankings={placeRankings} />
    </main>
  );
}
