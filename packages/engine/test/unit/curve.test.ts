import { describe, expect, it } from "vitest";
import { parseDate } from "../../src/core/calendar";
import { PRODUCTS } from "../../src/core/units";
import { futuresPrice, cargoValue } from "../../src/book/valuation";
import { brentForward, hubForward } from "../../src/market/curve";
import { listedMonths } from "../../src/market/futures";
import { crackOverlay, hubPrice, initMarket, makeConfig, refreshCurve, type MarketConfig, type MarketState } from "../../src/market/market";
import { MODEL, SCENARIOS, type Regime } from "../../src/params/model";
import { Game } from "../../src/game";

function market(regime: Regime, brent: number, opts: { frozen?: boolean; date?: string } = {}): { m: MarketState; cfg: MarketConfig } {
  const sc = { ...SCENARIOS.normal_2025!, regime, startDate: opts.date ?? SCENARIOS.normal_2025!.startDate };
  const cfg = { ...makeConfig(sc), freezeRegime: opts.frozen ?? false };
  const m = initMarket(sc, cfg, parseDate(sc.startDate));
  m.brent = brent;
  // cracks at their regime level, no physical basis
  for (const p of PRODUCTS) {
    m.crackFast[p] = 0;
    m.crackSlow[p] = cfg.crackMean[regime][p];
    m.cracks[p] = m.crackSlow[p] + crackOverlay(m, p, m.day);
  }
  refreshCurve(m, cfg);
  return { m, cfg };
}

describe("forward curves", () => {
  it("start at spot and converge to spot at expiry", () => {
    const { m } = market("normal", 75);
    expect(hubForward(m, "NYH", "diesel", m.day)).toBe(hubPrice(m, "NYH", "diesel"));
    expect(brentForward(m, m.day)).toBe(m.brent);
    const k = listedMonths("HO", m.day)[0]!;
    const atExpiry = { ...m, day: k.expiry };
    expect(futuresPrice("HO", k.expiry, atExpiry)).toBeCloseTo(hubPrice(atExpiry, "NYH", "diesel"), 10);
  });

  it("are nearly flat at the regime level when the regime is known to stay", () => {
    const { m } = market("normal", MODEL.brent.level.normal.value, { frozen: true });
    expect(Math.abs(brentForward(m, m.day + 180) / m.brent - 1)).toBeLessThan(0.03);
  });

  it("price the regime chain: a war is expected to end, a crash to recover", () => {
    const war = market("war", MODEL.brent.level.war.value);
    expect(brentForward(war.m, war.m.day + 180)).toBeLessThan(war.m.brent - 2);
    const crash = market("stressed", 35);
    expect(brentForward(crash.m, crash.m.day + 180)).toBeGreaterThan(crash.m.brent + 5);
  });

  it("are backwardated in the November 2026 snapshot, diesel more than Brent", () => {
    const g = Game.create({ scenario: "now_2026_11", seed: "curve" });
    expect(g.market.structure.brent).toBeGreaterThan(0.5);
    expect(g.market.structure.diesel).toBeGreaterThan(g.market.structure.brent);
  });

  it("let a physical basis fade within weeks while the slow part persists", () => {
    const base = market("normal", 75, { frozen: true });
    const crackIn30 = (m: MarketState) => hubForward(m, "USGC", "diesel", m.day + 30) - brentForward(m, m.day + 30);
    const c0 = crackIn30(base.m);
    const fast = market("normal", 75, { frozen: true });
    fast.m.crackFast.diesel += 10;
    fast.m.cracks.diesel += 10;
    refreshCurve(fast.m, fast.cfg);
    const slow = market("normal", 75, { frozen: true });
    slow.m.crackSlow.diesel += 10;
    slow.m.cracks.diesel += 10;
    refreshCurve(slow.m, slow.cfg);
    expect(crackIn30(fast.m) - c0).toBeLessThan(3); // most of a basis spike is gone in a month
    expect(crackIn30(slow.m) - c0).toBeGreaterThan(8); // a fundamental move is not
  });

  it("carry the seasonal shape: gasoline is dearer for May than for February", () => {
    const { m } = market("normal", 75, { frozen: true, date: "2025-02-03" });
    const may = hubForward(m, "USGC", "gasoline", parseDate("2025-05-15")) - brentForward(m, parseDate("2025-05-15"));
    const now = hubForward(m, "USGC", "gasoline", m.day) - m.brent;
    expect(may).toBeGreaterThan(now + 1);
  });
});

describe("forward marks", () => {
  it("a cargo at sea is worth the destination's forward on its arrival date", () => {
    const { m } = market("war", 150);
    const c = { id: "C", product: "diesel" as const, qty: 300_000, hub: "ARA" as const, where: "vessel" as const, qualityDiscount: 0, sinceDay: m.day, markDay: m.day + 20 };
    expect(cargoValue(c, m)).toBeCloseTo(300_000 * hubForward(m, "ARA", "diesel", m.day + 20), 6);
    // in a backwardated market, the cargo is worth less than spot at the destination
    expect(cargoValue(c, m)).toBeLessThan(300_000 * hubPrice(m, "ARA", "diesel"));
    expect(cargoValue({ ...c, where: "tank", markDay: undefined }, m)).toBeCloseTo(300_000 * hubPrice(m, "ARA", "diesel"), 6);
  });
});
