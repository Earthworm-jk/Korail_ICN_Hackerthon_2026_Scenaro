"use client";
/**
 * lazy login 저장 모달 + 내 일정 목록·상세·다시 열기 (#14 ver.0.4 확정 §1·§4, #25).
 *
 * 8/11 슬롯: Supabase Auth + saved_itineraries 실연결. 화면 계약(상태 전이)은 스텁(#35)과
 * 동일하며, env 미설정이면 기존 in-memory 스텁으로 폴백하고 스텁 배지를 단다 —
 * 오프라인 데모 안전망. 실연결 모드에서는 모든 인증·저장이 서버 액션으로 재검증된다(#36).
 */
import { useCallback, useEffect, useState } from "react";
import type { SavedItineraryStub } from "@/lib/saved-itineraries-stub";
import { getAccountStatus, signIn, signOutAccount, signUp } from "@/lib/actions/account";
import { listSavedItineraries, saveItinerary } from "@/lib/actions/saved-itineraries";
import type { MessageKey } from "@/lib/i18n/messages";

export type SaveStatus = "none" | "dirty" | "saved" | "error";
type AuthIntent = "save" | "trips";
type AuthKind = "signin" | "signup";
type AccountMode = "loading" | "supabase" | "stub";

export function useSaveStub(onReopen: (saved: SavedItineraryStub) => void) {
  const [mode, setMode] = useState<AccountMode>("loading");
  const [authenticated, setAuthenticated] = useState(false);
  const [authIntent, setAuthIntent] = useState<AuthIntent | null>(null); // null = 모달 닫힘
  const [authPending, setAuthPending] = useState(false);
  const [authFailed, setAuthFailed] = useState(false);
  const [tripsOpen, setTripsOpen] = useState(false);
  const [tripsLoadFailed, setTripsLoadFailed] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("none");
  const [saved, setSaved] = useState<SavedItineraryStub[]>([]);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);

  // 세션 복원 — 서버 재검증 결과만 신뢰한다. 실패하면 스텁 폴백(오프라인 데모)
  useEffect(() => {
    let cancelled = false;
    getAccountStatus()
      .then((status) => {
        if (cancelled) return;
        setMode(status.configured ? "supabase" : "stub");
        setAuthenticated(status.configured ? status.authenticated : false);
      })
      .catch(() => {
        if (!cancelled) setMode("stub");
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
    const record: SavedItineraryStub = {
      ...entry,
      id: `stub-${Date.now()}`,
      savedAt: new Date().toISOString(),
    };
    setSaved((list) => [record, ...list]);
    setSaveStatus("saved");
  }, [mode]);

  /** 저장 버튼 — 미인증이면 lazy login 모달을 열고, 인증 후 중단한 저장을 이어서 완료한다 */
  const requestSave = useCallback(
    (entry: Omit<SavedItineraryStub, "id" | "savedAt">) => {
      if (authenticated) void performSave(entry);
      else setAuthIntent("save");
    },
    [authenticated, performSave],
  );

  const requestTrips = useCallback(() => {
    if (!authenticated) {
      setAuthIntent("trips");
      return;
    }
    setTripsOpen(true);
    if (mode === "supabase") void refreshTrips();
  }, [authenticated, mode, refreshTrips]);

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
    if (mode === "supabase") void signOutAccount();
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

export function AuthModal({ intent, isStub, pending, failed, onSubmit, onClose, tr }: {
  intent: AuthIntent;
  isStub: boolean; // 스텁 폴백 모드 — 배지 표시, 입력값 검증 없음
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
      {isStub && <p className="mt-3 text-xs text-sc-orange">{tr("save.stubBadge")}</p>}
    </ModalBackdrop>
  );
}

export function TripsModal({ saved, selectedTripId, isStub, loadFailed, onSelect, onReopen, onLogout, onClose, tr }: {
  saved: SavedItineraryStub[];
  selectedTripId: string | null;
  isStub: boolean;
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
      <div className="mt-4 flex justify-between">
        <span className="self-center text-xs text-sc-orange">{isStub ? tr("save.stubBadge") : ""}</span>
        <button className="rounded border px-3 py-2 text-sm" onClick={onLogout}>{tr("trips.logout")}</button>
      </div>
    </ModalBackdrop>
  );
}
