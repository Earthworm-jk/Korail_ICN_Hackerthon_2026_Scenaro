# SCENARO Presentation Content Prototype v0.5

이 폴더는 Golden Shell v0.4 위에 **Phase 2의 실제 서사·문구·중간 설문 근거를 얹은 콘텐츠 프로토타입**이다. E2E와 최종 숫자는 아직 동결하지 않는다.

## v0.5 변경점

- Golden Shell v0.4의 카메라·제품 전환 계약은 그대로 유지
- Opening을 `K-콘텐츠 팬의 취향 → 실제 장소` 서사로 구체화
- 문제 장면에 팀의 실제 테마여행 경험과 `지도 → 열차 → 운영시간 → 다시 지도` 반복을 반영
- 사용자 조사 현재 중간집계(유효 26명)와 익명 자유응답을 같은 지도 위 overlay로 반영
- SCENARO를 `추천보다 조율`이라는 사용자 경험 언어로 정리
- E2E 후 데이터 설명에 AI 역할을 한 줄로 자연스럽게 삽입
- 기관 가치·확장 문구를 실제 적용 관점으로 다듬음
- `CONTENT_SOURCE_NOTES.md` 추가: 수치·인용·교체 필요 여부 기록

## 실행

`index.html`을 브라우저에서 연다.

실제 앱 연결을 테스트하려면 로컬 서버에서 presentation을 열고 query parameter로 앱 URL을 지정한다.

```text
http://localhost:8765/?app=http://localhost:3000
```

## 조작

- `←` / `→` / `PageUp` / `PageDown`: 이전·다음 state
- `N`: 발표자 노트
- `P`: 관객용 발표 모드(HUD 숨김)
- `F`: 전체화면
- `R`: 처음으로

## 구조

- `index.html`: persistent world/layers
- `presentation.css`: camera, layer state, product transition
- `presentation.js`: state navigation, scale-to-fit, iframe 연결
- `PRESENTATION_ARCHITECTURE.md`: 설계 및 전환 계약
- `STORYBOARD_V04.md`: World state storyboard
- `CODEX_HANDOFF.md`: 이후 Codex 작업 고정선

## 현재 placeholder

- 설문 최종 N
- 대표 E2E 조합
- actual product capture
- 구현 수치

## 검증 상태

- HTML parser 통과
- `node --check presentation.js` 통과
- Product Push-in bounds 계산 검증: world preview와 actual viewport가 정확히 `320,180,1280×720`
- 2026-08-11 state 01~05를 연속 재생해 `1280×720` 실제 화면 QA 완료
- 실제 브라우저 DOM에서 `1920×1080`, `devicePixelRatio=1`을 직접 확인하고 state 01~05의 stage/문서 bounds 검증
- state 01 카드 stagger, state 03·04 카드 순차 진입, state 01→02 camera pull-out의 동일 World 유지 확인
- state 06에서 preview와 actual viewport가 모두 `320,180,1280×720`, state 07에서도 동일 bounds 유지
- `1280×720`에서 긴 한국어 제목, 설문 quote/카드, 검색 loop, SCENARO flow의 잘림·겹침 없음
- 브라우저 console 오류 없음
- QA 증거: `qa-screenshots/v05-1280-state01.png` ~ `v05-1280-state05.png`, `qa-screenshots/viewport-qa-v05-20260811.json`


## Phase 2 교체 예정

- Opening의 예시 배우·작품 조합은 최종 E2E와 별도이며 Phase 3에서 교체 가능
- 설문 숫자는 현재 중간집계이며 최종 CSV 수집 후 재계산
- 실제 Product capture / E2E는 Phase 3에서 연결
- Proof의 구현 수치는 최종 동결 직후 교체
