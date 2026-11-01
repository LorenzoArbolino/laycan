import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { bblPerTonne, bblToTonnes, perBblToPerTonne, perTonneToPerBbl, productBblPerTonne, tonnesToBbl } from "../../src/core/units";

describe("units from grade density", () => {
  it("diesel converts at ~7.45 bbl/t (the ICE Gasoil contract basis)", () => {
    expect(productBblPerTonne("diesel")).toBeCloseTo(7.44, 2);
  });
  it("gasoline ~8.45 bbl/t and jet ~7.86 bbl/t", () => {
    expect(productBblPerTonne("gasoline")).toBeCloseTo(8.44, 1);
    expect(productBblPerTonne("jet")).toBeCloseTo(7.86, 1);
  });
  it("lighter products have more barrels per tonne", () => {
    expect(bblPerTonne(0.72)).toBeGreaterThan(bblPerTonne(0.85));
  });
  it("tonnes <-> barrels and $/t <-> $/bbl round-trip", () => {
    fc.assert(
      fc.property(fc.double({ min: 1, max: 1e6, noNaN: true }), fc.constantFrom("gasoline", "diesel", "jet" as const), (x, p) => {
        expect(bblToTonnes(tonnesToBbl(x, p), p)).toBeCloseTo(x, 6);
        expect(perTonneToPerBbl(perBblToPerTonne(x, p), p)).toBeCloseTo(x, 6);
      }),
    );
  });
});
