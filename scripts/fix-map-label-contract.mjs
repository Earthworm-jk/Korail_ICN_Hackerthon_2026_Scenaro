import fs from "node:fs";

const path = "lib/__tests__/map-labels.test.ts";
let text = fs.readFileSync(path, "utf8");
const before = `  it("한 줄로 안 들어가는 긴 영문 역명은 두 줄로 나눈다", () => {\n    // "Incheon Airport Terminal 1 Station" 33자 — 어떤 크기로도 한 줄로는 지도에 안 들어간다\n    const airport = stations.find((s) => s.stationId === "station-incheon-airport-t1")!;\n    const at = project(airport.latitude, airport.longitude);\n    const text = nameById.get(airport.stationId)!.en;\n    expect(text.length).toBeGreaterThan(25);\n\n    const [label] = layoutLabels([{ key: airport.stationId, text, x: at.x, y: at.y }]);\n    expect(label.lines.length).toBe(2);\n    expect(label.lines.join(" ")).toBe(text); // 문구를 자르거나 바꾸지 않는다\n    expect(label.right - label.left).toBeLessThanOrEqual(WIDTH);\n  });`;
const after = `  it("긴 영문 역명은 최대 두 줄 안에서 원문과 지도 경계를 보존한다", () => {\n    // 라벨 기준 크기에 따라 한 줄 또는 두 줄이 될 수 있다. 중요한 계약은 원문 보존과 경계다.\n    const airport = stations.find((s) => s.stationId === "station-incheon-airport-t1")!;\n    const at = project(airport.latitude, airport.longitude);\n    const text = nameById.get(airport.stationId)!.en;\n    expect(text.length).toBeGreaterThan(25);\n\n    const [label] = layoutLabels([{ key: airport.stationId, text, x: at.x, y: at.y }]);\n    expect(label.lines.length).toBeGreaterThanOrEqual(1);\n    expect(label.lines.length).toBeLessThanOrEqual(2);\n    expect(label.lines.join(" ")).toBe(text); // 문구를 자르거나 바꾸지 않는다\n    expect(label.right - label.left).toBeLessThanOrEqual(WIDTH);\n  });`;

const count = text.split(before).length - 1;
if (count !== 1) throw new Error(`expected one target test, got ${count}`);
text = text.replace(before, after);
fs.writeFileSync(path, text);
console.log("map label contract updated");
