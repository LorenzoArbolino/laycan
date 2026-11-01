import { describe, expect, it } from "vitest";
import calibration from "../../../../params/calibration.json";
import { assumptionRows } from "../../src/params/assumptions";
import { MODEL, SCENARIOS } from "../../src/params/model";
import { findUnlabelled, isParam } from "../../src/params/param";
import { CHOKEPOINT_INFO, VESSELS } from "../../src/world/world";

describe("every parameter carries provenance", () => {
  it("calibration file: all numeric leaves are labelled params", () => {
    const bad = findUnlabelled(calibration, [], (p) => p[0] === "meta" || p.includes("order"));
    expect(bad).toEqual([]);
  });
  it("model, vessels, chokepoints and scenarios: no bare numbers", () => {
    const skip = (p: string[]) => p.includes("chokeShift") || p.includes("weeks");
    expect(findUnlabelled(VESSELS)).toEqual([]);
    expect(findUnlabelled(CHOKEPOINT_INFO)).toEqual([]);
    expect(findUnlabelled(MODEL, [], skip)).toEqual([]);
    for (const s of Object.values(SCENARIOS)) expect(findUnlabelled(s, [], skip)).toEqual([]);
  });
  it("rejects params without a source", () => {
    expect(isParam({ value: 1, unit: "x", label: "estimate", source: "", method: "m", date: "d" })).toBe(false);
  });
  it("assumptions sheet covers data, derived and estimate labels", () => {
    const rows = assumptionRows();
    expect(rows.length).toBeGreaterThan(200);
    for (const l of ["data", "derived", "estimate"]) expect(rows.some((r) => r.label === l)).toBe(true);
  });
});
