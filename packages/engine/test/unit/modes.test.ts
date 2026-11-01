import { describe, expect, it } from "vitest";
import { Game } from "../../src/game";
import { isoDate } from "../../src/core/calendar";
import { EPISODES, replayRows } from "../../src/params/episodes";
import { voyagePosition, routeGeometry } from "../../src/world/geo";
import { arbWeek } from "../strategies";

describe("generated markets", () => {
  it("are the default mode, labelled as fictional years, and seed-reproducible", () => {
    const a = Game.create({ seed: "gen-1" });
    const b = Game.create({ seed: "gen-1" });
    expect(a.scenario.kind).toBe("generated");
    expect(a.displayDate()).toMatch(/Year 1$/);
    expect(a.toJSON()).toBe(b.toJSON());
    expect(a.state.history.length).toBeGreaterThan(50);
  });
  it("differ across seeds", () => {
    const xs = ["s1", "s2", "s3", "s4", "s5"].map((s) => Game.create({ seed: s }).market.brent);
    expect(new Set(xs.map((x) => x.toFixed(2))).size).toBe(5);
  });
  it("start with an empty book and no P&L from the burn-in", () => {
    const g = Game.create({ seed: "burn" });
    expect(g.score().pnl).toBeCloseTo(0, 6);
    expect(g.state.days).toHaveLength(0);
  });
});

describe("historical replays", () => {
  for (const e of EPISODES) {
    it(`${e.id}: benchmark prices follow the EIA data exactly`, () => {
      const g = Game.create({ scenario: e.id, seed: "r" });
      while (!g.over) {
        arbWeek(g);
        g.advance();
      }
      const rows = new Map(replayRows(e.id).map((r) => [r.t, r]));
      let n = 0;
      for (const h of g.state.history) {
        const r = rows.get(isoDate(h.day));
        if (!r) continue;
        n++;
        expect(h.brent).toBe(r.b);
        expect(h.cracks.diesel).toBe(r.d);
        expect(h.diffs.NYH.gasoline).toBe(r.ng);
      }
      expect(n).toBeGreaterThan(80);
      expect(g.state.maxResidual).toBeLessThan(1e-4);
    });
  }
  it("scripted events fire on their dates", () => {
    const g = Game.create({ scenario: "uri_2021", seed: "s" });
    while (!g.over) g.advance();
    const t = g.state.news.find((n) => n.title.startsWith("Ever Given grounds"));
    expect(t && isoDate(t.day)).toBe("2021-03-23");
  });
});

describe("ship positions for the map", () => {
  it("a laden ship moves along its sea route", () => {
    const g = Game.create({ scenario: "normal_2025", seed: "ship" });
    const o = g.state.offers.find((x) => x.playerSide === "buy" && x.incoterm === "FOB" && x.hub === "USGC");
    const offer = o ?? g.state.offers.find((x) => x.playerSide === "buy" && x.incoterm === "FOB")!;
    const route = { USGC: "TC14", ARA: "TC2", WAF: "WAF-ARA", MEG: "TC8", FUJ: "FUJ-ARA", SIN: "TC2", NYH: "TC2" }[offer.hub];
    g.act({ type: "accept", offerId: offer.id, charter: { routeId: route } });
    const v = g.book.voyages[0]!;
    const seen: number[] = [];
    while (!g.over && v.status !== "done") {
      g.stepDay();
      if (v.status === "sailing") seen.push(voyagePosition(v, g.day).progress);
    }
    expect(seen.length).toBeGreaterThan(5);
    expect(seen.every((p, i) => i === 0 || p >= seen[i - 1]!)).toBe(true);
    expect(routeGeometry(route, v.via).length).toBeGreaterThan(10);
  });
});
