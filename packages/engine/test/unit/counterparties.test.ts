import { describe, expect, it } from "vitest";
import { Game } from "../../src/game";
import { Rng } from "../../src/core/rng";
import { ROSTER, defaultProbability, emptyRelations, makeOffer, negotiate, reservation, tenderCompetition, type Tender } from "../../src/agents/counterparties";

const g = Game.create({ scenario: "normal_2025", seed: "cp" });
const ctx = { regime: "normal" as const, relations: emptyRelations() };

describe("counterparties", () => {
  it("credit risk rises as ratings fall and in stress", () => {
    const by = (r: string) => ROSTER.find((c) => c.rating === r)!;
    expect(defaultProbability(by("A"), "normal")).toBeLessThan(defaultProbability(by("BBB"), "normal"));
    expect(defaultProbability(by("BB"), "normal")).toBeLessThan(defaultProbability(by("B"), "normal"));
    expect(defaultProbability(by("B"), "stressed")).toBeGreaterThan(defaultProbability(by("B"), "normal"));
  });
  it("long regions offer cheaper, short regions bid higher", () => {
    const c = ROSTER.find((x) => x.id === "rhine")!;
    const t = { side: "buy" as const, product: "gasoline" as const, hub: "ARA" as const };
    const m = structuredClone(g.market);
    m.stocks.EU.gasoline = 15;
    const long = reservation(c, t, m, 0);
    m.stocks.EU.gasoline = -15;
    const short = reservation(c, t, m, 0);
    expect(long).toBeLessThan(short);
  });
  it("deal flow follows the fundamentals", () => {
    const count = (stock: number) => {
      const m = structuredClone(g.market);
      for (const r of ["US", "EU", "WAF", "ME", "ASIA"] as const) m.stocks[r].diesel = stock;
      const rng = new Rng(`flow`);
      let buys = 0;
      for (let i = 0; i < 2000; i++) {
        const o = makeOffer(rng, m, `x${i}`, m.day + 7, ctx);
        if (o && o.product === "diesel") buys += o.playerSide === "buy" ? 1 : -1;
      }
      return buys;
    };
    expect(count(12)).toBeGreaterThan(count(-12) + 100);
  });
});

describe("negotiation", () => {
  const offer = () => makeOffer(new Rng("neg-offer"), g.market, "o1", g.day + 7, ctx, { cpty: ROSTER.find((x) => x.id === "bayside")!, template: { side: "buy", product: "diesel", hub: "USGC", incoterm: "FOB", cls: "MR", weight: 1, note: "" } })!;
  it("a counter at or above the reservation is accepted", () => {
    const o = offer();
    const r = negotiate(new Rng("n1"), o, o.reservation + 0.01, ROSTER.find((x) => x.id === "bayside")!, 0);
    expect(r.outcome).toBe("accepted");
  });
  it("counters below the reservation never close below it", () => {
    for (let i = 0; i < 200; i++) {
      const o = offer();
      const r = negotiate(new Rng(`n${i}`), o, o.reservation - 1, ROSTER.find((x) => x.id === "bayside")!, 0);
      if (r.outcome !== "walked") expect(r.diff).toBeGreaterThanOrEqual(o.reservation - 1e-9);
    }
  });
  it("in the game, pushing too hard can lose the offer; reasonable counters can win a better price", () => {
    const game = Game.create({ scenario: "normal_2025", seed: "neg" });
    const o = game.state.offers.find((x) => x.playerSide === "buy")!;
    const start = o.pricing.diff;
    const res = game.act({ type: "counter", offerId: o.id, diff: o.reservation });
    expect(res.ok).toBe(true);
    const after = game.state.offers.find((x) => x.id === o.id)!;
    expect(after.agreed).toBe(true);
    expect(after.pricing.diff).toBeLessThanOrEqual(start + 1e-9);
  });
});

describe("relationships and tenders", () => {
  it("failing to lift a cargo damages the relationship", () => {
    const game = Game.create({ scenario: "normal_2025", seed: "rel" });
    const o = game.state.offers.find((x) => x.playerSide === "buy" && x.incoterm === "FOB")!;
    game.act({ type: "accept", offerId: o.id });
    for (let i = 0; i < 35; i++) game.stepDay();
    expect(game.state.relations[o.cpty]!.score).toBeLessThan(0);
    expect(game.state.relations[o.cpty]!.fails).toBe(1);
  });
  it("a winning tender bid creates a deal; competition is reproducible", () => {
    const game = Game.create({ scenario: "normal_2025", seed: "tender" });
    const t: Tender = { id: "tnX", cpty: "coastal", cptyName: "Coastal National Oil Co.", playerSide: "sell", product: "gasoline", hub: "WAF", incoterm: "DES", qtyBbl: 300_000, laycan: [game.day + 30, game.day + 36], closeDay: game.day + 3, competitors: 4, status: "open" };
    game.state.tenders.push(t);
    expect(tenderCompetition(new Rng("a"), t, game.market)).toBe(tenderCompetition(new Rng("a"), t, game.market));
    game.act({ type: "tenderBid", tenderId: "tnX", diff: -5 });
    for (let i = 0; i < 4; i++) game.stepDay();
    expect(t.status).toBe("won");
    expect(game.book.deals.some((d) => d.id === t.dealId && d.side === "sell" && d.hub === "WAF")).toBe(true);
  });
});
