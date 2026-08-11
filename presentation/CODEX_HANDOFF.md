# Codex Handoff — Golden Prototype v0.4

## 이 파일의 역할

이 reference가 발표 구조와 핵심 전환의 기준 구현이다. 이후 Codex는 구조를 새로 창작하기보다 실제 앱 연결, 최종 자산 교체, 브라우저 안정화와 리팩터링을 담당한다.

## v0.4에서 새로 잠근 것

1. **Product Push-in 픽셀 정합**
   - world `productAnchor`가 state 06 마지막에 stage `320,180,1280×720`에 도착한다.
   - 실제 `productViewport`도 정확히 같은 bounds다.
   - 최종 capture→iframe은 이 위치에서 cross-fade한다.

2. **Product → Map 복귀 문법**
   - E2E/Explain/Proof 뒤 새 페이지로 가지 않는다.
   - 실제 제품이 지도 방향으로 축소·소멸한다.
   - 동시에 persistent 한국 지도와 여행 경로가 다시 드러난다.

3. **Closing 최종 프레임**
   - 내·일·로 세 문장은 순차 등장 후 모두 사라진다.
   - 마지막에는 `SCENARO`만 남는다.

## 유지해야 하는 것

1. `one world + persistent layers + state machine`
2. 한국 지도는 지속적인 공간 기준점
3. Opportunity / Survey / How / Proof는 overlay
4. 제품 진입 후 E2E 종료까지 카메라 정지
5. E2E 마지막 제품 화면 위 설명/Proof
6. 제품에서 다시 지도 경로로 pull-out
7. Closing은 발표자가 읽지 않는 `내 → 일 → 로 → fade-out → SCENARO`

## 교체해야 하는 것

- `[최종 N]` 설문 숫자
- 실제 E2E 배우·작품 조합
- 실제 product capture
- 실제 구현 수치
- 최종 기관/확장 문구의 세부 표현

## 실제 앱 연결 시 해야 할 일

- `productAnchor` 안의 placeholder preview를 **실제 최종 앱 캡처**로 교체한다.
- 캡처 원본 viewport는 `1280×720`을 기준으로 한다.
- Product Push-in이 끝난 뒤 같은 픽셀 상태의 `productViewport` iframe으로 cross-fade한다.
- E2E 종료 후 동일 상태의 캡처로 다시 고정할 수 있는 경로를 마련한다.
- iframe이 포커스를 가진 상태에서도 발표 shell로 복귀할 수 있도록 다음 중 하나를 구현한다.
  - 앱에서 `postMessage({type:'presentation-exit'})`
  - 발표자 전용 hot-corner
  - 발표자용 별도 controller window
- 관객에게 `시연 종료` 버튼을 노출하지 않는다.

## 금지

- `slide1`, `slide2`처럼 독립 fullscreen page를 다시 만들지 않는다.
- camera state를 단순 x축 2100px 간격으로 되돌리지 않는다.
- 화면마다 배경/DOM을 초기화하지 않는다.
- 시연 중 발표 그래픽을 덮지 않는다.
- 실제 서비스 UI를 HTML로 재구현하지 않는다.
- `productAnchor`/`productViewport` 위치를 보기 좋다는 이유로 독립적으로 바꾸지 않는다.
- state 09→10을 단순 fade-cut으로 대체하지 않는다.

## Codex에게 맡기기 좋은 후속 작업

- Golden v0.4 실제 브라우저 QA
- 실제 최신 `dev` 앱과 iframe/capture 연결
- query parameter 및 presenter controller 안정화
- Chrome 프로젝터 환경 1920×1080 / 1280×720 / 1024×768 테스트
- final E2E fixture 연결
- 설문/구현 수치 교체
- PDF capture mode 추가
- reduced-motion 및 accessibility regression


## v0.5 Phase 2 content layer

Golden Shell v0.4의 camera/product transition 계약은 변경하지 않는다. 실제 문구·설문·공감 서사는 `STORYBOARD_V05.md`와 `CONTENT_SOURCE_NOTES.md`를 기준으로 한다. 최종 E2E 조합·설문 최종 N·구현 수치는 Phase 3에서만 교체한다.
