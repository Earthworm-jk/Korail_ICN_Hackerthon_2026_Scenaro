"use client";
/**
 * lazy login 저장 모달 + 내 일정 목록·상세·다시 열기 스텁 (#14 ver.0.4 확정 §1·§4, #25).
 * 인증·저장은 in-memory — Supabase Auth + saved_itineraries 연결 시 이 훅의 내부 구현만
 * 실제 액션 호출로 바뀌고 화면 계약(상태 전이)은 유지된다. 화면에는 스텁 배지를 항상 단다.
 */
import { useCallback, useState } from "react";
import type { SavedItineraryStub } from "@/lib/saved-itineraries-stub";
import type { MessageKey } from "@/lib/i18n/messages";

export type SaveStatus = "none" | "dirty" | "saved" | "error";
type AuthIntent = "save" | "trips";

export function useSaveStub(onReopen: (saved: SavedItineraryStub) => void) {
  const [authenticated, setAuthenticated] = useState(false);
  const [authIntent, setAuthIntent] = useState<AuthIntent | null>(null); // null = 모달 닫힘
  const [tripsOpen, setTripsOpen] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("none");
  const [saved, setSaved] = useState<SavedItineraryStub[]>([]);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);

  const performSave = useCallback((entry: Omit<SavedItineraryStub, "id" | "savedAt">) => {
    const record: SavedItineraryStub = {
      ...entry,
      id: `stub-${Date.now()}`,
      savedAt: new Date().toISOString(),
    };
    setSaved((list) => [record, ...list]);
    setSaveStatus("saved");
  }, []);

  /** 저장 버튼 — 미인증이면 lazy login 모달을 열고, 인증 후 중단한 저장을 이어서 완료한다 */
  const requestSave = useCallback(
    (entry: Omit<SavedItineraryStub, "id" | "savedAt">) => {
      if (authenticated) performSave(entry);
      else setAuthIntent("save");
    },
    [authenticated, performSave],
  );

  const requestTrips = useCallback(() => {
    if (authenticated) setTripsOpen(true);
    else setAuthIntent("trips");
  }, [authenticated]);

  /** 로그인·회원가입 완료 — 중단했던 동작(저장 또는 내 일정)을 이어간다 */
  const finishAuth = useCallback(
    (pendingEntry: Omit<SavedItineraryStub, "id" | "savedAt"> | null) => {
      setAuthenticated(true);
      const intent = authIntent;
      setAuthIntent(null);
      if (intent === "save" && pendingEntry) performSave(pendingEntry);
      if (intent === "trips") setTripsOpen(true);
    },
    [authIntent, performSave],
  );

  const logout = useCallback(() => {
    setAuthenticated(false);
    setTripsOpen(false);
  }, []);

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
    authenticated, authIntent, tripsOpen, saveStatus, saved, selectedTripId,
    requestSave, requestTrips, finishAuth, logout, reopen, markDirty,
    closeAuth: () => setAuthIntent(null),
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
      <div className="max-h-[85vh] w-full max-w-md overflow-auto rounded-lg bg-white p-5 shadow-xl">
        {children}
      </div>
    </div>
  );
}

export function AuthModal({ intent, onFinish, onClose, tr }: {
  intent: AuthIntent;
  onFinish: () => void;
  onClose: () => void;
  tr: (key: MessageKey) => string;
}) {
  return (
    <ModalBackdrop onClose={onClose}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">{tr(intent === "save" ? "save.loginTitle" : "save.tripsLoginTitle")}</h3>
          <p className="mt-1 text-sm text-gray-500">{tr("save.loginSubtitle")}</p>
        </div>
        <button className="rounded border px-2 py-1 text-sm" onClick={onClose} aria-label={tr("save.close")}>×</button>
      </div>
      <div className="mt-4 space-y-3">
        <label className="block text-sm font-medium">
          {tr("save.email")}
          <input className="mt-1 w-full rounded border px-2 py-1.5 text-sm" type="email" defaultValue="demo@scenaro.kr" />
        </label>
        <label className="block text-sm font-medium">
          {tr("save.password")}
          <input className="mt-1 w-full rounded border px-2 py-1.5 text-sm" type="password" defaultValue="demo1234" />
        </label>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button className="rounded border px-3 py-2 text-sm" onClick={onFinish}>
          {intent === "save" ? tr("save.signupAndSave") : tr("save.login")}
        </button>
        <button className="rounded bg-blue-600 px-3 py-2 text-sm text-white" onClick={onFinish}>
          {intent === "save" ? tr("save.loginAndSave") : tr("save.login")}
        </button>
      </div>
      <p className="mt-3 text-xs text-amber-700">{tr("save.stubBadge")}</p>
    </ModalBackdrop>
  );
}

export function TripsModal({ saved, selectedTripId, onSelect, onReopen, onLogout, onClose, tr }: {
  saved: SavedItineraryStub[];
  selectedTripId: string | null;
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
          <p className="mt-1 text-sm text-gray-500">{tr("trips.subtitle")}</p>
        </div>
        <button className="rounded border px-2 py-1 text-sm" onClick={onClose} aria-label={tr("save.close")}>×</button>
      </div>
      {saved.length === 0 ? (
        <p className="mt-4 text-sm text-gray-400">{tr("trips.empty")}</p>
      ) : (
        <div className="mt-4 space-y-2">
          {saved.map((s) => (
            <button
              key={s.id}
              className={`block w-full rounded border px-3 py-2 text-left text-sm ${selected?.id === s.id ? "border-blue-600 bg-blue-50" : ""}`}
              aria-pressed={selected?.id === s.id}
              onClick={() => onSelect(s.id)}
            >
              <span className="font-medium">{s.title}</span>
              <span className="mt-0.5 block text-xs text-gray-500">
                {tr("trips.savedAt")} {new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(s.savedAt))}
              </span>
            </button>
          ))}
          {selected && (
            <button
              className="w-full rounded bg-blue-600 px-3 py-2 text-sm text-white"
              onClick={() => onReopen(selected.id)}
            >
              {tr("trips.reopen")}
            </button>
          )}
        </div>
      )}
      <div className="mt-4 flex justify-between">
        <span className="self-center text-xs text-amber-700">{tr("save.stubBadge")}</span>
        <button className="rounded border px-3 py-2 text-sm" onClick={onLogout}>{tr("trips.logout")}</button>
      </div>
    </ModalBackdrop>
  );
}
