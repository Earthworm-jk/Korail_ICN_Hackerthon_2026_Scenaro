import { beforeEach, describe, expect, it } from "vitest";
import {
  AirportApiError,
  clearLiveFlightCache,
  lookupLiveFlight,
  parseAirportDateTime,
  pickFlight,
  serviceKeyVariants,
  terminalLabel,
  type LiveFlightRecord,
} from "../adapters/flights-live";

// API_SPEC 2.1 — 실호출 1건 어댑터. 네트워크는 주입 fetch로 대체한다.

describe("serviceKeyVariants — 단일 발급 키의 Encoding/Decoding 양형 시도 (포털 안내)", () => {
  it("%를 포함하면 원형(인코딩형) 우선, 디코딩형 후순위", () => {
    expect(serviceKeyVariants("abc%2Bdef")).toEqual(["abc%2Bdef", "abc+def"]);
  });
  it("평문 키는 원형 우선, 인코딩형 후순위", () => {
    expect(serviceKeyVariants("abc+def")).toEqual(["abc+def", "abc%2Bdef"]);
  });
  it("잘못된 % 시퀀스는 원형만 시도한다", () => {
    expect(serviceKeyVariants("abc%zzdef")).toEqual(["abc%zzdef"]);
  });
});

describe("parseAirportDateTime — KST yyyyMMddHHmm", () => {
  it("정상 값은 +09:00 ISO로 변환한다", () => {
    expect(parseAirportDateTime("202608080025")).toBe("2026-08-08T00:25:00+09:00");
  });
  it("형식 밖 값은 null", () => {
    expect(parseAirportDateTime("2026-08-08")).toBeNull();
    expect(parseAirportDateTime(undefined)).toBeNull();
  });
});

describe("pickFlight — 편명 매칭 (실측 스키마: 코드셰어 접미사·다일자)", () => {
  const record = (over: Partial<LiveFlightRecord>): LiveFlightRecord => ({
    flightId: "KE852",
    scheduleDateTime: "202608081200",
    codeshare: "Master",
    ...over,
  });

  it("정확 일치를 접미사 일치보다 우선한다", () => {
    const records = [record({ flightId: "KE852Y" }), record({ flightId: "KE852" })];
    expect(pickFlight(records, "ke852")?.flightId).toBe("KE852");
  });
  it("정확 일치가 없으면 코드셰어 접미사 한 글자를 허용한다 (KE852 → KE852Y)", () => {
    expect(pickFlight([record({ flightId: "KE852Y" })], "KE852")?.flightId).toBe("KE852Y");
  });
  it("여러 날짜면 Master 우선 → 예정 시각 오름차순 첫 건 — 결정적", () => {
    const records = [
      record({ scheduleDateTime: "202608101200", codeshare: "Slave" }),
      record({ scheduleDateTime: "202608091200" }),
      record({ scheduleDateTime: "202608081200" }),
    ];
    expect(pickFlight(records, "KE852")?.scheduleDateTime).toBe("202608081200");
  });
  it("무관 편명·빈 입력은 null", () => {
    expect(pickFlight([record({})], "OZ102")).toBeNull();
    expect(pickFlight([record({})], "  ")).toBeNull();
  });
});

describe("terminalLabel", () => {
  it("P01/P02/P03을 사용자 표기로 바꾸고 미지정 코드는 원형 유지", () => {
    expect(terminalLabel("P01")).toBe("T1");
    expect(terminalLabel("P03")).toBe("T2");
    expect(terminalLabel("P09")).toBe("P09");
    expect(terminalLabel(undefined)).toBeUndefined();
  });
});

