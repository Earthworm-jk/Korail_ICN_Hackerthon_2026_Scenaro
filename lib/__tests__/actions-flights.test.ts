import { beforeEach, describe, expect, it, vi } from "vitest";
import { getFlightInfo } from "../actions/flights";
import { flightMode } from "../env";
import { lookupLiveFlight } from "../adapters/flights-live";

// #46 테스트 체크리스트의 Action 흐름 분기 — 어댑터·env는 모듈 mock으로 대체
vi.mock("../env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../env")>()),
  flightMode: vi.fn(() => "snapshot" as const),
}));
vi.mock("../adapters/flights-live", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../adapters/flights-live")>()),
  lookupLiveFlight: vi.fn(),
}));

const mockedMode = vi.mocked(flightMode);
const mockedLookup = vi.mocked(lookupLiveFlight);

beforeEach(() => {
  mockedMode.mockReset().mockReturnValue("snapshot");
  mockedLookup.mockReset();
});

describe("getFlightInfo 분기 (#46)", () => {
  it("키 없음(snapshot 모드) → 외부 호출 없이 스냅샷", async () => {
    const result = await getFlightInfo("SAMPLE-ARRIVAL-001", "arrival", "2026-08-12");
    expect(mockedLookup).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true, source: "snapshot" });
  });

  it("live 정상 응답 → 정규화된 FlightInfo + source live", async () => {
    mockedMode.mockReturnValue("live");
    mockedLookup.mockResolvedValue({
      ok: true,
      flight: {
        flightNo: "KE852", direction: "arrival",
        scheduledAt: "2026-08-12T21:40:00+09:00", estimatedAt: "2026-08-12T21:40:00+09:00",
        status: undefined, terminal: "T2",
      },
    });
    const result = await getFlightInfo("KE852", "arrival", "2026-08-12T10:00");
    expect(mockedLookup).toHaveBeenCalledWith("KE852", "arrival", "20260812");
    expect(result).toMatchObject({ ok: true, source: "live" });
  });

  it("타임아웃·네트워크·파싱 오류 → 스냅샷 폴백 적중", async () => {
    mockedMode.mockReturnValue("live");
    mockedLookup.mockRejectedValue(new Error("aborted"));
    const result = await getFlightInfo("SAMPLE-ARRIVAL-001", "arrival", "2026-08-12");
    expect(result).toMatchObject({ ok: true, source: "snapshot" });
  });

  // PR #47 리뷰(차단): 데모 편명은 실조회·오프라인 폴백이 같은 편·같은 날짜로 성립해야 한다 (#46 완료 기준)
  // 데모 입국편 AF264(에어프랑스 파리발, 8/12 09:35 실측) — 지연 시 KTX 13:55→16:11로 밀리는
  // 재계산 서사가 가능하도록 아침 도착편으로 선정 (KE852 21:40은 지연 효과가 화면에 안 보임)
  it("데모 편명 AF264 — live 오류(네트워크 단절) 시 스냅샷 폴백이 적중하고 날짜가 데모 조회일과 같다", async () => {
    mockedMode.mockReturnValue("live");
    mockedLookup.mockRejectedValue(new Error("network unreachable"));
    const result = await getFlightInfo("AF264", "arrival", "2026-08-12");
    expect(result).toMatchObject({
      ok: true,
      source: "snapshot",
      flight: { flightNo: "AF264", direction: "arrival", scheduledAt: "2026-08-12T09:35:00+09:00" },
    });
    // 폴백이 요청 날짜와 다른 날의 시각으로 입국일을 덮어쓰지 않는다 (PR #47 리뷰)
    if (result.ok) expect(result.flight.scheduledAt.startsWith("2026-08-12")).toBe(true);
  });

  it("데모 편명 AF264 — 키 제거(snapshot 모드)에서도 외부 호출 없이 같은 날짜로 조회된다", async () => {
    const result = await getFlightInfo("AF264", "arrival", "2026-08-12");
    expect(mockedLookup).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true, source: "snapshot" });
    if (result.ok) expect(result.flight.scheduledAt.startsWith("2026-08-12")).toBe(true);
  });

  it("오류 폴백인데 스냅샷에도 없으면 FLIGHT_NOT_FOUND — 직접 입력 유지", async () => {
    mockedMode.mockReturnValue("live");
    mockedLookup.mockRejectedValue(new Error("aborted"));
    const result = await getFlightInfo("ZZ999", "arrival", "2026-08-12");
    expect(result).toEqual({ ok: false, reason: "FLIGHT_NOT_FOUND" });
  });

  it("live 200 + 편명 없음 → 스냅샷 확인 없이 FLIGHT_NOT_FOUND (오류 폴백과 구분)", async () => {
    mockedMode.mockReturnValue("live");
    mockedLookup.mockResolvedValue({ ok: false, reason: "NOT_FOUND" });
    // 스냅샷에 존재하는 편명이라도 live가 '없다'고 답하면 미검색으로 구분한다
    const result = await getFlightInfo("SAMPLE-ARRIVAL-001", "arrival", "2026-08-12");
    expect(result).toEqual({ ok: false, reason: "FLIGHT_NOT_FOUND" });
  });

  it("날짜가 없으면 live 모드여도 호출하지 않고 스냅샷만 본다 (searchday 필수)", async () => {
    mockedMode.mockReturnValue("live");
    const result = await getFlightInfo("SAMPLE-ARRIVAL-001", "arrival");
    expect(mockedLookup).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true, source: "snapshot" });
  });
});
