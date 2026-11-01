import { describe, expect, it } from "vitest";
import { Game } from "../../src/game";
import { voyagePosition } from "../../src/world/geo";

function ladenTC14(seed: string) {
  const g = Game.create({ scenario: "normal_2025", seed });
  const o = g.state.offers.find((x) => x.playerSide === "buy" && x.incoterm === "FOB" && x.hub === "USGC")!;
  g.act({ type: "accept", offerId: o.id, charter: { routeId: "TC14" } });
  const v = g.book.voyages[0]!;
  while (v.status !== "sailing") g.stepDay();
  g.stepDay();
  g.stepDay();
  return { g, v };
}

describe("diversions at sea", () => {
  it("lists alternative destinations with costs and price gains", () => {
    const { g, v } = ladenTC14("div-1");
    const opts = g.diversionOptions(v.id);
    expect(opts.map((o) => o.to)).toEqual(expect.arrayContaining(["NYH", "WAF"]));
    for (const o of opts) expect(o.costUsd).toBeGreaterThan(0);
  });
  it("diverting re-marks the cargo (optionality), charges deviation (freight) and changes the ETA", () => {
    const { g, v } = ladenTC14("div-2");
    const opt = g.diversionOptions(v.id).find((o) => o.to === "WAF")!;
    const c = g.book.cargoes.find((x) => x.id === v.cargoId)!;
    const e0 = g.equity();
    const opt0 = g.state.pending.optionality.physical;
    const r = g.act({ type: "divert", voyageId: v.id, to: "WAF" });
    expect(r.ok).toBe(true);
    expect(v.to).toBe("WAF");
    expect(c.hub).toBe("WAF");
    expect(g.state.pending.optionality.physical - opt0).toBeCloseTo(c.qty * opt.priceGainPerBbl, 2);
    expect(g.equity() - e0).toBeCloseTo(c.qty * opt.priceGainPerBbl - opt.costUsd, 2);
    expect(v.arriveDisch).toBe(g.day + Math.ceil(opt.remainingDays));
  });
  it("a diverted ship continues from where it is (no jump on the map)", () => {
    const { g, v } = ladenTC14("div-5");
    const before = voyagePosition(v, g.day).at;
    g.act({ type: "divert", voyageId: v.id, to: "WAF" });
    const after = voyagePosition(v, g.day).at;
    expect(after[0]).toBeCloseTo(before[0], 6);
    expect(after[1]).toBeCloseTo(before[1], 6);
  });
  it("the ship keeps moving along the new path and discharges at the new hub", () => {
    const { g, v } = ladenTC14("div-3");
    g.act({ type: "divert", voyageId: v.id, to: "NYH" });
    const p0 = voyagePosition(v, g.day).progress;
    let last = p0;
    while (v.status === "sailing") {
      g.stepDay();
      if (v.status === "sailing") {
        const p = voyagePosition(v, g.day).progress;
        expect(p).toBeGreaterThanOrEqual(last);
        last = p;
      }
    }
    while (v.status !== "done") g.stepDay();
    expect(g.book.cargoes.some((c) => c.hub === "NYH" && c.where === "tank")).toBe(true);
    expect(g.state.maxResidual).toBeLessThan(1e-4);
  });
  it("a closed chokepoint blocks diversions that need it", () => {
    const g = Game.create({ scenario: "normal_2025", seed: "div-4" });
    const o = g.state.offers.find((x) => x.playerSide === "buy" && x.incoterm === "FOB" && x.hub === "WAF") ?? null;
    if (!o) return;
    g.act({ type: "accept", offerId: o.id, charter: { routeId: "WAF-ARA" } });
    const v = g.book.voyages[0]!;
    while (v.status !== "sailing") g.stepDay();
    g.setChokepoint("suez", "closed");
    const sin = g.diversionOptions(v.id).find((x) => x.to === "SIN");
    if (sin) expect(sin.feasible).toBe(true); // WAF → SIN goes round the Cape
    const meg = g.diversionOptions(v.id).find((x) => x.to === "MEG")!;
    g.setChokepoint("hormuz", "closed");
    expect(g.diversionOptions(v.id).find((x) => x.to === "MEG")!.feasible).toBe(false);
    void meg;
  });
});
