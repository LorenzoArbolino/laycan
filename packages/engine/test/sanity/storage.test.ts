import { describe, expect, it } from "vitest";
import { Game } from "../../src/game";
import { listedMonths } from "../../src/market/futures";
import { MODEL } from "../../src/params/model";
import { crackOverlay, refreshCurve, type MarketConfig, type MarketState } from "../../src/market/market";
import { PRODUCTS } from "../../src/core/units";

/** Put every crack at its regime level (no basis), so the curve shape comes from Brent and stocks only. */
function settle(m: MarketState, cfg: MarketConfig) {
  for (const p of PRODUCTS) {
    m.crackFast[p] = 0;
    m.crackSlow[p] = cfg.crackMean[m.regime][p];
    m.cracks[p] = m.crackSlow[p] + crackOverlay(m, p, m.day);
  }
  refreshCurve(m, cfg);
}

/**
 * Hold 300 kbbl of diesel in a leased ARA tank, short the same barrels of ICE Gasoil three
 * months out. The curve shape comes from the state: Brent far below its regime level is
 * expected to recover (contango, as in 2020); far above it, to fall (backwardation).
 */
function carryTrade(regime: "stressed" | "war", brent: number) {
  const g = Game.create({ scenario: "normal_2025", seed: "carry" });
  g.cfg.freezeRegime = true;
  g.cfg.freezeChoke = true;
  g.market.regime = regime;
  g.market.brent = brent;
  for (const r of Object.keys(g.market.stocks) as (keyof typeof g.market.stocks)[]) g.market.stocks[r].diesel = 0;
  settle(g.market, g.cfg);
  const contango = -g.market.structure.diesel;
  g.act({ type: "lease", hub: "ARA", capacityBbl: 300_000, months: 3 });
  g.book.cargoes.push({ id: "C0", product: "diesel", qty: 298_000, hub: "ARA", where: "tank", qualityDiscount: 0, sinceDay: g.day });
  g.state.lastEquity = g.equity();
  const e0 = g.equity();
  const m = listedMonths("GO", g.day)[3]!;
  g.act({ type: "futures", contract: "GO", y: m.y, m: m.m, lots: -400 });
  for (let i = 0; i < 6; i++) g.advance();
  const a = g.state.attribution;
  return { contango, pnl: g.equity() - e0, timeSpread: a.time_spread.physical + a.time_spread.paper, flat: a.flat_price.physical + a.flat_price.paper };
}

describe("storage", () => {
  it("contango above the carry cost makes a hedged storage play profitable", () => {
    const r = carryTrade("stressed", 30);
    expect(r.contango).toBeGreaterThan(2);
    expect(r.pnl).toBeGreaterThan(0);
    expect(r.timeSpread).toBeGreaterThan(0);
    expect(Math.abs(r.flat)).toBeLessThan(1e5);
  });
  it("the same play loses money in backwardation", () => {
    const r = carryTrade("war", 150);
    expect(r.contango).toBeLessThan(-2);
    expect(r.pnl).toBeLessThan(0);
  });
  it("tank leases are take-or-pay", () => {
    const g = Game.create({ scenario: "normal_2025", seed: "lease" });
    g.cfg.freezeRegime = true;
    const fee = g.leaseQuote("ARA");
    g.act({ type: "lease", hub: "ARA", capacityBbl: 500_000, months: 1 });
    const e0 = g.equity();
    for (let i = 0; i < 10; i++) g.stepDay();
    const carry = g.state.attribution.time_spread.physical;
    expect(carry).toBeCloseTo(-(500_000 * fee * 10) / 30.4375, 0);
    expect(g.equity()).toBeLessThan(e0);
  });
  it("storage rents rise with contango", () => {
    const g = Game.create({ scenario: "normal_2025", seed: "rent" });
    const flat = g.leaseQuote("ARA");
    g.market.regime = "stressed";
    g.market.brent = 30;
    settle(g.market, g.cfg);
    expect(g.market.structure.diesel).toBeLessThan(-2);
    expect(g.leaseQuote("ARA")).toBeGreaterThan(flat * 1.5);
  });
  it("a spot sale from tank costs exactly the haircut against the index", () => {
    const g = Game.create({ scenario: "normal_2025", seed: "spot" });
    g.book.cargoes.push({ id: "C0", product: "gasoline", qty: 200_000, hub: "ARA", where: "tank", qualityDiscount: 0, sinceDay: g.day });
    const e0 = g.equity();
    const r = g.act({ type: "sellSpot", cargoId: "C0" });
    expect(r.ok).toBe(true);
    expect(g.equity() - e0).toBeCloseTo(-200_000 * MODEL.storage.spotSaleHaircut.value, 4);
    expect(g.book.cargoes).toHaveLength(0);
  });
  it("inventory surpluses put the curve in contango, deficits in backwardation", () => {
    const run = (stocks: number) => {
      const g = Game.create({ scenario: "normal_2025", seed: "stocks" });
      g.cfg.freezeRegime = true;
      for (const region of ["US", "EU", "WAF", "ME", "ASIA"] as const) g.market.stocks[region].diesel = stocks;
      settle(g.market, g.cfg);
      return g.market.structure.diesel - g.market.structure.brent;
    };
    // stocks revert towards normal, so the stock premium in the crack is expected to fade
    // (relative to the seasonal shape of the curve at the same date)
    const base = run(0);
    expect(run(15)).toBeLessThan(base - 0.3);
    expect(run(-15)).toBeGreaterThan(base + 0.3);
  });
});
