"use server";
/**
 * 같은 구간의 **실존하는 이후 열차** (#103 첫 구간 한정)
 *
 * 항공편이 늦어지면 사용자는 공항을 늦게 나선다. 그때 "몇 시 편으로 미룰까"를 고르게
 * 하려면 그 시각에 실제로 열차가 있어야 한다. `lib/alternatives-mock.ts`는 추천 열차를
 * +60·+120분 밀어 만들었는데 그 시각의 열차는 존재하지 않는다 — 그래서 개발 플래그
 * 뒤에 있다. 여기서는 시간표 스냅샷에 실제로 실린 편만 내린다.
 *
 * 시각을 만들지 않는다. 스냅샷에 없으면 빈 목록이고, 화면은 고를 것이 없다고 말한다.
 */
import { loadRepositories } from "../repositories/json";

export type LaterDeparture = {
  trainNo: string;
  departAt: string;
  arriveAt: string;
};

export async function laterDepartures(input: {
  fromStationId: string;
  toStationId: string;
  /** 이 시각보다 **늦게** 출발하는 편만 — 지금 타기로 한 편은 목록에 넣지 않는다 */
  afterIso: string;
  limit?: number;
}): Promise<LaterDeparture[]> {
  const after = Date.parse(input.afterIso);
  if (Number.isNaN(after)) return [];
  /* **같은 날**만 — 날짜를 안 묶으면 이틀 뒤 아침 편이 "이후 열차"로 올라온다.
     공항에서 그날 나서는 편을 미루는 기능이지 여행을 하루 미루는 기능이 아니다.
     KST 표기(`+09:00`)의 앞 10자가 곧 그날이다 */
  const sameDay = input.afterIso.slice(0, 10);
  const repos = loadRepositories();
  return repos.trainLegs
    .filter((leg) =>
      leg.fromStationId === input.fromStationId
      && leg.toStationId === input.toStationId
      && leg.departAt.slice(0, 10) === sameDay
      && Date.parse(leg.departAt) > after)
    .sort((a, b) => Date.parse(a.departAt) - Date.parse(b.departAt))
    .slice(0, input.limit ?? 4)
    .map((leg) => ({ trainNo: leg.trainNo, departAt: leg.departAt, arriveAt: leg.arriveAt }));
}
