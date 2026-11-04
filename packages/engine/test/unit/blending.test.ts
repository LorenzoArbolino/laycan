import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { solveLP } from "../../src/blending/lp";
import { COMPONENTS, blendQuality, checkSpec, componentPrices, gradeFor, optimalRecipe, recipeCost } from "../../src/blending/blend";
import { Game } from "../../src/game";
import { parseDate } from "../../src/core/calendar";

describe("linear programming", () => {
  it("solves a textbook problem", () => {
    // max 3x + 5y st x ≤ 4, 2y ≤ 12, 3x + 2y ≤ 18  ->  x=2, y=6, value 36
    const r = solveLP({ c: [-3, -5], aUb: [[1, 0], [0, 2], [3, 2]], bUb: [4, 12, 18] });
    expect(r.status).toBe("optimal");
    if (r.status === "optimal") {
      expect(r.x[0]).toBeCloseTo(2, 9);
      expect(r.x[1]).toBeCloseTo(6, 9);
      expect(-r.value).toBeCloseTo(36, 9);
    }
  });
  it("handles equalities and ≥ constraints, and detects infeasibility", () => {
    const r = solveLP({ c: [1, 1], aUb: [[-1, 0]], bUb: [-2], aEq: [[1, 1]], bEq: [5] });
    expect(r.status === "optimal" && r.value).toBeCloseTo(5, 9);
    expect(solveLP({ c: [1], aUb: [[1]], bUb: [1], aEq: [[1]], bEq: [3] }).status).toBe("infeasible");
  });
  it("never beats a brute-force grid on random 2-variable problems", () => {
    fc.assert(
      fc.property(fc.array(fc.double({ min: -5, max: 5, noNaN: true }), { minLength: 2, maxLength: 2 }), fc.double({ min: 1, max: 10, noNaN: true }), (c, cap) => {
        const r = solveLP({ c, aUb: [[1, 1], [1, 0], [0, 1]], bUb: [cap, cap, cap] });
        if (r.status !== "optimal") return;
        let best = Infinity;
        for (let i = 0; i <= 50; i++) for (let j = 0; j <= 50 - i; j++) best = Math.min(best, c[0]! * (i / 50) * cap + c[1]! * (j / 50) * cap);
        // the solver treats reduced costs within 1e-9 of zero as optimal: allow that per unit of x
        expect(r.value).toBeLessThanOrEqual(best + 1e-9 * (1 + 2 * cap));
      }),
    );
  });
});

describe("gasoline blending", () => {
  const g = Game.create({ scenario: "normal_2025", seed: "blend" });
  for (const hub of ["ARA", "USGC"] as const) {
    for (const date of ["2026-01-15", "2026-07-15"]) {
      it(`${hub} ${date}: the optimal recipe is on spec and no single feasible component beats it`, () => {
        const m = { ...g.market, day: parseDate(date) };
        const grade = gradeFor(hub, m.day);
        const prices = componentPrices(m, hub);
        const r = optimalRecipe(prices, grade)!;
        expect(r).not.toBeNull();
        const sum = COMPONENTS.reduce((s, c) => s + r[c], 0);
        expect(sum).toBeCloseTo(1, 9);
        expect(checkSpec(blendQuality(r), grade).every((x) => x.ok)).toBe(true);
        const cost = recipeCost(r, prices);
        for (const c of COMPONENTS) {
          const single = { [c]: 1 };
          if (checkSpec(blendQuality(single), grade).every((x) => x.ok)) expect(cost).toBeLessThanOrEqual(recipeCost(single, prices) + 1e-9);
        }
      });
    }
  }
  it("summer vapour-pressure limits squeeze butane out of the blend", () => {
    const m = (d: string) => ({ ...g.market, day: parseDate(d) });
    const w = optimalRecipe(componentPrices(m("2026-01-15"), "ARA"), gradeFor("ARA", parseDate("2026-01-15")))!;
    const s = optimalRecipe(componentPrices(m("2026-07-15"), "ARA"), gradeFor("ARA", parseDate("2026-07-15")))!;
    expect(s.butane).toBeLessThan(w.butane);
  });
  it("blending needs leased tank space and books the margin to the quality bucket", () => {
    const game = Game.create({ scenario: "normal_2025", seed: "blend2" });
    expect(game.act({ type: "blend", hub: "ARA", volumeBbl: 200_000 }).ok).toBe(false);
    game.act({ type: "lease", hub: "ARA", capacityBbl: 300_000, months: 2 });
    const q = game.blendQuote("ARA");
    const e0 = game.equity();
    const r = game.act({ type: "blend", hub: "ARA", volumeBbl: 200_000 });
    expect(r.ok).toBe(true);
    expect(game.equity() - e0).toBeCloseTo(200_000 * q.margin, 2);
    expect(game.state.pending.quality.physical).toBeCloseTo(200_000 * q.margin, 2);
    expect(game.tankStock("ARA")).toBe(200_000);
  });
  it("an off-spec recipe produces a discounted batch", () => {
    const game = Game.create({ scenario: "normal_2025", seed: "blend3" });
    game.act({ type: "lease", hub: "ARA", capacityBbl: 300_000, months: 2 });
    const r = game.act({ type: "blend", hub: "ARA", volumeBbl: 100_000, recipe: { lvn: 0.6, butane: 0.4 } });
    expect(r.message).toContain("OFF-SPEC");
    expect(game.book.cargoes[0]!.qualityDiscount).toBeGreaterThan(2);
  });
});
