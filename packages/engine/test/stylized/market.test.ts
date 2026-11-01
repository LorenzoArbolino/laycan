/**
 * Stylized facts: simulated paths are compared with statistics of the historical data
 * (params/targets.json, computed by calibration/fit.py from EIA daily prices).
 */
import { describe, expect, it } from "vitest";
import targets from "../../../../params/targets.json" with { type: "json" };
import { MODEL } from "../../src/params/model";
import { acf, ar1HalfLife, corr, excessKurtosis, simulate, parity } from "./helpers";

const normal = simulate({ scenario: "normal_2025", regime: "normal", years: 25, seed: "stylized-normal" });
const war = simulate({ scenario: "now_2026_11", regime: "war", years: 10, seed: "stylized-war" });
const logret = (rows: typeof normal) => rows.slice(1).map((r, i) => Math.log(r.brent / rows[i]!.brent));

describe("Brent", () => {
  const r = logret(normal);
  it("has fat tails (excess kurtosis above the historical floor)", () => {
    expect(excessKurtosis(r)).toBeGreaterThan(targets.brent.excess_kurtosis_min);
  });
  it("shows volatility clustering (positive autocorrelation of squared returns)", () => {
    const sq = r.map((x) => x * x);
    const mean = [1, 2, 3, 4, 5].reduce((s, k) => s + acf(sq, k), 0) / 5;
    expect(mean).toBeGreaterThan(0.03);
  });
  it("annualised volatility is close to history in the normal regime", () => {
    const sd = Math.sqrt(r.reduce((s, x) => s + x * x, 0) / r.length) * Math.sqrt(252);
    expect(sd).toBeGreaterThan(targets.brent.annual_vol_normal * 0.6);
    expect(sd).toBeLessThan(targets.brent.annual_vol_normal * 1.5);
  });
  it("is markedly more volatile in the war regime", () => {
    const sd = (x: number[]) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);
    expect(sd(logret(war)) / sd(r)).toBeGreaterThan(1.5);
  });
});

describe("cracks", () => {
  for (const p of ["gasoline", "diesel", "jet"] as const) {
    it(`${p} crack mean-reverts with a half-life near history`, () => {
      const hl = ar1HalfLife(normal.map((x) => x.cracks[p]));
      const hist = targets.cracks[p].half_life_days;
      expect(hl).toBeGreaterThan(hist * 0.4);
      expect(hl).toBeLessThan(hist * 2.5);
    });
  }
  it("gasoline is seasonally stronger in summer than in winter", () => {
    const byMonth = (mo: number) => {
      const xs = normal.filter((r) => new Date(r.day * 864e5).getUTCMonth() + 1 === mo).map((r) => r.cracks.gasoline);
      return xs.reduce((a, b) => a + b, 0) / xs.length;
    };
    expect(Math.sign(byMonth(6) - byMonth(12))).toBe(targets.cracks.gasoline.season_sign_jun_minus_dec);
  });
  it("crack changes are correlated as in history (normal regime)", () => {
    const d = (p: "gasoline" | "diesel" | "jet") => normal.slice(1).map((r, i) => r.cracks[p] - normal[i]!.cracks[p]);
    const hist = MODEL.correlation.normal.value;
    expect(Math.abs(corr(d("diesel"), d("jet")) - hist[2]![3]!)).toBeLessThan(0.15);
  });
  it("war-regime cracks reach today's levels: diesel above $60 most of the time", () => {
    const share = war.filter((r) => r.cracks.diesel > 60).length / war.length;
    expect(share).toBeGreaterThan(0.7);
  });
});

describe("regional spreads are bounded by freight, except in shocks", () => {
  it("ARA diesel stays below the US Gulf + freight arb bound almost always (normal regime)", () => {
    let inside = 0,
      n = 0;
    simulate({
      scenario: "normal_2025",
      regime: "normal",
      years: 5,
      seed: "arb-band",
      onDay: (m, cfg) => {
        const par = parity(m, cfg, "ARA", "diesel");
        if (!par || par.bound === null) return;
        n++;
        if (m.diffs.ARA.diesel <= par.bound + 1) inside++;
      },
    });
    expect(inside / n).toBeGreaterThan(targets.regional.diesel.containment_normal - 0.05);
  });
  it("NYH-USGC spreads mean-revert with a half-life of days, as in data", () => {
    const hl = ar1HalfLife(normal.map((r) => r.diffs.NYH.diesel));
    expect(hl).toBeLessThan(targets.regional.diesel.half_life_days * 2.5);
    expect(hl).toBeGreaterThan(targets.regional.diesel.half_life_days * 0.3);
  });
});
