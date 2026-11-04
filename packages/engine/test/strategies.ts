/** Scripted strategies used by property and golden tests. */
import { Game } from "../src/game";
import { listedMonths, type FuturesId } from "../src/market/futures";
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

/** Hold `lots` of the second listed contract, rolling into the new second month as months expire. */
export function rollWeek(g: Game, contract: FuturesId, lots: number): void {
  const target = listedMonths(contract, g.day)[1]!;
  for (const f of g.book.futures.filter((x) => x.contract === contract && (x.y !== target.y || x.m !== target.m))) {
    g.act({ type: "futures", contract, y: f.y, m: f.m, lots: -f.lots });
  }
  const held = g.book.futures.find((x) => x.contract === contract && x.y === target.y && x.m === target.m)?.lots ?? 0;
  if (held !== lots) g.act({ type: "futures", contract, y: target.y, m: target.m, lots: lots - held });
}

/**
 * A disciplined arbitrage: buy an FOB cargo only when a delivered bid at the destination pays
 * for the purchase, the cheapest feasible freight and the financing, with a margin to spare,
 * and the ship can arrive inside the sale's laycan. Diesel and jet are hedged with ICE Gasoil.
 */
export function disciplinedArbWeek(g: Game, minMargin = 0.75): void {
  const offers = [...g.state.offers];
  let best: { buy: (typeof offers)[number]; sale: (typeof offers)[number]; routeId: string; margin: number } | null = null;
  for (const buy of offers.filter((o) => o.playerSide === "buy" && o.incoterm === "FOB")) {
    for (const r of ROUTES.filter((x) => x.from === buy.hub)) {
      const q = g.quotes(r.id).filter((x) => x.feasible).sort((a, b) => a.allInPerTonne - b.allInPerTonne)[0];
      if (!q) continue;
      for (const sale of offers.filter((o) => o.playerSide === "sell" && o.incoterm !== "FOB" && o.hub === r.to && o.product === buy.product)) {
        // conservative ETA: load at the end of the laycan, a few days of slack for delays
        const arrive = buy.laycan[1] + 2 + q.ladenDays + 3;
        if (arrive > sale.laycan[1] || buy.laycan[0] + q.ladenDays + 2 < sale.laycan[0] - 5) continue;
        // the cargo must fill the sale within its tolerance (no short delivery)
        if (buy.qtyBbl * (1 - buy.tolPct / 100) < sale.qtyBbl * (1 - sale.tolPct / 100)) continue;
        const qty = Math.min(buy.qtyBbl, sale.qtyBbl);
        const freight = (q.freightUsd + q.warRiskUsd) / qty;
        const finance = (buy.indicative * 0.072 * (q.ladenDays + 30)) / 365;
        const margin = sale.indicative - buy.indicative - freight - finance;
        if (margin > minMargin && (!best || margin > best.margin)) best = { buy, sale, routeId: r.id, margin };
      }
    }
  }
  if (!best) return;
  const res = g.act({ type: "accept", offerId: best.buy.id, charter: { routeId: best.routeId } });
  if (!res.ok) return;
  const voyage = g.book.voyages.at(-1)!;
  g.act({ type: "accept", offerId: best.sale.id, voyageId: voyage.id });
  if (best.buy.product !== "gasoline") {
    const m = listedMonths("GO", g.day)[1]!;
    g.act({ type: "futures", contract: "GO", y: m.y, m: m.m, lots: -Math.round(best.buy.qtyBbl / 745) });
  }
}
