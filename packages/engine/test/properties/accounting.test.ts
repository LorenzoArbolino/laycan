/**
 * Accounting properties. Equity is revalued from scratch every day; the attribution buckets
 * must explain every dollar of its change, whatever the player does.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { Game } from "../../src/game";
import { attributionTotal } from "../../src/book/types";
import { Rng } from "../../src/core/rng";
import { listedMonths } from "../../src/market/futures";
import { arbWeek, randomWeek } from "../strategies";

describe("accounting identities", () => {
  it("daily P&L attribution sums to the change in equity, for random play", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 8 }), fc.constantFrom("now_2026_11", "normal_2025"), (seed, scenario) => {
        const g = Game.create({ scenario, seed, weeks: 6 });
        const r = new Rng(`actions-${seed}`);
        while (!g.over) {
          randomWeek(g, r);
          g.advance();
        }
        const scale = Math.max(1e6, ...g.state.days.map((d) => Math.abs(d.equity)));
        for (const d of g.state.days) expect(Math.abs(d.residual)).toBeLessThan(1e-9 * scale);
        const cum = attributionTotal(g.state.attribution);
        expect(cum).toBeCloseTo(g.equity() - g.scenario.finance.equity.value, 2);
      }),
      { numRuns: 12 },
    );
  });

  it("a futures round trip at the same price loses exactly the fees", () => {
    const g = Game.create({ scenario: "normal_2025", seed: "rt" });
    const e0 = g.equity();
    const m = listedMonths("HO", g.day)[1]!;
    g.act({ type: "futures", contract: "HO", y: m.y, m: m.m, lots: 50 });
    g.act({ type: "futures", contract: "HO", y: m.y, m: m.m, lots: -50 });
    expect(g.equity() - e0).toBeCloseTo(-100 * 3, 6);
    expect(g.book.futures).toHaveLength(0);
  });

  it("a hedged cargo has (near) zero flat-price P&L", () => {
    const g = Game.create({ scenario: "normal_2025", seed: "hedge-flat" });
    // put a cargo of diesel in tank at NYH and short the same barrels of HO
    g.book.cargoes.push({ id: "C0", product: "diesel", qty: 300_000, hub: "NYH", where: "tank", qualityDiscount: 0, sinceDay: g.day });
    g.state.lastEquity = g.equity();
    const m = listedMonths("HO", g.day)[1]!;
    g.act({ type: "futures", contract: "HO", y: m.y, m: m.m, lots: -300 });
    for (let i = 0; i < 4; i++) g.advance();
    const a = g.state.attribution;
    const flat = a.flat_price.physical + a.flat_price.paper;
    const crack = a.crack.physical + a.crack.paper;
    expect(Math.abs(flat)).toBeLessThan(1);
    expect(Math.abs(crack)).toBeLessThan(1);
    expect(Math.abs(a.flat_price.physical)).toBeGreaterThan(1000);
  });

  it("variation margin hits cash daily: a correct position can still squeeze liquidity", () => {
    const g = Game.create({ scenario: "now_2026_11", seed: "squeeze" });
    const m = listedMonths("BRN", g.day)[1]!;
    const res = g.act({ type: "futures", contract: "BRN", y: m.y, m: m.m, lots: -3000 });
    expect(res.ok).toBe(true);
    const cashAfterMargin = g.book.cash;
    expect(cashAfterMargin).toBeLessThan(g.scenario.finance.equity.value);
    g.advance();
    expect(g.book.cash).not.toBeCloseTo(cashAfterMargin, 0);
  });
});

describe("determinism", () => {
  it("same seed and same actions give identical games", () => {
    const run = () => {
      const g = Game.create({ scenario: "now_2026_11", seed: "det" });
      while (!g.over) {
        arbWeek(g);
        g.advance();
      }
      return g.toJSON();
    };
    expect(run()).toBe(run());
  });

  it("player actions do not change the market path", () => {
    const passive = Game.create({ scenario: "now_2026_11", seed: "path" });
    const active = Game.create({ scenario: "now_2026_11", seed: "path" });
    const r = new Rng("x");
    while (!passive.over) {
      randomWeek(active, r);
      arbWeek(active);
      passive.advance();
      active.advance();
    }
    expect(active.state.history).toEqual(passive.state.history);
  });

  it("save and resume mid-game continues identically", () => {
    const a = Game.create({ scenario: "normal_2025", seed: "save" });
    const b = Game.create({ scenario: "normal_2025", seed: "save" });
    for (let w = 0; w < 4; w++) {
      arbWeek(a);
      a.advance();
      arbWeek(b);
      b.advance();
    }
    const c = Game.fromJSON(b.toJSON());
    while (!a.over) {
      arbWeek(a);
      a.advance();
      arbWeek(c);
      c.advance();
    }
    expect(c.toJSON()).toBe(a.toJSON());
  });
});
