# #181 골든 평가 리포트

- 생성 시각: 2026-08-12T15:08:43.654Z
- 시나리오: 20/20 통과
- 실패: 0건

## 실제 측정값

| 지표 | 분자/분모 | 측정값 |
| --- | ---: | ---: |
| 하드 제약 충족률 | 11/11 | 100.0% |
| feasible 성공률 | 8/8 | 100.0% |
| infeasible 판정 일치율 | 5/5 | 100.0% |
| 항공편 변경 대응 성공률 | 1/1 | 100.0% |
| 승객예고 판정 일치율 | 3/3 | 100.0% |
| 결정성·폴백 완주율 | 3/3 | 100.0% |
| 재계산 시간 p50 | 14 samples | 86.42 ms |
| 재계산 시간 p95 | 14 samples | 318.03 ms |

## 시나리오

| ID | 범주 | 기대 | 실제 | 결과 | 위반 코드 |
| --- | --- | --- | --- | --- | --- |
| G01 | feasible | planned | planned | PASS | - |
| G02 | feasible | planned | planned | PASS | - |
| G03 | feasible | planned | planned | PASS | - |
| G04 | feasible | planned | planned | PASS | - |
| G05 | feasible | planned | planned | PASS | - |
| G06 | feasible | planned | planned | PASS | - |
| G07 | feasible | planned | planned | PASS | - |
| G08 | feasible | planned | planned | PASS | - |
| G09 | infeasible | invalid | invalid | PASS | - |
| G10 | infeasible | invalid | invalid | PASS | - |
| G11 | infeasible | invalid | invalid | PASS | - |
| G12 | infeasible | invalid | invalid | PASS | - |
| G13 | infeasible | empty | empty | PASS | - |
| G14 | flight_change | changed_and_feasible | changed_and_feasible | PASS | - |
| G15 | passenger_advisory_change | elevated_to_clear | elevated_to_clear | PASS | - |
| G16 | passenger_advisory_change | elevated_to_clear | elevated_to_clear | PASS | - |
| G17 | passenger_advisory_change | elevated_to_out_of_range | elevated_to_out_of_range | PASS | - |
| G18 | determinism | deterministic | deterministic | PASS | - |
| G19 | offline_fallback | snapshot_planned | snapshot_planned | PASS | - |
| G20 | determinism | deterministic_elevated | deterministic_elevated | PASS | - |

## 실패 상세

실패 없음.

## 2차 범위

- AI 설명 사실 일치율: structured diff와 연결할 claim schema를 먼저 고정한 뒤 별도 지표로 측정합니다.
