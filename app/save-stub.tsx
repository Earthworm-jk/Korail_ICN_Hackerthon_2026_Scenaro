"use client";
/**
 * 저장 · 내 일정 목록 · 다시 열기.
 *
 * **기본 경로는 브라우저 로컬이다 (#118 §1).** 멘토링 이후 대표 데모는 로그인 없이 시작해서
 * 저장하고 다시 여는 흐름으로 확정됐다. 그래서 이 훅은 계정 상태와 무관하게 로컬에 저장하며,
 * 저장·목록에서 로그인 모달을 열지 않는다.
 *
 * 계정 경로(Supabase Auth + saved_itineraries, #25·#36·PR #74)는 **지우지 않았다.**
 * #118이 "선택적 클라우드 기능으로 유지"를 정했고, `?cloud=1`로 접속하면 예전 lazy login
 * 흐름이 그대로 살아난다. RLS 격리 검증도 그 경로에서 계속 유효하다.
 *
 * 이전의 in-memory 스텁(#35)은 사라졌다. 그 자리를 `lib/local-itineraries.ts`가 대신하며,
 * 이제 새로고침해도 남는다 — "세션 한정"이 더 이상 사실이 아니다.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { SavedItineraryStub } from "@/lib/saved-itineraries-stub";
import { getAccountStatus, signIn, signOutAccount, signUp } from "@/lib/actions/account";
import { listSavedItineraries, saveItinerary } from "@/lib/actions/saved-itineraries";
import { listLocalItineraries, saveLocalItinerary } from "@/lib/local-itineraries";
import { routeSaveIntent, routeTripsIntent, type StorageMode } from "@/lib/save-routing";
import type { MessageKey } from "@/lib/i18n/messages";

export type SaveStatus = "none" | "dirty" | "saved" | "error";
type AuthIntent = "save" | "trips";
type AuthKind = "signin" | "signup";
/** `local`이 기본이다. `supabase`는 `?cloud=1`로 명시적으로 켰고 env까지 설정된 경우만 */
type AccountMode = StorageMode;

/**
 * 클라우드 경로 옵트인.
 *
 * 화면에 토글을 만들지 않는 이유는 대표 데모 수용 기준이 "계정 로그인 UI가 나타나지 않음"
 * 이어서다. 검증이 필요할 때만 주소로 켠다.
 */
function cloudRequested(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return new URLSearchParams(window.location.search).get("cloud") === "1";
  } catch {
    return false;
  }
}

