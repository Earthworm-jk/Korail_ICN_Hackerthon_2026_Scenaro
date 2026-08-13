# #181 MVP 골든 평가

## 실행

```bash
pnpm eval:golden
```

실행은 고정 fixture 20개를 평가하고 gitignore된 실행 산출물을 만듭니다.

- `artifacts/evaluation/issue-181-evaluation.json`: 자동 처리용 원본
- `artifacts/evaluation/issue-181-evaluation.md`: 사람 검토용 요약

실패는 평균값에 숨기지 않습니다. 두 리포트 모두 scenario ID와 위반 코드를 기록하며 평가 명령도 실패합니다.

CI는 `dev`·`main` 대상 PR과 두 브랜치 push에서 `pnpm eval:golden`을 실행합니다. 따라서 validator 회귀는 일반 테스트와 별도 단계에서 자동 차단됩니다.

발표 기준으로 보존할 실제 측정값을 의도적으로 갱신할 때만 다음 명령을 사용합니다.

```bash
pnpm eval:golden:record
```

이 명령은 커밋 대상인 `reports/issue-181-evaluation.json`과 `.md`를 덮어씁니다. 생성 시각과 실행 환경별 timing이 달라지므로 발표 기준을 새로 기록할 때만 실행합니다.

## 출력 schema에서 검증하는 필드

- `status`, `days[].date`
- `days[].items[].placeId/arriveAt/departAt/accessMinutes`
- `days[].rides[].trainNo/fromStationId/toStationId/departAt/arriveAt`
- `days[].gatewayLegs[]`
- `rejectedPlaces[].code/placeId`
- `warnings[].code/placeId/detail`
- `comparisonKeys.verifiedHoursMismatchCount`
- `metrics.totalRailMinutes`
- `verifiedAlternatives[].improvements/deltas/changes/days/metrics` — 필드가 있을 때 추천과 같은 validator로 전체 일정 재검증

## 하드 제약과 위반 코드

| 제약 | 실패 코드 |
| --- | --- |
| 모든 방문·이동 구간의 양의 시간 | `INVALID_INTERVAL` |
| 방문·열차·공항 구간 시간 중복 없음 | `ITINERARY_OVERLAP` |
| 공항 출발 가능 시각부터 공항 도착 마감 안에 방문 | `OUTSIDE_TRIP_WINDOW` |
| 제외 장소 재포함 금지 | `EXCLUDED_PLACE_REINTRODUCED` |
| 하루 장소 수 상한 | `DAILY_CAPACITY_EXCEEDED` |
| 장소 중복 방문 금지 | `DUPLICATE_PLACE` |
| 등록 장소와 최소 체류시간 일치 | `UNKNOWN_PLACE`, `STAY_TIME_SHORTFALL` |
| 열차 스냅샷과 정확히 일치 | `TRAIN_SNAPSHOT_MISMATCH` |
| 다른 열차 간 최소 환승 15분 | `MIN_TRANSFER_VIOLATION` |
| 경고는 실제 배치 장소만 참조 | `WARNING_TARGET_MISSING` |
| 요청한 배우·작품 그룹 반영 | `SELECTION_GROUP_UNCOVERED` |
| 파생 지표와 일정 원본 일치 | `METRIC_MISMATCH` |

운영시간은 현재 제품 계약에서 하드 제외가 아닙니다. 검증된 운영시간 밖이거나 운영시간 미확인이어도 장소를 숨기지 않고 `ACTIVITY_WINDOW_MISMATCH` 경고를 내는 정책이므로, 하드 제약 충족률의 실패로 세지 않고 경고 대상·개수 정합만 검증합니다.

검증 대안의 `더 빠름`·`환승 적음` 표시는 자연어 추정이 아니라 추천 대비 구조화된 분·횟수
diff에서만 파생합니다. 대안은 추천과 같은 선택 그룹 충족 수·방문 수를 유지해야 하며, 합성 회귀
fixture에서 대안의 전체 `days[]`를 독립 `ItineraryResult`로 다시 구성해 validator 위반 0건을 확인합니다.
장소 집합이 바뀌면 `changes.removedPlaceIds/addedPlaceIds`를 실제 `days[]` 집합 차이와 대조하고,
운영시간 충돌·선호일·선호순서·경고 수의 `deltas`도 추천 대비 실측값과 대조합니다. 대안 고유의
`preferredDateOutcomes/preferredOrderOutcomes` 역시 대안 `days[]`에서 다시 계산해 숨은 손실을 잡습니다.

## 지표 정의

- 하드 제약 충족률: validator 대상 planned/recalculated 결과 중 위반 코드가 0인 결과 수 / 대상 결과 수
- feasible 성공률: feasible 8개 중 planned이며 validator 위반이 없는 수 / 8
- infeasible 판정 일치율: 모순 입력 4개와 유효하지만 연결 불가능한 입력 1개 중 각각 구조화 invalid/empty로 판정한 수 / 5
- 항공편 변경 대응 성공률: paired 변경 뒤 새 유효 일정 또는 명시적 infeasible를 반환한 수 / 항공 변경 pair 수
- 승객예고 판정 일치율: fixture 기대 상태 전이를 반환한 pair 수 / 승객예고 pair 수
- 결정성·폴백 완주율: 반복 출력 일치 또는 외부 호출 없는 snapshot→일정 완주 성공 수 / 해당 시나리오 수
- 재계산 시간: 각 `generateItinerary` 호출의 실제 wall-clock p50/p95. 반복 결정성은 각 호출을 별도 샘플로 기록합니다. 머신·부하에 따라 달라지므로 목표치가 아니라 실행 당시 측정값만 출력합니다.

## 2차 범위

AI 설명 사실 일치율은 엔진 정확성과 분리합니다. 자연어를 휴리스틱으로 파싱하지 않고, 설명 생성기가 검증 가능한 claim ID와 structured itinerary diff 근거를 함께 내리는 계약을 고정한 뒤 별도 분자·분모로 추가합니다.
