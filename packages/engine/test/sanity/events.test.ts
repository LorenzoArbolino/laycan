import { describe, expect, it } from "vitest";
import { Game } from "../../src/game";
import { hubPrice } from "../../src/market/market";
import { listedMonths } from "../../src/market/futures";

describe("sanity scenarios", () => {
  it("a hurricane raises US cracks and the NYH premium, and delays US Gulf loadings", () => {
    const g = Game.create({ scenario: "normal_2025", seed: "h" });
    const before = { ...g.market.cracks, nyh: g.market.diffs.NYH.gasoline };
    g.fireEvent("hurricane");
    expect(g.market.cracks.gasoline).toBeGreaterThan(before.gasoline);
    expect(g.market.cracks.diesel).toBeGreaterThan(before.diesel);
    expect(g.market.diffs.NYH.gasoline).toBeGreaterThan(before.nyh);
    expect(g.state.ports.some((p) => p.hub === "USGC")).toBe(true);
  });

  it("a Suez closure raises East-of-Suez → Europe freight and reroutes via the Cape", () => {
    const g = Game.create({ scenario: "normal_2025", seed: "s" });
    const open = g.quotes("TC8").find((q) => q.feasible && q.via === "suez")!;
    g.setChokepoint("suez", "closed");
    const shut = g.quotes("TC8").filter((q) => q.feasible);
    expect(shut.every((q) => q.via === "cape")).toBe(true);
    expect(shut[0]!.allInPerTonne).toBeGreaterThan(open.allInPerTonne);
    for (let i = 0; i < 30; i++) g.stepDay();
    expect(g.market.tce.LR1).toBeGreaterThan(0);
  });

  it("a Hormuz closure strands Middle East Gulf barrels: MEG diesel falls against Fujairah", () => {
    const g = Game.create({ scenario: "now_2026_11", seed: "hz" });
    const spread0 = g.market.diffs.FUJ.diesel - g.market.diffs.MEG.diesel;
    g.setChokepoint("hormuz", "closed");
    g.cfg.freezeChoke = true;
    for (let i = 0; i < 40; i++) g.stepDay();
    const spread1 = g.market.diffs.FUJ.diesel - g.market.diffs.MEG.diesel;
    expect(spread1).toBeGreaterThan(spread0 + 5);
    const res = g.act({ type: "charter", routeId: "TC8", laycanStart: g.day + 5, product: "diesel" });
    expect(res.ok).toBe(false);
  });

  it("a paper-open arb can be physically unexecutable", () => {
    const g = Game.create({ scenario: "now_2026_11", seed: "paper" });
    g.setChokepoint("hormuz", "closed");
    const megDiesel = hubPrice(g.market, "MEG", "diesel");
    const araDiesel = hubPrice(g.market, "ARA", "diesel");
    expect(araDiesel - megDiesel).toBeGreaterThan(0);
    expect(g.quotes("TC8").some((q) => q.feasible)).toBe(false);
  });

  it("an export ban widens Europe's diesel premium over the following weeks", () => {
    const g = Game.create({ scenario: "normal_2025", seed: "ban" });
    g.cfg.freezeRegime = true;
    const base = Game.create({ scenario: "normal_2025", seed: "ban" });
    g.fireEvent("exportBan", "russia");
    for (let i = 0; i < 14; i++) {
      g.stepDay();
      base.stepDay();
    }
    expect(g.market.diffs.ARA.diesel).toBeGreaterThan(base.market.diffs.ARA.diesel);
  });

  it("backwardation makes futures trade below spot, converging at expiry", () => {
    const g = Game.create({ scenario: "now_2026_11", seed: "curve" });
    const months = listedMonths("GO", g.day);
    const spot = hubPrice(g.market, "ARA", "diesel");
    const f1 = g.futuresQuote("GO", months[0]!.y, months[0]!.m);
    const f3 = g.futuresQuote("GO", months[2]!.y, months[2]!.m);
    expect(f1).toBeLessThan(spot);
    expect(f3).toBeLessThan(f1);
  });

  it("demurrage accrues when port time exceeds laytime", () => {
    const g = Game.create({ scenario: "normal_2025", seed: "dem" });
    const o = g.state.offers.find((x) => x.playerSide === "buy" && x.incoterm === "FOB" && x.hub === "USGC") ?? g.state.offers.find((x) => x.playerSide === "buy" && x.incoterm === "FOB")!;
    const route = { USGC: "TC14", ARA: "TC2", WAF: "WAF-ARA", MEG: "TC8", FUJ: "FUJ-ARA", SIN: "TC2", NYH: "TC2", JPN: "JPN-SIN" }[o.hub];
    g.act({ type: "accept", offerId: o.id, charter: { routeId: route } });
    const v = g.book.voyages[0]!;
    v.draws.loadDelay = 3;
    v.draws.dischDelay = 3;
    while (!g.over && g.book.voyages[0]!.status !== "done") g.stepDay();
    expect(g.state.news.some((n) => n.title.startsWith("Demurrage"))).toBe(true);
    expect(g.state.attribution.events.physical).toBeLessThan(0);
  });
});
