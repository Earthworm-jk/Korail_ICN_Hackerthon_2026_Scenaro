import PlannerWizard from "./planner-wizard";

// 서버 진입점 — 상호작용 화면은 Client Component로 분리 (#18 원칙)
export default function Home() {
  return (
    <main className="flex-1">
      <PlannerWizard />
    </main>
  );
}
