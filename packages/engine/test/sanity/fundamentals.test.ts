import { describe, expect, it } from "vitest";
import { Game } from "../../src/game";

/** Run a game twice from the same seed, with and without a shock, and compare. */
function compare(shock: (g: Game) => void, days: number) {
  const base = Game.create({ scenario: "normal_2025", seed: "fund" });
  const hit = Game.create({ scenario: "normal_2025", seed: "fund" });
  base.cfg.freezeRegime = hit.cfg.freezeRegime = true;
  shock(hit);
  for (let i = 0; i < days; i++) {
    base.stepDay();
    hit.stepDay();
  }
  return { base: base.market, hit: hit.market };
}

describe("fundamentals: shocks propagate through utilisation and stocks", () => {
  it("a hurricane cuts US refinery runs, draws US stocks and lifts US cracks over the following weeks", () => {
    const { base, hit } = compare((g) => g.fireEvent("hurricane"), 20);
    expect(hit.util.US).toBeLessThan(base.util.US);
    expect(hit.stocks.US.diesel).toBeLessThan(base.stocks.US.diesel);
    expect(hit.stocks.US.gasoline).toBeLessThan(base.stocks.US.gasoline);
    expect(hit.cracks.gasoline).toBeGreaterThan(base.cracks.gasoline);
  });
  it("a Russian export ban drains European diesel stocks and widens Europe's premium", () => {
    const { base, hit } = compare((g) => g.fireEvent("exportBan", "russia"), 30);
    expect(hit.stocks.EU.diesel).toBeLessThan(base.stocks.EU.diesel - 1);
    expect(hit.diffs.ARA.diesel).toBeGreaterThan(base.diffs.ARA.diesel);
  });
  it("a short region pulls in cargoes: barrels move from its suppliers, they are not created", () => {
    const g = Game.create({ scenario: "normal_2025", seed: "short" });
    g.cfg.freezeRegime = true;
    g.market.stocks.EU.diesel = -20;
    const prem0 = g.market.diffs.ARA.diesel;
    for (let i = 0; i < 10; i++) g.stepDay();
    const premEarly = g.market.diffs.ARA.diesel;
    let supplierMin = 0;
    for (let i = 0; i < 200; i++) {
      g.stepDay();
      supplierMin = Math.min(supplierMin, g.market.stocks.WAF.diesel, g.market.stocks.ME.diesel);
    }
    expect(premEarly).toBeGreaterThan(prem0); // shortage priced in
    expect(g.market.stocks.EU.diesel).toBeGreaterThan(-17); // partly refilled
    expect(supplierMin).toBeLessThan(-5); // ... by drawing down the regions that ship to it
  });
  it("replays use real US utilisation (Winter Storm Uri)", () => {
    const g = Game.create({ scenario: "uri_2021", seed: "u" });
    let min = 0;
    for (let i = 0; i < 25; i++) {
      g.stepDay();
      min = Math.min(min, g.market.util.US);
    }
    expect(min).toBeLessThan(-15);
  });
});
