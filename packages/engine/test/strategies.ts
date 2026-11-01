/** Scripted strategies used by property and golden tests. */
import { Game } from "../src/game";
import { listedMonths } from "../src/market/futures";
import { ROUTES } from "../src/world/world";
import type { Rng } from "../src/core/rng";

/**
 * A coherent arbitrage strategy: buy an FOB cargo, ship it on a feasible route, and sell it
 * DES at the destination when a matching bid exists; hedge diesel with ICE Gasoil.
 */
export function arbWeek(g: Game, hedge = true): void {
  const offers = [...g.state.offers];
  for (const buy of offers.filter((o) => o.playerSide === "buy" && o.incoterm === "FOB")) {
    for (const r of ROUTES.filter((x) => x.from === buy.hub)) {
      const sale = offers.find((o) => o.playerSide === "sell" && o.incoterm !== "FOB" && o.hub === r.to && o.product === buy.product);
      if (!sale) continue;
      const q = g.quotes(r.id).filter((x) => x.feasible);
      if (!q.length) continue;
      const res = g.act({ type: "accept", offerId: buy.id, charter: { routeId: r.id } });
      if (!res.ok) continue;
      const voyage = g.book.voyages.at(-1)!;
      g.act({ type: "accept", offerId: sale.id, voyageId: voyage.id });
      if (hedge && buy.product === "diesel") {
        const m = listedMonths("GO", g.day)[1]!;
        g.act({ type: "futures", contract: "GO", y: m.y, m: m.m, lots: -Math.round(buy.qtyBbl / 745) });
      }
      return;
    }
  }
}

/** A random but valid sequence of actions, driven by a test RNG. */
export function randomWeek(g: Game, rng: Rng): void {
  const k = rng.int(4);
  for (let i = 0; i < k; i++) {
    const kind = rng.int(4);
    const offers = g.state.offers;
    if (kind === 0 && offers.length) {
      const o = rng.pick(offers);
      const routes = ROUTES.filter((r) => r.from === o.hub);
      const charter = o.playerSide === "buy" && o.incoterm === "FOB" && routes.length ? { routeId: rng.pick(routes).id } : undefined;
      g.act({ type: "accept", offerId: o.id, charter });
    } else if (kind === 1) {
      const c = rng.pick(["RB", "HO", "GO", "BRN"] as const);
      const m = rng.pick(listedMonths(c, g.day));
      g.act({ type: "futures", contract: c, y: m.y, m: m.m, lots: (rng.int(200) - 100) || 1 });
    } else if (kind === 2) {
      g.act({ type: "quote", side: rng.pick(["buy", "sell"] as const), product: rng.pick(["gasoline", "diesel", "jet"] as const), hub: rng.pick(["USGC", "ARA", "NYH", "WAF"] as const), incoterm: "FOB" });
    } else if (g.book.cargoes.some((c) => c.where === "tank")) {
      const c = g.book.cargoes.find((x) => x.where === "tank")!;
      const r = ROUTES.find((x) => x.from === c.hub);
      if (r) g.act({ type: "charter", routeId: r.id, laycanStart: g.day + 5, product: c.product });
    }
  }
}
