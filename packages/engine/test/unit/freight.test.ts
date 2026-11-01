import { describe, expect, it } from "vitest";
import { bestQuote, quoteRoute } from "../../src/market/freight";
import { freightInputs, initMarket, makeConfig } from "../../src/market/market";
import { SCENARIOS } from "../../src/params/model";
import { parseDate } from "../../src/core/calendar";

const sc = SCENARIOS.now_2026_11!;
const cfg = makeConfig(sc);
const m = initMarket(sc, cfg, parseDate(sc.startDate));
const f = freightInputs(m, cfg);

// Optima Shipbroking clean tanker summary, 19-20 Oct 2026 (public): $/t on Baltic route definitions
const reported: Record<string, number> = { TC2: 29.12, TC14: 86.78 * (38 / 37), TC19: 53.85, TC8: 245.17 };

describe("bottom-up freight reproduces reported route rates", () => {
  for (const [route, rate] of Object.entries(reported)) {
    it(`${route} within 10% of the reported rate`, () => {
      const q = bestQuote(route, f);
      expect(Math.abs(q.allInPerTonne / rate - 1)).toBeLessThan(0.1);
    });
  }
  it("bunker cost is linear in Brent", () => {
    const a = bestQuote("TC14", f);
    const b = bestQuote("TC14", { ...f, brent: f.brent + 10 });
    const c = bestQuote("TC14", { ...f, brent: f.brent + 20 });
    expect(c.bunkers - b.bunkers).toBeCloseTo(b.bunkers - a.bunkers, 6);
  });
  it("a Suez closure forces the Cape: longer and dearer", () => {
    const open = bestQuote("TC8", f);
    const shut = bestQuote("TC8", { ...f, choke: { ...f.choke, suez: "closed" } });
    expect(open.via).toBe("suez");
    expect(shut.via).toBe("cape");
    expect(shut.ladenDays).toBeGreaterThan(open.ladenDays + 10);
    expect(shut.allInPerTonne).toBeGreaterThan(open.allInPerTonne);
  });
  it("a Hormuz closure makes Middle East Gulf loadings infeasible but not Fujairah", () => {
    const shut = { ...f, choke: { ...f.choke, hormuz: "closed" as const } };
    expect(quoteRoute("TC8", shut).every((q) => !q.feasible)).toBe(true);
    expect(bestQuote("FUJ-ARA", shut).feasible).toBe(true);
  });
  it("restricted chokepoints add war-risk premiums", () => {
    const calm = bestQuote("TC8", { ...f, choke: { hormuz: "open", babelmandeb: "open", suez: "open" } });
    const war = bestQuote("TC8", f);
    expect(war.warRiskUsd).toBeGreaterThan(calm.warRiskUsd * 5);
  });
});
