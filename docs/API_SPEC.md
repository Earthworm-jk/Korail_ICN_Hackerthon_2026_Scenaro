# 씬나로 API 명세서 v0.2

> 원칙: **앱이 실제로 호출하는 것만 수록한다.**
> 상위 문서: PRD, 요구사항 정의서 v0.4, 엔진 명세 v0.2, WIREFRAME_GUIDE.
> 이 문서가 A축(엔진·데이터)과 B축(화면)의 유일한 접점 계약이다.

#### 버전 관리 요약

| 버전 | 변경 전 | 변경 후 |
|---|---|---|
| v0.1 | — | 최초 작성. 계층 구조·실호출 원칙·Server Actions 4개 계약 요약 |
| v0.1 | FlightT 반환·성공형만 | 리뷰 반영 — FlightInfo 타입(변경 시각·운항 상태)·FLIGHT_NOT_FOUND 실패 계약, 배지 열거 2종 통일, WIREFRAMES 철회(가이드로 단일화) |
| v0.2 | 계약 요약 수준 | **명세서 급 상세화** — 공통 규약, 액션별 요청·응답 필드 표, 예시 payload, 실패 케이스 표, 외부 API 필드 매핑, 화면(WF)·REQ 매핑 |

## 0. 공통 규약

| 항목 | 규약 |
|---|---|
| 호출 방식 | **Server Actions** (PR #12에서 확정 대기). 외부 노출 데모가 필요해지면 같은 함수를 `app/api/*/route.ts`로 얇게 감싼다 |
| 필드 네이밍 | **camelCase**. 근감소증 v5의 snake_case 전환은 REST·타언어 클라이언트 전제였고, 여기는 TS↔TS 단일 리포라 타입 공유가 우선 |
| 시간 표기 | ISO 8601 + 오프셋(`2026-08-12T10:15:00+09:00`). 날짜만인 값은 `YYYY-MM-DD` |
| 도메인 실패 | 예외가 아니라 **판별 유니온 값**(`ok: false` 또는 사유 포함 구조)으로 반환 — UI가 분기 |
| 프로그래밍 오류 | 시드·입력 스키마 위반은 Zod 예외 → 기동·개발 중에만 발생해야 정상(REQ-DATA-004) |
| 사유 코드 | 개발 코드 문자열을 사용자에게 직접 노출하지 않고 i18n 문구로 매핑(WF-11 표) |
| 출처 노출 | 서버 전용 JSON의 원문 출처 전체를 클라이언트에 보내지 않고 표시용 필드만 전달 |
| 결정성 | 동일 입력 → 동일 응답. `Date.now()`·난수 사용 금지(엔진 명세 §1) |

## 1. 계층 구조

```
브라우저 UI (WF-01..13)
  → (계층 2) 앱 내부 계약: Server Actions 4개   ← 이 문서 §3
    → lib/engine  (순수 함수, ENGINE_SPEC)
    → lib/repositories (JSON 시드, 기동 시 Zod 검증)
    → lib/adapters
      → (계층 1) 외부 공공 API — 유일한 런타임 실호출   ← 이 문서 §2
```

## 2. 계층 1 — 외부 공공 API (서버 전용)

### 2.1 실호출 1건: 인천공항 여객편 운항 현황 (REQ-DATA-003, P1)

| 항목 | 값 |
|---|---|
| 제공 | 인천국제공항공사 (공공데이터포털) |
| 엔드포인트 | `https://apis.data.go.kr/B551177/StatusOfPassengerFlightsDSOdp` (상세 오퍼레이션은 구현 시 확정 후 이 표를 갱신) |
| 인증 | `AIRPORT_API_KEY` — `.env.local` 전용, `lib/env.ts` `flightMode()`가 키 부재 시 snapshot 모드 결정 |
| 타임아웃 | **5초** — 초과·오류 시 `data/flights-snapshot.json` 자동 전환, UI에 `source: "snapshot"` 표시 (WF-13) |
| 호출 시점 | 데모 중 입국편 확인 1회. 오프라인 모드에서는 호출하지 않음(NFR-DEMO-001). 자동 반복 조회 금지(WF-13) |

요청 파라미터:

| 파라미터 | 타입 | 필수 | 설명 | 예시 |
|---|---|---|---|---|
| serviceKey | string | ✔ | 발급 키 (URL 인코딩 주의) | — |
| flight_id | string | ✔ | 편명 | `KE904` |
| searchday | string | ✔ | 조회 일자 | `20260812` |
| type | string | ✔ | 응답 형식 | `json` |

응답 필드 → `FlightInfo` 매핑:

| 외부 필드 | FlightInfo 필드 | 비고 |
|---|---|---|
| flightId | flightNo | |
| scheduleDateTime | scheduledAt | ISO로 정규화 |
| estimatedDateTime | estimatedAt | 변경 시각. 없으면 undefined |
| remark | status | 운항 상태 문구(도착·지연 등) |
| terminalId | terminal | T1/T2로 정규화 |

### 2.2 런타임에 호출하지 않는 것 (명시)

- **KTX 시간표**: `data/train-snapshot.json`만 사용. 실시간 조회 없음
- **TourAPI·레일포털**: 오프라인 파이프라인(Python, 시드 생성)에서만 사용
- 런타임 실호출이 추가되면 이 문서를 **먼저** 갱신한다 — "실호출만 수록" 원칙

## 3. 계층 2 — 앱 내부 계약 (Server Actions 4개)

목차:

| # | 액션 | 성격 | 호출 화면 | 관련 REQ | 상태 |
|---|---|---|---|---|---|
| 3.1 | `searchEntities` | 조회 | WF-02·03 | SRCH-003·004·008 | 대기 중 |
| 3.2 | `getCandidatePlaces` | 조회 | WF-04 | SRCH-005·006·007, DATA-002 | 대기 중 |
| 3.3 | `planItinerary` | 계산(무상태) | WF-05..12 | ITIN-001..008, EDIT-001..006 | 대기 중 |
| 3.4 | `getFlightInfo` | 조회(+실호출) | WF-01·13 | SRCH-001, DATA-003, NFR-DEMO-001 | 대기 중 |

---

### 3.1 searchEntities — 배우·작품 통합 검색

`lib/actions/search.ts`

```ts
searchEntities(query: string): Promise<SearchResult>
```

요청:

| 필드 | 타입 | 필수 | 제약·검증 | 예시 |
|---|---|---|---|---|
| query | string | ✔ | trim 후 1자 이상. 부분 문자열 매칭(ko·en 모두) | `"김고은"`, `"goblin"` |

응답 `SearchResult`:

| 필드 | 타입 | 설명 |
|---|---|---|
| actors | ActorSummary[] | 이름·검증 작품 수 포함. WF-02 배우 결과 행 |
| actors[].id | string | |
| actors[].name | { ko, en } | |
| actors[].verifiedWorkCount | number | 검증 출연작 수 |
| works | WorkSummary[] | WF-02 작품 결과 행 |
| works[].id | string | |
| works[].title | { ko, en } | |
| works[].year | number? | |
| works[].verifiedPlaceCount | number | 검증 촬영지 수 |

응답 예시:

```json
{
  "actors": [
    { "id": "actor-kim-go-eun", "name": { "ko": "김고은", "en": "Kim Go-eun" }, "verifiedWorkCount": 4 }
  ],
  "works": [
    { "id": "work-goblin", "title": { "ko": "도깨비", "en": "Guardian: The Lonely and Great God" }, "year": 2016, "verifiedPlaceCount": 6 }
  ]
}
```

실패·경계 케이스:

| 케이스 | 반환 | 화면 처리 |
|---|---|---|
| 결과 0건 | `{ actors: [], works: [] }` — 예외 아님 | WF-03 빈 상태(대안 제시) |
| query 공백 | 검증 예외(개발 오류) — UI가 사전 차단 | 검색 버튼 비활성 |

---

### 3.2 getCandidatePlaces — 촬영지 후보 조회

`lib/actions/places.ts`

```ts
getCandidatePlaces(selection: Selection): Promise<PlaceCandidate[]>
```

요청 `Selection`:

| 필드 | 타입 | 필수 | 제약·검증 | 예시 |
|---|---|---|---|---|
| selectedActorId | string? | — | 최대 1명(WF-02 규칙) | `"actor-kim-go-eun"` |
| selectedWorkIds | string[] | ✔ | 1개 이상. 배우 선택 시 그 배우의 작품만 허용(P0) | `["work-goblin"]` |

응답 `PlaceCandidate[]` (표시용 필드만 — 원문 출처 전체 비노출):

| 필드 | 타입 | 설명 |
|---|---|---|
| id | string | |
| name | { ko, en } | |
| workTitles | { ko, en }[] | 연결 작품명 |
| relation | `"selected_work" \| "actor_other_work"` | **상호 배타 파생**(엔진 명세 §2) — 두 범주 중복 0건 |
| regionId | `"gangwon" \| "seoul_metro" \| "honam"` | 최근접역에서 파생 |
| nearestStation | { ko, en } | |
| accessMinutes | number | 추정치 — 표시 시 항상 라벨 동반(WF §10) |
| openingSummary | string | `"09:00-18:00 (검증 2026-08-08)"` 또는 `"상시 개방 확인"` |
| sourceName | string | 표시용 출처명 |
| verifiedAt | string | 검증일 |
| officialSourceCount | number | UI 정렬 전용(#3) — 엔진 점수와 무관 |
| reasonText | { ko, en } | 사전 작성 추천 사유(REQ-DATA-005) |
| badge | `"CONSERVATIVE_BUFFER_MISMATCH" \| "UNVERIFIED_HOURS"`? | WF-04 배지 2종과 1:1. 없으면 정상 후보 |

정렬 규칙(UI 전용, REQ-SRCH-007): 관련성(relation) 또는 officialSourceCount 토글, 관련성 동점 시 2차 키 officialSourceCount.

실패·경계 케이스:

| 케이스 | 반환 | 화면 처리 |
|---|---|---|
| 검증 촬영지 0곳 | `[]` | WF-03 유사 빈 상태 + 다른 작품 제안 |
| badge 후보만 존재 | 배지 포함 배열 | WF-04 `확인 필요 후보` 그룹 분리, 자동 일정 제외 안내 |

---

### 3.3 planItinerary — 일정 생성·재계산 (무상태, 단일 진입점)

`lib/actions/itinerary.ts`

```ts
planItinerary(constraints: TripConstraints): Promise<ItineraryResult>
```

생성과 편집 3동작(제외/방문일 고정/항공 시각 변경)이 **전부 이 액션 하나**다(#2).
편집은 constraints 필드만 바꿔 재호출하고, UI는 성공 응답일 때만 일정을 교체한다(REQ-EDIT-005).
저장 개념이 없으므로 리소스 ID가 없다(정의서 v0.4).

요청 `TripConstraints` (엔진 명세 §2와 동일 타입):

| 필드 | 타입 | 필수 | 기본값 | 제약·검증 | 예시 |
|---|---|---|---|---|---|
| arrivalAt | string | ✔ | — | ISO. departureAt보다 빨라야 함 | `"2026-08-12T10:15:00+09:00"` |
| departureAt | string | ✔ | — | ISO | `"2026-08-14T18:00:00+09:00"` |
| airportExitOffsetMin | number | ✔ | 120 | 90/120/직접(양수) — REQ-SRCH-002 | `120` |
| selectedActorId | string? | — | — | 최대 1명 | `"actor-kim-go-eun"` |
| selectedWorkIds | string[] | ✔ | — | 1개 이상 | `["work-goblin","work-little-women"]` |
| requiredPlaceIds | string[] | ✔ | `[]` | 후보에 존재하는 ID만 | `["place-yeongjin-beach"]` |
| excludedPlaceIds | string[] | ✔ | `[]` | 사용자 제외 — rejectedPlaces 대상 아님 | `[]` |
| pinnedDates | Record<string,string> | ✔ | `{}` | placeId → 여행일 내 `YYYY-MM-DD` | `{"place-oak-valley":"2026-08-13"}` |
| maxPlacesPerDay | number | ✔ | 2 | 1-3 | `2` |
| dailySlackMinutes | number | ✔ | 120 | 0 이상 — 소프트(미달만 불이익) | `120` |
| departureBufferMinutes | number | ✔ | 120 | 하드 제약. P0 UI에서는 120 고정(WF-05) | `120` |

응답은 **3분기 판별 유니온**이다(PR #16): `ok:true·status:"planned"` / `ok:true·status:"empty"` / `ok:false`.

성공 응답 (`ok: true, status: "planned"`):

| 필드 | 타입 | 설명 |
|---|---|---|
| status | `"planned"` | 선택된 일정이 있는 정상 상태 |
| days | DayPlan[] | 일자별 일정 |
| days[].date | string | `YYYY-MM-DD` |
| days[].rides | TrainRide[] | 열차번호·출발/도착역·시각 |
| days[].items | ItineraryItem[] | 장소 방문. arriveAt/departAt + accessMinutesLabel(추정치 라벨 필수) |
| rejectedPlaces | CandidateRejection[] | **후보 제외 3종만**: TRAIN_UNAVAILABLE / DEPARTURE_DEADLINE_EXCEEDED / ACTIVITY_WINDOW_MISMATCH(+detail) |
| comparisonKeys | ComparisonKeys | 선정 이유 **문장 생성 근거** — 원시 숫자를 사용자에게 직접 노출하지 않음(WF-07) |
| metrics | ItineraryMetrics | totalTravelMinutes·totalRailMinutes·transferCount·departureSlackMinutes — **전후 비교(diff)는 앱 계층이 이전 metrics와 대조**(REQ-EDIT-004) |

실패 응답 (`ok: false`) — 전체 재계산 실패, UI는 기존 일정 유지(WF-11·12):

| 필드 | 타입 | 설명 |
|---|---|---|
| reason.code | `"USER_CONSTRAINT_INFEASIBLE"` | 후보 제외가 아니라 요청 실패(정의서 v0.4) |
| reason.constraintType | `"REQUIRED_PLACE" \| "PINNED_DATE"` | |
| reason.targetId | string | 문제 장소 — 사용자 문구에 이름으로 표시 |

빈 결과 응답 (`ok: true, status: "empty"`) — 정상 처리됐지만 조건을 만족하는 일정 없음:

| 필드 | 타입 | 설명 |
|---|---|---|
| status | `"empty"` | comparisonKeys·metrics 미포함 — 허위 값 금지(PR #16) |
| days | `[]` | |
| rejectedPlaces | CandidateRejection[] | '일정 없음' 화면의 사유 목록(WF-11) |

성공 예시(발췌):

```json
{
  "ok": true,
  "status": "planned",
  "days": [
    {
      "date": "2026-08-12",
      "rides": [
        { "trainNo": "801", "fromStationId": "station-seoul", "toStationId": "station-gangneung",
          "departAt": "2026-08-12T13:01:00+09:00", "arriveAt": "2026-08-12T14:59:00+09:00" }
      ],
      "items": [
        { "placeId": "place-yeongjin-beach", "arriveAt": "2026-08-12T15:45:00+09:00",
          "departAt": "2026-08-12T16:45:00+09:00", "accessMinutesLabel": "역-장소 접근 25분 추정" }
      ]
    }
  ],
  "rejectedPlaces": [
    { "code": "ACTIVITY_WINDOW_MISMATCH", "placeId": "place-jukrim-cathedral", "detail": "UNVERIFIED_HOURS" }
  ],
  "comparisonKeys": {
    "relevanceKey": { "selectedWorkPlaceCount": 3, "actorOtherWorkPlaceCount": 1 },
    "visitablePlaceCount": 4, "totalRailMinutes": 236, "transferCount": 0, "slackSatisfied": true
  },
  "metrics": { "totalTravelMinutes": 340, "totalRailMinutes": 236, "transferCount": 0, "departureSlackMinutes": 180 }
}
```

실패 예시:

```json
{
  "ok": false,
  "reason": { "code": "USER_CONSTRAINT_INFEASIBLE", "constraintType": "PINNED_DATE", "targetId": "place-oak-valley" }
}
```

성능·기타:

- 목표 2초 이내(NFR-PERF-001, P0). 시드 규모에서는 수 ms 예상
- 처리 중 중복 요청은 UI가 잠금(WF-09 공통 규칙) — 액션은 멱등이므로 서버 보호 불필요
- P1 예약 자리: `alternatives`(추천 포함 최대 3개, 시간표 다양성 필터·결정적) — 엔진 명세 반영 전까지 디자인 계약(WF-08)

---

### 3.4 getFlightInfo — 항공편 조회 (실호출 1건 + 폴백)

`lib/actions/flights.ts`

```ts
getFlightInfo(flightNo: string, direction: "arrival" | "departure"): Promise<FlightLookupResult>
```

요청:

| 필드 | 타입 | 필수 | 제약·검증 | 예시 |
|---|---|---|---|---|
| flightNo | string | ✔ | 공백 제거, 대문자 정규화 | `"KE904"` |
| direction | `"arrival" \| "departure"` | ✔ | | `"arrival"` |

응답 `FlightLookupResult` (판별 유니온):

| 케이스 | 구조 | 화면 처리 |
|---|---|---|
| 성공 | `{ ok: true, flight: FlightInfo, source: "live" \| "snapshot" }` | WF-01 자동 입력. snapshot이면 WF-13 고지 |
| 미검색 편명 | `{ ok: false, reason: "FLIGHT_NOT_FOUND" }` | 수동 시각 입력 유도(WF-01) |

`FlightInfo`:

| 필드 | 타입 | 설명 |
|---|---|---|
| flightNo | string | |
| direction | `"arrival" \| "departure"` | |
| scheduledAt | string | 예정 시각 |
| estimatedAt | string? | 변경(예상) 시각 — live 조회 시 |
| status | string? | 운항 상태 문구 — live 조회 시 |
| terminal | string? | |

폴백 시퀀스(§2.1): live 시도(키 있고 온라인) → 5초 초과·오류 → snapshot 조회 → 그래도 없으면 FLIGHT_NOT_FOUND. 어떤 경우에도 사용자에게 오류를 던지지 않는다(PRD 9.2).

## 4. REQ·화면 매핑 종합

| 계약 | 정의서 REQ | 화면 |
|---|---|---|
| searchEntities | SRCH-003·004·008 | WF-02·03 |
| getCandidatePlaces | SRCH-005·006·007·009, DATA-002 | WF-04 |
| planItinerary | ITIN-001..008, EDIT-001..006, NFR-PERF-001 | WF-05..12 |
| getFlightInfo | SRCH-001, DATA-003, NFR-DEMO-001 | WF-01·13 |
| (외부) 인천공항 운항 | DATA-003 | WF-13 |

참고: 요구사항 정의서의 구 표기 `GET /flights`는 v0.4에서 `getFlightInfo(API_SPEC)`로 동기화 완료.
