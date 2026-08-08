import PlannerWizard from "./planner-wizard";
import { loadStationFacilities } from "@/lib/station-facilities";

// 서버 진입점 — 상호작용 화면은 Client Component로 분리 (#18 원칙)
// 역 편의시설 스냅샷은 서버에서 읽어 검증 후 내린다 (#24 A5, 런타임 실호출 없음)
export default function Home() {
  const stationFacilities = loadStationFacilities();
  return (
    <main className="flex-1">
      <PlannerWizard stationFacilities={stationFacilities} />
    </main>
  );
}
