/**
 * No free lunch, futures: the curves are the model's own expectation of future spot, so a
 * long position held in the second listed month and rolled earns nothing in any regime.
 * (Before the curves were made consistent, the war regime paid ~$4.8/bbl/month on HO.)
 */
import { describe, expect, it } from "vitest";
import { parseDate } from "../../src/core/calendar";
import { Rng } from "../../src/core/rng";
import { futuresPrice } from "../../src/book/valuation";
import { FUTURES_IDS, listedMonths } from "../../src/market/futures";
import { initMarket, makeConfig, stepMarket } from "../../src/market/market";
import { SCENARIOS, type Regime } from "../../src/params/model";
import { mean, se } from "./nfl-helpers";

/** Daily changes of the second listed contract, held and rolled, in $/bbl. */
function rollChanges(regime: Regime | "switching", seeds: number, days: number): Record<string, number[]> {
  const out: Record<string, number[]> = Object.fromEntries(FUTURES_IDS.map((k) => [k, []]));
  for (let s = 0; s < seeds; s++) {
    const sc = { ...SCENARIOS.now_2026_11!, regime: regime === "switching" ? "normal" : regime };
    const cfg = { ...makeConfig(sc), freezeRegime: regime !== "switching", freezeChoke: true };
    const m = initMarket(sc, cfg, parseDate(sc.startDate));
    const rng = Rng.stream(`roll-${regime}-${s}`, "market");
    for (let d = 0; d < days; d++) {
      const held = FUTURES_IDS.map((c) => {
        const k = listedMonths(c, m.day)[1]!;
        return { c, expiry: k.expiry, F: futuresPrice(c, k.expiry, m) };
      });
      stepMarket(m, cfg, rng);
      for (const h of held) out[h.c]!.push(futuresPrice(h.c, h.expiry, m) - h.F);
    }
  }
  return out;
}

describe("no free lunch: futures", () => {
  for (const regime of ["normal", "stressed", "war", "switching"] as const) {
    it(`rolling long futures earns nothing on average (${regime})`, () => {
      const ch = rollChanges(regime, 12, 180);
      for (const c of FUTURES_IDS) {
        const x = ch[c]!;
        const perMonth = mean(x) * 30.4;
        expect(Math.abs(mean(x)), `${c} ${regime}: ${perMonth.toFixed(2)} $/bbl/month`).toBeLessThan(Math.max(3 * se(x), 0.15 / 30.4));
      }
    });
  }
});