describe("lookupLiveFlight — 주입 fetch로 호출 경로 검증", () => {
  beforeEach(() => clearLiveFlightCache());

  const KEY = "test%2Bkey"; // env는 모듈 로드 시 파싱되므로 키는 deps로 주입한다

  const payload = (records: unknown[], code = "00", msg = "NORMAL SERVICE.") => ({
    ok: true,
    status: 200,
    json: async () => ({ response: { header: { resultCode: code, resultMsg: msg }, body: { items: records } } }),
  });

  it("성공 시 FlightInfo로 정규화한다 (예정·변경 시각, 상태, 터미널)", async () => {
    const result = await lookupLiveFlight("KE852", "arrival", "20260812", {
      serviceKey: KEY,
      fetchImpl: async () => payload([
        { flightId: "KE852Y", scheduleDateTime: "202608120025", estimatedDateTime: "202608120105", remark: "지연", terminalid: "P03", codeshare: "Master" },
      ]),
    });
    expect(result).toEqual({
      ok: true,
      flight: {
        flightNo: "KE852", direction: "arrival",
        scheduledAt: "2026-08-12T00:25:00+09:00", estimatedAt: "2026-08-12T01:05:00+09:00",
        status: "지연", terminal: "T2",
      },
    });
  });

  it("인증키 오류면 반대 형태 키로 1회 재시도한다", async () => {
    const usedKeys: string[] = [];
    const result = await lookupLiveFlight("KE852", "arrival", "20260812", {
      serviceKey: KEY,
      fetchImpl: async (url) => {
        const key = new URL(url).search.match(/serviceKey=([^&]*)/)![1];
        usedKeys.push(key);
        if (usedKeys.length === 1) {
          return payload([], "30", "SERVICE KEY IS NOT REGISTERED ERROR.");
        }
        return payload([{ flightId: "KE852", scheduleDateTime: "202608120025" }]);
      },
    });
    expect(result.ok).toBe(true);
    expect(usedKeys).toHaveLength(2);
    expect(usedKeys[0]).not.toBe(usedKeys[1]);
  });

  it("키 오류가 아닌 API 오류는 재시도 없이 throw — 호출부 스냅샷 폴백 경로", async () => {
    let calls = 0;
    await expect(
      lookupLiveFlight("KE852", "arrival", "20260812", {
        serviceKey: KEY,
        fetchImpl: async () => { calls += 1; return payload([], "22", "LIMITED NUMBER OF SERVICE REQUESTS EXCEEDS"); },
      }),
    ).rejects.toBeInstanceOf(AirportApiError);
    expect(calls).toBe(1);
  });

  it("타임아웃이면 throw — 5초 예산은 시도 전체에 하나로 적용", async () => {
    await expect(
      lookupLiveFlight("KE852", "arrival", "20260812", {
        serviceKey: KEY,
        timeoutMs: 20,
        fetchImpl: (_url, { signal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(new Error("aborted")));
          }),
      }),
    ).rejects.toThrow();
  });

  it("searchday·flight_id 필터를 쿼리에 싣는다 (#46 상세조회 계약)", async () => {
    let seenUrl = "";
    await lookupLiveFlight("ke852", "arrival", "20260812", {
      serviceKey: KEY,
      fetchImpl: async (url) => { seenUrl = url; return payload([{ flightId: "KE852", scheduleDateTime: "202608120025" }]); },
    });
    expect(seenUrl).toContain("StatusOfPassengerFlightsDeOdp/getPassengerArrivalsDeOdp");
    expect(seenUrl).toContain("searchday=20260812");
    expect(seenUrl).toContain("flight_id=KE852");
  });

  it("200 + 빈 결과는 오류가 아니라 NOT_FOUND — 폴백과 구분 (#46)", async () => {
    const result = await lookupLiveFlight("ZZ999", "arrival", "20260812", {
      serviceKey: KEY,
      fetchImpl: async () => payload([]),
    });
    expect(result).toEqual({ ok: false, reason: "NOT_FOUND" });
  });

  it("편명·날짜별로 캐시해 같은 조회는 fetch를 다시 부르지 않는다", async () => {
    let calls = 0;
    const deps = {
      serviceKey: KEY,
      fetchImpl: async () => { calls += 1; return payload([{ flightId: "KE852", scheduleDateTime: "202608120025" }]); },
    };
    await lookupLiveFlight("KE852", "arrival", "20260812", deps);
    const cachedAgain = await lookupLiveFlight("KE852", "arrival", "20260812", deps);
    const other = await lookupLiveFlight("KE076", "arrival", "20260812", deps);
    expect(cachedAgain.ok).toBe(true); // 같은 편·같은 날 재조회는 캐시
    expect(calls).toBe(2); // 다른 편명은 별도 호출
    expect(other).toEqual({ ok: false, reason: "NOT_FOUND" });
  });
});
