import { describe, expect, it } from "vitest";
import { Game } from "../../src/game";
import { listedMonths } from "../../src/market/futures";
import { MODEL } from "../../src/params/model";

/** Hold 300 kbbl of diesel in a leased ARA tank, short the same barrels of ICE Gasoil three months out. */
function carryTrade(structure: number) {
  const g = Game.create({ scenario: "normal_2025", seed: "carry" });
  g.cfg.freezeRegime = true;
  g.cfg.freezeChoke = true;
  // hold the curve at the chosen shape for the test
  g.market.structure.diesel = structure;
  g.market.effects.push({ id: "test", target: { kind: "structure", key: "diesel" }, amount: structure - MODEL.structure.mean.normal.diesel.value, halfLifeDays: 1e6, startDay: g.day });
  g.market.stocks.diesel = 0;
  g.act({ type: "lease", hub: "ARA", capacityBbl: 300_000, months: 3 });
  g.book.cargoes.push({ id: "C0", product: "diesel", qty: 298_000, hub: "ARA", where: "tank", qualityDiscount: 0, sinceDay: g.day });
  g.state.lastEquity = g.equity();
  const e0 = g.equity();
  const m = listedMonths("GO", g.day)[3]!;
  g.act({ type: "futures", contract: "GO", y: m.y, m: m.m, lots: -400 });
  for (let i = 0; i < 6; i++) g.advance();
  const a = g.state.attribution;
  return { pnl: g.equity() - e0, timeSpread: a.time_spread.physical + a.time_spread.paper, flat: a.flat_price.physical + a.flat_price.paper };
}

describe("storage", () => {
  it("contango above the carry cost makes a hedged storage play profitable", () => {
    const r = carryTrade(-3);
    expect(r.pnl).toBeGreaterThan(0);
    expect(r.timeSpread).toBeGreaterThan(0);
    expect(Math.abs(r.flat)).toBeLessThan(1e5);
  });
  it("the same play loses money in backwardation", () => {
    expect(carryTrade(2).pnl).toBeLessThan(0);
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
    g.market.structure.diesel = -3;
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
  it("inventory surpluses push the curve towards contango", () => {
    const run = (stocks: number) => {
      const g = Game.create({ scenario: "normal_2025", seed: "stocks" });
      g.cfg.freezeRegime = true;
      g.market.effects.push({ id: "s", target: { kind: "stocks", product: "diesel" }, amount: stocks, halfLifeDays: 1e6, startDay: g.day });
      g.market.stocks.diesel = stocks;
      for (let i = 0; i < 120; i++) g.stepDay();
      return g.market.structure.diesel;
    };
    expect(run(15)).toBeLessThan(run(-15) - 2);
  });
});
