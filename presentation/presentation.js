(() => {
  const STATES = [
    {
      name: "Hook — 화면 속 장면을 직접 가보고 싶다",
      note: "K-콘텐츠의 팬 감정에서 시작한다. 현재 예시 선택은 김고은 + 도깨비 + 미스터 션샤인이며 최종 E2E 조합과 별도다. 배우·작품 복수 선택은 설명보다 화면으로 먼저 이해시킨다."
    },
    {
      name: "Pull-out — 좋아한 장면은 한 도시에 있지 않다",
      note: "첫 번째 큰 카메라 이동. 취향 카드에서 관련 장소가 한국 곳곳으로 흩어져 있음을 드러낸다. 72%와 79.3%는 시장 슬라이드가 아니라 하단 근거 카드로만 짧게 사용한다."
    },
    {
      name: "Problem — 시간표는 서로 맞춰주지 않는다",
      note: "지도는 유지한다. 항공·철도·운영시간 카드가 순차 등장하고, 지도→열차→운영시간→다시 지도의 검색 반복을 보여준다. 발표자는 기획서의 일본 성 테마 여행 경험을 한두 문장으로 연결할 수 있다."
    },
    {
      name: "User Evidence — 다시 보고, 다시 맞추고, 포기",
      note: "현재 중간집계 유효응답 26명: 일정 변경 22, 지도 재확인 14, 교통시간표 재확인 11, 일부 장소 포기 13. 최종 발표 전 숫자는 갱신한다. 익명 자유응답 한 문장으로 공감을 보강한다. 변경 이유를 항공편으로 해석하지 않는다."
    },
    {
      name: "SCENARO Reveal — 추천보다 조율",
      note: "사용자가 가고 싶은 곳을 정하고 씬나로가 실제 갈 수 있는 여행으로 맞춘다는 역할 분담을 한 문장으로 정의한다. 장소 하나가 바뀌면 전체를 다시 확인한다는 Wow Point를 예고한다."
    },
    {
      name: "Product Push-in",
      note: "두 번째 큰 카메라 이동. 지도 안 product preview가 실제 1280×720 productViewport와 같은 bounds에 정확히 도착한다. 최종 구현에서는 같은 캡처를 사용해 iframe과 cross-fade한다."
    },
    {
      name: "E2E Demo",
      note: "여기서부터 카메라는 멈춘다. 한번 실제 서비스에 들어가면 E2E가 끝날 때까지 나오지 않는다."
    },
    {
      name: "제품 위 설명 — 방금 본 결과는 어디서 왔나",
      note: "E2E 마지막 화면 그대로. 항공·철도·콘텐츠·관광 callout은 사용자가 이해하는 질문 형태로 설명한다. AI는 별도 챕터가 아니라 배우·작품 맥락 연결과 변경 결과 설명을 담당한다는 한 줄만 자연스럽게 노출한다."
    },
    {
      name: "제품 위 구현 증거",
      note: "별도 Proof 페이지를 만들지 않는다. 같은 제품 화면 하단에 구현/검증 수치 strip만 잠깐 보여준다."
    },
    {
      name: "Pull-out — Rail × Air 가치",
      note: "세 번째 큰 카메라 이동. 제품 화면이 지도 중심 쪽으로 축소·소멸하고 동시에 여행 경로가 그려지며 Rail × Air 가치로 이어진다."
    },
    {
      name: "Adoption & Expansion",
      note: "지도는 유지한다. 수익모델 대신 현재 MVP → 기관 진입점 → 전국 철도망/더 넓은 K-콘텐츠 순으로 확장만 보여준다."
    },
    {
      name: "Closing",
      note: "발표자는 삼행시를 읽지 않는다. 화면이 자동으로 내 → 일 → 로를 보여준 뒤 문구가 사라지고 SCENARO만 남긴다."
    }
  ];

  const stage = document.getElementById("stage");
  const viewport = document.getElementById("viewport");
  const productViewport = document.getElementById("productViewport");
  const productFrame = document.getElementById("productFrame");
  const appUrlLabel = document.getElementById("appUrlLabel");
  const sceneCount = document.getElementById("sceneCount");
  const sceneName = document.getElementById("sceneName");
  const progressBar = document.getElementById("progressBar");
  const liveRegion = document.getElementById("liveRegion");
  const notes = document.getElementById("notes");
  const notesTitle = document.getElementById("notesTitle");
  const notesBody = document.getElementById("notesBody");

  let current = 0;
  let notesVisible = false;
  let appRequested = false;

  function fit() {
    const scale = Math.min(innerWidth / 1920, innerHeight / 1080);
    const offsetX = (innerWidth - 1920 * scale) / 2;
    const offsetY = (innerHeight - 1080 * scale) / 2;
    stage.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
    viewport.style.setProperty("--fit-scale", String(scale));
  }

  function render({ replaceHash = false } = {}) {
    stage.dataset.state = String(current);
    const number = String(current + 1).padStart(2, "0");
    sceneCount.textContent = `${number} / ${STATES.length}`;
    sceneName.textContent = STATES[current].name;
    progressBar.style.width = `${((current + 1) / STATES.length) * 100}%`;
    notesTitle.textContent = `${number}. ${STATES[current].name}`;
    notesBody.textContent = STATES[current].note;
    liveRegion.textContent = `${current + 1}번째 상태, ${STATES[current].name}`;

    // 실제 제품은 demo와 post-demo 설명 동안 계속 유지된다.
    const productVisible = current >= 6 && current <= 8;
    productViewport.classList.toggle("is-visible", productVisible);
    productViewport.setAttribute("aria-hidden", productVisible ? "false" : "true");

    if (current === 6 && !appRequested) tryConnectApp();

    const hash = `#${current + 1}`;
    if (location.hash !== hash) {
      if (replaceHash) history.replaceState(null, "", hash);
      else history.pushState(null, "", hash);
    }
  }

  function go(next) {
    const target = Math.max(0, Math.min(STATES.length - 1, next));
    if (target === current) return;
    current = target;
    render();
  }

  function reset() {
    current = 0;
    productViewport.classList.remove("is-loaded");
    productFrame.removeAttribute("src");
    appRequested = false;
    render({ replaceHash: true });
  }

  async function toggleFullscreen() {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      else await document.exitFullscreen();
    } catch (_) {}
  }

  function togglePresentationMode() {
    document.body.classList.toggle("presentation-mode");
  }

  function toggleNotes() {
    notesVisible = !notesVisible;
    notes.classList.toggle("is-visible", notesVisible);
    notes.setAttribute("aria-hidden", notesVisible ? "false" : "true");
  }

  async function tryConnectApp() {
    appRequested = true;
    const appUrl = new URLSearchParams(location.search).get("app");
    appUrlLabel.textContent = appUrl || "http://localhost:3000";

    // Reference 검증 단계에서는 명시적으로 전달된 앱 주소가 없으면 fallback을 유지한다.
    if (!appUrl) return;

    // file://에서도 안전하게 실패하도록 iframe 로드를 직접 시도한다.
    productFrame.addEventListener("load", () => {
      productViewport.classList.add("is-loaded");
    }, { once: true });
    productFrame.addEventListener("error", () => {
      productViewport.classList.remove("is-loaded");
    }, { once: true });

    try {
      await fetch(appUrl, { mode: "no-cors", cache: "no-store" });
      productFrame.src = appUrl;
    } catch (_) {
      productViewport.classList.remove("is-loaded");
    }
  }

  document.addEventListener("click", (event) => {
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (action === "prev") go(current - 1);
    if (action === "next") go(current + 1);
  });

  addEventListener("keydown", (event) => {
    // iframe 내부에 포커스가 들어간 실제 시연 중에는 부모가 키를 받지 못할 수 있다.
    // 최종 통합 시 postMessage 또는 presenter hot-corner를 Codex가 연결한다.
    if (["ArrowRight", "PageDown", " "].includes(event.key)) {
      event.preventDefault();
      go(current + 1);
    } else if (["ArrowLeft", "PageUp"].includes(event.key)) {
      event.preventDefault();
      go(current - 1);
    } else if (event.key.toLowerCase() === "n") {
      toggleNotes();
    } else if (event.key.toLowerCase() === "p") {
      togglePresentationMode();
    } else if (event.key.toLowerCase() === "f") {
      toggleFullscreen();
    } else if (event.key.toLowerCase() === "r") {
      reset();
    }
  });

  addEventListener("resize", fit);
  addEventListener("hashchange", () => {
    const n = Number(location.hash.slice(1));
    if (Number.isInteger(n) && n >= 1 && n <= STATES.length) {
      current = n - 1;
      render({ replaceHash: true });
    }
  });

  const initial = Number(location.hash.slice(1));
  if (Number.isInteger(initial) && initial >= 1 && initial <= STATES.length) current = initial - 1;
  fit();
  render({ replaceHash: true });
})();
