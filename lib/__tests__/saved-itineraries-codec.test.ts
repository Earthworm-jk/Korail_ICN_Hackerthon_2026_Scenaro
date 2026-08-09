import { describe, expect, it } from "vitest";
import { constraintsHash, entryToRow, rowToRecord } from "../saved-itineraries-codec";
import { SAVED_SCHEMA_VERSION } from "../saved-itineraries-stub";
import type { PlanRequest } from "../actions/itinerary";

// #25 §6 저장 계약 — 중복 판별 해시의 정규화·행 변환 왕복·깨진 행 거부

const constraints: PlanRequest = {
  arrivalAt: "2026-08-12T10:00:00+09:00",
  departureAt: "2026-08-14T18:00:00+09:00",
  airportReadyAt: "2026-08-12T12:00:00+09:00",
  airportArrivalDeadline: "2026-08-14T16:00:00+09:00",
  selectedActorIds: ["actor-kim-go-eun"],
  selectedWorkIds: [],
  excludedPlaceIds: ["place-a"],
};

const entry = {
  title: "강릉 2박 3일 · 김고은",
  days: [],
  constraints,
  schemaVersion: SAVED_SCHEMA_VERSION,
  snapshotVersion: "unversioned",
  context: { actors: [], works: [] },
  warnings: [],
};

describe("constraintsHash", () => {
  it("키 순서가 달라도 같은 값이면 같은 해시다 (정규화 직렬화)", () => {
    const reordered = JSON.parse(JSON.stringify(constraints, Object.keys(constraints).reverse()));
    expect(constraintsHash(reordered)).toBe(constraintsHash(constraints));
  });

  it("값이 다르면 해시가 다르다", () => {
    expect(constraintsHash({ ...constraints, excludedPlaceIds: [] }))
      .not.toBe(constraintsHash(constraints));
  });
});

describe("entryToRow / rowToRecord", () => {
  it("행 변환이 스키마 계약 버전을 명시 기록하고 왕복 시 레코드가 복원된다", () => {
    const row = entryToRow(entry, "user-1");
    expect(row.schema_version).toBe(SAVED_SCHEMA_VERSION); // 기본값 의존 금지 (supabase/README.md)
    expect(row.constraints_hash).toBe(constraintsHash(constraints));
    const record = rowToRecord({
      ...row,
      id: "row-1",
      created_at: "2026-08-09T12:00:00+09:00",
      updated_at: "2026-08-09T12:00:00+09:00",
    });
    expect(record).not.toBeNull();
    expect(record?.title).toBe(entry.title);
    expect(record?.constraints).toEqual(constraints);
    expect(record?.snapshotVersion).toBe("unversioned");
    expect(record?.warnings).toEqual([]);
  });

  it("구조가 깨진 행은 null — 재열람 사고 대신 목록에서 제외한다", () => {
    expect(rowToRecord({ id: "x", title: "t" })).toBeNull();
    expect(rowToRecord(null)).toBeNull();
    const row = entryToRow(entry, "user-1");
    expect(rowToRecord({ ...row, id: "x", created_at: "2026-08-09T12:00:00+09:00", itinerary: { days: "broken" } })).toBeNull();
  });
});