export function useSaveStub(onReopen: (saved: SavedItineraryStub) => void) {
  // 로컬은 비동기 확인이 필요 없다 — 초기값으로 정한다. effect에서 동기 setState를 하면
  // 첫 렌더가 두 번 도는 데다 lint(react-hooks/set-state-in-effect)가 막는다.
  const [mode, setMode] = useState<AccountMode>(() => (cloudRequested() ? "loading" : "local"));
  const [authenticated, setAuthenticated] = useState(false);
  const [authIntent, setAuthIntent] = useState<AuthIntent | null>(null); // null = 모달 닫힘
  const [authPending, setAuthPending] = useState(false);
  const [authFailed, setAuthFailed] = useState(false);
  const [tripsOpen, setTripsOpen] = useState(false);
  const [tripsLoadFailed, setTripsLoadFailed] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("none");
  // 서버 렌더에서는 저장소가 없어 빈 배열이 된다. 목록은 열기 전까지 그려지지 않으므로
  // 하이드레이션이 어긋날 DOM이 없다 (requestTrips가 열 때 다시 읽는다).
  const [saved, setSaved] = useState<SavedItineraryStub[]>(() =>
    cloudRequested() ? [] : listLocalItineraries(),
  );
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  /**
   * `?cloud=1`로 계정 상태를 확인하는 동안 누른 저장·목록 의도 (PR #123 리뷰 3).
   *
   * 확인 전에는 저장 위치를 알 수 없다. 그때 로컬로 흘려보내면 클라우드를 요청했는데
   * 로컬에 저장되고, 곧이어 mode만 supabase로 바뀌어 화면과 저장 위치가 어긋난다.
   * 그래서 실행하지 않고 여기 담아 뒀다가 확정된 mode로 처리한다.
   */
  const pendingIntent = useRef<
    { kind: "save"; entry: Omit<SavedItineraryStub, "id" | "savedAt"> } | { kind: "trips" } | null
  >(null);

  // 클라우드를 명시적으로 요청했을 때만 계정 상태를 확인한다. 확인이 실패하거나 env가
  // 없으면 로컬로 떨어져 저장 자체는 언제나 가능하다 (오프라인 데모 안전망).
  useEffect(() => {
    // 상태가 아니라 요청 자체를 다시 본다 — 이 값은 렌더 사이에 바뀌지 않으므로
    // 의존성이 늘지 않고, 로컬 모드에서는 계정 조회를 아예 하지 않는다.
    if (!cloudRequested()) return;
    let cancelled = false;
    getAccountStatus()
      .then((status) => {
        if (cancelled) return;
        if (!status.configured) {
          setMode("local");
          setSaved(listLocalItineraries());
          return;
        }
        setMode("supabase");
        setAuthenticated(status.authenticated);
      })
      .catch(() => {
        if (cancelled) return;
        setMode("local");
        setSaved(listLocalItineraries());
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshTrips = useCallback(async () => {
    const result = await listSavedItineraries();
    if (result.ok) {
      setSaved(result.records);
      setTripsLoadFailed(false);
    } else {
      setTripsLoadFailed(true);
    }
  }, []);

  const performSave = useCallback(async (entry: Omit<SavedItineraryStub, "id" | "savedAt">) => {
    if (mode === "supabase") {
      const result = await saveItinerary(entry);
      if (result.ok) {
        setSaved((list) => [result.record, ...list]);
        setSaveStatus("saved");
      } else if (result.reason === "UNAUTHENTICATED") {
        // 세션 만료 — 저장 의도를 유지한 채 다시 로그인 요청 (lazy login과 동일 흐름)
        setAuthenticated(false);
        setAuthIntent("save");
      } else {
        setSaveStatus("error");
      }
      return;
    }
    // 로컬 저장 — 쓰기가 실패하면 목록을 바꾸지 않고 오류로 알린다. 저장된 것처럼 보이는데
    // 다시 열면 없는 상태가 제일 나쁘다 (lib/local-itineraries.ts).
    const result = saveLocalItinerary(entry);
    if (!result.ok) {
      setSaveStatus("error");
      return;
    }
    setSaved(result.records);
    setSaveStatus("saved");
  }, [mode]);

  /** mode가 확정된 뒤의 저장 — 로컬은 로그인을 거치지 않고, 클라우드만 lazy login을 탄다 */
  const executeSave = useCallback(
    (entry: Omit<SavedItineraryStub, "id" | "savedAt">) => {
      if (routeSaveIntent(mode, authenticated) === "login") setAuthIntent("save");
      else void performSave(entry);
    },
    [mode, authenticated, performSave],
  );

  const executeTrips = useCallback(() => {
    const routing = routeTripsIntent(mode, authenticated);
    if (routing === "login") {
      setAuthIntent("trips");
      return;
    }
    setTripsOpen(true);
    if (routing === "cloud") void refreshTrips();
    else setSaved(listLocalItineraries()); // 다른 탭에서 저장한 것도 보이게 매번 다시 읽는다
  }, [authenticated, mode, refreshTrips]);

  // 계정 상태가 확정되면 그동안 눌러 둔 의도를 확정된 mode로 처리한다 (PR #123 리뷰 3)
  useEffect(() => {
    if (mode === "loading") return;
    const intent = pendingIntent.current;
    if (!intent) return;
    pendingIntent.current = null;
    if (intent.kind === "save") executeSave(intent.entry);
    else executeTrips();
  }, [mode, executeSave, executeTrips]);

  /**
   * 저장 버튼.
   *
   * 로컬 모드에서는 로그인을 거치지 않는다 — #118 수용 기준 "대표 데모에서 계정 로그인
   * UI가 나타나지 않음". `?cloud=1` 확인 중(`loading`)이면 저장 위치를 아직 모르므로
   * 실행하지 않고 큐에 둔다.
   */
  const requestSave = useCallback(
    (entry: Omit<SavedItineraryStub, "id" | "savedAt">) => {
      if (routeSaveIntent(mode, authenticated) === "queue") {
        pendingIntent.current = { kind: "save", entry };
        return;
      }
      executeSave(entry);
    },
    [mode, authenticated, executeSave],
  );

  const requestTrips = useCallback(() => {
    if (routeTripsIntent(mode, authenticated) === "queue") {
      pendingIntent.current = { kind: "trips" };
      return;
    }
    executeTrips();
  }, [mode, authenticated, executeTrips]);

  /** 로그인·회원가입 제출 — 성공 시 중단했던 동작(저장 또는 내 일정)을 이어간다 */
  const submitAuth = useCallback(
    async (
      kind: AuthKind,
      email: string,
      password: string,
      pendingEntry: Omit<SavedItineraryStub, "id" | "savedAt"> | null,
    ) => {
      const intent = authIntent;
      if (mode === "supabase") {
        setAuthPending(true);
        setAuthFailed(false);
        const result = kind === "signup" ? await signUp(email, password) : await signIn(email, password);
        setAuthPending(false);
        if (!result.ok) {
          setAuthFailed(true);
          return;
        }
      }
      setAuthenticated(true);
      setAuthIntent(null);
      setAuthFailed(false);
      if (intent === "save" && pendingEntry) void performSave(pendingEntry);
      if (intent === "trips") {
        setTripsOpen(true);
        if (mode === "supabase") void refreshTrips();
      }
    },
    [authIntent, mode, performSave, refreshTrips],
  );

  const logout = useCallback(() => {
    // 로컬 모드에는 로그아웃할 계정이 없다. 여기서 목록을 비우면 사용자가 저장한 일정을
    // 지운 것처럼 보이므로 창만 닫는다 — 실제 데이터는 브라우저에 그대로 남아 있다.
    if (mode !== "supabase") {
      setTripsOpen(false);
      return;
    }
    void signOutAccount();
    setAuthenticated(false);
    setTripsOpen(false);
    setSaved([]); // 계정 데이터는 화면에 남기지 않는다 — 다음 로그인 때 다시 조회
    setSaveStatus("none");
  }, [mode]);

  const reopen = useCallback(
    (id: string) => {
      const record = saved.find((s) => s.id === id);
      if (!record) return;
      setTripsOpen(false);
      setSaveStatus("saved");
      onReopen(record);
    },
    [saved, onReopen],
  );

  /** 편집·재계산으로 표시 일정이 바뀌었을 때 — 저장 이력이 있으면 미저장 변경 상태로 */
  const markDirty = useCallback(() => {
    setSaveStatus((status) => (status === "none" ? "none" : "dirty"));
  }, []);

  return {
    mode, authenticated, authIntent, authPending, authFailed,
    tripsOpen, tripsLoadFailed, saveStatus, saved, selectedTripId,
    requestSave, requestTrips, submitAuth, logout, reopen, markDirty,
    closeAuth: () => { setAuthIntent(null); setAuthFailed(false); },
    closeTrips: () => setTripsOpen(false),
    selectTrip: setSelectedTripId,
  };
}

function ModalBackdrop({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="max-h-[85vh] w-full max-w-md overflow-auto rounded-lg bg-sc-surface p-5 shadow-xl">
        {children}
      </div>
    </div>
  );
}

export function AuthModal({ intent, pending, failed, onSubmit, onClose, tr }: {
  intent: AuthIntent;
  /**
   * @deprecated in-memory 스텁이 사라져(#118 로컬 저장) 판정할 상태가 없다. 호출부
   * (`planner-wizard.tsx`, 레인 A)가 이 prop을 넘기는 동안만 타입에 남겨 둔다.
   */
  isStub?: boolean;
  pending: boolean;
  failed: boolean;
  onSubmit: (kind: AuthKind, email: string, password: string) => void;
  onClose: () => void;
  tr: (key: MessageKey) => string;
}) {
  // PR #74 리뷰 3: 데모 계정 정보를 저장소·UI 기본값에 하드코딩하지 않는다 — 시연 시 직접 입력
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  return (
    <ModalBackdrop onClose={onClose}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">{tr(intent === "save" ? "save.loginTitle" : "save.tripsLoginTitle")}</h3>
          <p className="mt-1 text-sm text-sc-muted">{tr("save.loginSubtitle")}</p>
        </div>
        <button className="rounded border px-2 py-1 text-sm" onClick={onClose} aria-label={tr("save.close")}>×</button>
      </div>
      <div className="mt-4 space-y-3">
        <label className="block text-sm font-medium">
          {tr("save.email")}
          <input
            className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="block text-sm font-medium">
          {tr("save.password")}
          <input
            className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
      </div>
      {failed && <p className="mt-2 text-sm text-sc-red">{tr("save.authFailed")}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button
          className="rounded border px-3 py-2 text-sm disabled:opacity-40"
          disabled={pending}
          onClick={() => onSubmit("signup", email, password)}
        >
          {intent === "save" ? tr("save.signupAndSave") : tr("save.signup")}
        </button>
        <button
          className="rounded bg-sc-blue px-3 py-2 text-sm text-white disabled:opacity-40"
          disabled={pending}
          onClick={() => onSubmit("signin", email, password)}
        >
          {pending ? tr("common.loading") : intent === "save" ? tr("save.loginAndSave") : tr("save.login")}
        </button>
      </div>
      {/* 스텁 배지 제거 — `save.stubBadge`("세션 한정")는 로컬 저장이 들어오면서 사실이
          아니게 됐다. 대체 문구는 messages.ts(레인 A) 몫이라 이 PR에서 만들지 않는다 */}
    </ModalBackdrop>
  );
}

export function TripsModal({ saved, selectedTripId, isStub, loadFailed, onSelect, onReopen, onLogout, onClose, tr }: {
  saved: SavedItineraryStub[];
  selectedTripId: string | null;
  /**
   * 호출부(`planner-wizard.tsx`)가 `mode !== "supabase"`를 넘긴다. 스텁이 사라진 지금 이
   * 값의 실제 의미는 **"계정 경로가 아니다" = 로컬 모드**다 (PR #123 리뷰 1).
   *
   * @deprecated 이름이 의미와 어긋난다. `planner-wizard.tsx`는 레인 A 소유라 이 PR에서
   * 고치지 않는다. 후속에서 `isCloud`(또는 `storage`)로 바꾸고 여기 분기를 뒤집을 것.
   */
  isStub?: boolean;
  loadFailed: boolean;
  onSelect: (id: string) => void;
  onReopen: (id: string) => void;
  onLogout: () => void;
  onClose: () => void;
  tr: (key: MessageKey) => string;
}) {
  const selected = saved.find((s) => s.id === selectedTripId) ?? saved[0] ?? null;
  return (
    <ModalBackdrop onClose={onClose}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">{tr("trips.title")}</h3>
          <p className="mt-1 text-sm text-sc-muted">{tr("trips.subtitle")}</p>
        </div>
        <button className="rounded border px-2 py-1 text-sm" onClick={onClose} aria-label={tr("save.close")}>×</button>
      </div>
      {loadFailed && (
        <p className="mt-3 rounded border border-sc-red/30 bg-sc-red/5 p-2 text-sm text-sc-red">
          {tr("trips.loadError")}
        </p>
      )}
      {saved.length === 0 ? (
        !loadFailed && <p className="mt-4 text-sm text-sc-muted/70">{tr("trips.empty")}</p>
      ) : (
        <div className="mt-4 space-y-2">
          {saved.map((s) => (
            <button
              key={s.id}
              className={`block w-full rounded border px-3 py-2 text-left text-sm ${selected?.id === s.id ? "border-sc-blue bg-sc-blue-soft" : ""}`}
              aria-pressed={selected?.id === s.id}
              onClick={() => onSelect(s.id)}
            >
              <span className="font-medium">{s.title}</span>
              <span className="mt-0.5 block text-xs text-sc-muted">
                {tr("trips.savedAt")} {new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(s.savedAt))}
              </span>
            </button>
          ))}
          {selected && (
            <button
              className="w-full rounded bg-sc-blue px-3 py-2 text-sm text-white"
              onClick={() => onReopen(selected.id)}
            >
              {tr("trips.reopen")}
            </button>
          )}
        </div>
      )}
      {/* 로컬 모드에는 로그인한 계정이 없다. "로그아웃"을 보여주면 로그인한 적 없는
          사용자가 계정이 있다고 오해하고, 눌러도 창만 닫혀 의미가 어긋난다 (PR #123 리뷰 1) */}
      {!isStub && (
        <div className="mt-4 flex justify-end">
          <button className="rounded border px-3 py-2 text-sm" onClick={onLogout}>{tr("trips.logout")}</button>
        </div>
      )}
    </ModalBackdrop>
  );
}
