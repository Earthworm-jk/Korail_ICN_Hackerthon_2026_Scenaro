# SCENARO Presentation Architecture v0.4

## 목적

이 구현은 12개의 독립 슬라이드를 옆으로 배치하는 HTML이 아니다. 하나의 지속적인 `World` 안에서 한국 지도, 콘텐츠 카드, 여행 제약, 제품, 설명, 기관 가치가 계속 존재하고 `state`가 카메라와 레이어의 가시성만 바꾼다.

핵심 원칙은 다음과 같다.

- `Scene = page`가 아니라 `Scene = state`다.
- 한국 지도는 발표의 공간적 기준점이다.
- 큰 카메라 이동은 의미가 있을 때만 사용한다.
- 대부분의 설명은 카메라가 멈춘 상태에서 overlay가 들어왔다 나간다.
- 실제 서비스에 진입하면 E2E 종료까지 카메라를 움직이지 않는다.
- E2E 뒤에도 제품 마지막 화면을 유지하고 설명/구현 근거를 overlay로 보여준다.
- 이후 제품이 지도 쪽으로 축소·소멸하는 동안 여행 경로가 드러나며 Rail × Air 가치와 확장으로 이어진다.

## DOM 계층

```text
stage 1920×1080
├─ camera
│  └─ world 2800×1700
│     ├─ contentLayer
│     ├─ mapLayer                persistent
│     ├─ productAnchor           발표 그래픽 → 제품 진입점
│     └─ worldLines / route
├─ opportunityOverlay            fixed stage overlay
├─ constraintOverlay
├─ surveyOverlay
├─ scenaroOverlay
├─ productViewport               실제 앱 / iframe, camera transform 바깥
├─ explainOverlay                실제 앱 위 설명
├─ valueOverlay
├─ expansionOverlay
└─ closingLayer
```

## Product Transition 계약 — v0.4에서 고정

`productAnchor`와 `productViewport`는 단순히 비슷한 위치가 아니라 **Product Push-in의 마지막 프레임에서 픽셀 단위로 같은 bounds**를 가져야 한다.

현재 기준:

```text
productAnchor world bounds = x 1230 / y 487 / 960×540
state 06 camera           = translate(-1320, -469.333) scale(4/3)
결과 stage bounds         = x 320 / y 180 / 1280×720
productViewport           = x 320 / y 180 / 1280×720
```

따라서 최종 앱 연결 시 다음 순서를 유지한다.

```text
world 안 실제 앱 캡처
→ camera push-in
→ 캡처가 320,180,1280×720에 정확히 정지
→ 같은 픽셀 상태의 productViewport/iframe으로 cross-fade
→ E2E 연속 시연
```

실제 캡처가 들어오더라도 이 bounds 계약은 변경하지 않는다. 앱 viewport 자체를 바꿔야 하는 상황이면 발표 구조를 임의 수정하지 말고 먼저 논의한다.

## Product → Map 복귀 계약

E2E/설명/Proof가 끝났다고 새 페이지로 전환하지 않는다.

state 09 → 10에서:

1. 실제 `productViewport`가 지도 중심 쪽으로 축소된다.
2. 제품 opacity가 내려가는 동안 persistent `mapLayer`가 다시 드러난다.
3. 제품이 사라지는 방향과 겹치는 위치에서 지도 경로가 그려진다.
4. 그 동일 지도 위에서 여행자·인천공항·코레일·지역 가치 카드가 등장한다.

현재 Golden Prototype은 **제품→지도 전환의 시각 문법을 잠그는 reference**다. 최종 E2E 캡처가 확정되면 앱 안의 실제 경로와 발표 지도 경로가 더 정확히 이어지도록 capture asset만 보정한다.

## 왜 productViewport가 camera 바깥인가

실제 iframe을 카메라의 `scale/translate` 대상에 넣으면 발표장 환경에 따라 글자 재렌더, pointer 좌표, 성능 문제가 발생할 수 있다. 따라서 이동 중에는 world 안의 `productAnchor`를 사용하고, 화면이 멈춘 뒤 실제 `productViewport`로 cross-fade하는 구조를 유지한다.

## Camera State

큰 이동은 네 가지 의미를 갖는다.

1. 콘텐츠 가까이 → 한국 전체: 관심이 장소로 흩어짐
2. 한국 전체 → 제품 진입점: 문제를 서비스 경험으로 전환
3. 제품 안: E2E 동안 카메라 정지
4. 제품 → 한국 전체: 결과를 Rail × Air 가치로 확장

`presentation.css`의 `#stage[data-state="N"] #world`가 기준 카메라 상태다. 위치값을 바꿀 때는 먼저 그 이동이 어떤 논리적 의미를 갖는지 문서에 적는다.

## Overlay State

Opportunity, Problem, Survey, How It Works, Proof는 독립 페이지가 아니다. 지도 또는 제품이라는 현재 중심 시각물을 유지하고 overlay만 출입한다.

- 지도 위: Opportunity / Constraints / Survey / SCENARO definition
- 제품 위: 데이터 설명 / 구현 증거
- 다시 지도 위: 기관 가치 / 적용·확장

## Closing 계약

발표자는 `내·일·로` 문구를 읽지 않는다.

```text
내가 좋아한 장면을 고르면
→ 일정은 나에게 맞게 다시 흐르고
→ 로망이 실제 여행이 됩니다.
→ 세 문장 모두 fade-out
→ SCENARO만 남음
```

최종 정지 프레임에는 **SCENARO 이외의 삼행시 문장이 남아 있으면 안 된다.**

## 실제 앱 연결

URL query parameter로 실제 앱을 지정한다.

```text
index.html?app=http://localhost:3000#7
```

최종 발표에서는 Product Push-in 상태에서 **실제 앱의 동일 캡처 이미지**를 확대하고, 정지한 순간 같은 상태의 실제 앱으로 cross-fade한다. 현재 reference는 구조 검증용이므로 실제 캡처 자산은 넣지 않았다.

## 절대 바꾸지 말아야 할 기준

- 12개의 1920×1080 `<section>`을 다시 나열하지 않는다.
- Opportunity / Survey / How It Works / Proof를 새 슬라이드 페이지로 되돌리지 않는다.
- 실제 E2E 중 카메라 이동이나 발표 overlay를 끼우지 않는다.
- actual app UI를 발표용 HTML에 복제하지 않는다.
- Product Push-in 마지막 프레임과 실제 앱 viewport의 위치·크기 정합을 깨지 않는다.
- 단순히 동적이어 보이기 위해 지그재그, 회전, 의미 없는 zoom을 추가하지 않는다.


## v0.5 Phase 2 content layer

Golden Shell v0.4의 camera/product transition 계약은 변경하지 않는다. 실제 문구·설문·공감 서사는 `STORYBOARD_V05.md`와 `CONTENT_SOURCE_NOTES.md`를 기준으로 한다. 최종 E2E 조합·설문 최종 N·구현 수치는 Phase 3에서만 교체한다.
