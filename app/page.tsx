import { loadRepositories } from "@/lib/repositories/json";
import { t } from "@/lib/i18n/messages";

export default function Home() {
  // 기동 시 시드 Zod 검증 — 스키마 불일치면 이 페이지가 실패한다 (REQ-DATA-004)
  const repos = loadRepositories();

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-3xl font-bold">{t("ko", "app.title")}</h1>
      <p className="mt-1 text-gray-500">{t("ko", "app.tagline")}</p>

      <section className="mt-8 rounded-lg border p-4">
        <h2 className="font-semibold">시드 데이터 로드 상태</h2>
        <ul className="mt-2 space-y-1 text-sm text-gray-600">
          <li>배우 {repos.actors.length} · 작품 {repos.works.length} · 촬영지 {repos.places.length}</li>
          <li>역 {repos.stations.length} · 열차 스냅샷 {repos.trainLegs.length} · 항공 스냅샷 {repos.flights.length}</li>
        </ul>
        <p className="mt-3 text-xs text-gray-400">
          현재는 샘플 시드입니다. 실데이터는 시드 구축 작업(이슈 #1 확정 14곳)에서 교체됩니다.
        </p>
      </section>
    </main>
  );
}
