/**
 * 일정 생성·재계산 엔진 — 순수 TypeScript 모듈 (docs/ENGINE_SPEC.md)
 * 편집 3동작(제외/방문일 변경/항공편 시각 변경)은 모두 TripConstraints 필드만 바꿔
 * 이 단일 진입점을 다시 호출한다 (#2 최종 결정). 전체 재계산, 부분 패치 없음.
 *
 * 구현 예정: 08-09 플래너 P0 (로드맵 #6). 회귀 프리셋 3개가 이 함수를 검증한다.
 */
import type { Repositories } from "../repositories/json";
import type { ItineraryResult, TripConstraints } from "./types";

export function generateItinerary(
  _constraints: TripConstraints,
  _repos: Repositories,
): ItineraryResult {
  throw new Error("NotImplemented — docs/ENGINE_SPEC.md §4 참조, 08-09 플래너 P0에서 구현");
}
