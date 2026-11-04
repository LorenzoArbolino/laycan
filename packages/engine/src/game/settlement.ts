/**
 * Settlement: pricing windows and fixings, deliveries and tolerances, counterparty
 * performance, deadlines, invoices and payments, futures variation margin and expiry.
 */
import { ROSTER } from "../agents/counterparties";
import type { Cargo, Deal } from "../book/types";
import { contractPrice, futuresPrice } from "../book/valuation";
import { isBusinessDay } from "../core/calendar";
import { Rng } from "../core/rng";
import { FUTURES } from "../market/futures";
import { hubPrice } from "../market/market";
import type { Game } from "../game";
import { marginPct } from "./finance";

/** Contract penalties, $/bbl. */
export const PENALTY = { failToLift: 2, failToDeliver: 3, late: 0.5 } as const;

export function settleFutures(g: Game) {
  for (const f of [...g.book.futures]) {
    const spec = FUTURES[f.contract];
    const F = futuresPrice(f.contract, f.expiry, g.market);
    g.post(
      "time_spread",
      () => {
        g.book.cash += f.lots * spec.bblPerLot * (F - f.lastSettle);
        f.lastSettle = F;
        const req = Math.abs(f.lots) * spec.bblPerLot * F * marginPct(g);
        g.book.cash -= req - f.margin;
        f.margin = req;
        if (g.day >= f.expiry) {
          g.book.cash += f.margin;
          f.margin = 0;
          g.book.futures = g.book.futures.filter((x) => x !== f);
          g.alert(`Futures expired: ${spec.name}`, `${f.lots} lots cash-settled at ${(F * spec.quotePerBbl).toFixed(2)} ${spec.quoteUnit}.`, "info");
        }
      },
      "paper",
    );
  }
}

export function fixPricing(g: Game) {
  for (const d of g.book.deals) {
    if (d.status === "settled" || d.status === "cancelled" || !d.window) continue;
    if (d.window.includes(g.day) && !d.fixings.some((f) => f.day === g.day)) {
      d.fixings.push({ day: g.day, price: hubPrice(g.market, d.hub, d.product) });
    }
  }
}

export function windowFor(g: Game, d: Deal, anchor: number): number[] {
  let a = anchor;
  while (!isBusinessDay(a)) a++;
  const out: number[] = [];
  if (d.pricing.kind === "bl5") {
    const before: number[] = [];
    let x = a - 1;
    while (before.length < 2) {
      if (isBusinessDay(x)) before.unshift(x);
      x--;
    }
    out.push(...before, a);
    x = a + 1;
    while (out.length < 5) {
      if (isBusinessDay(x)) out.push(x);
      x++;
    }
  } else if (d.pricing.kind === "post5") {
    let x = a;
    while (out.length < 5) {
      if (isBusinessDay(x)) out.push(x);
      x++;
    }
  }
  return out;
}

/** Fix quotes for window days already past (the B/L date reveals a window that started earlier). */
export function retroFix(g: Game, d: Deal) {
  if (!d.window) return;
  for (const day of d.window) {
    if (day > g.day) break;
    if (!d.fixings.some((f) => f.day === day)) d.fixings.push({ day, price: g.priceOn(day, d.hub, d.product) });
  }
  d.fixings.sort((a, b) => a.day - b.day);
}

export function setDelivery(g: Game, d: Deal, anchor: number) {
  // The actual delivery date and pricing window replace the expected ones: timing optionality
  g.post("optionality", () => {
    d.deliveryDay = g.day;
    if (d.pricing.kind === "bl5" || d.pricing.kind === "post5") {
      d.window = windowFor(g, d, anchor);
      retroFix(g, d);
    }
  });
  const last = d.window && d.window.length ? d.window[d.window.length - 1]! : g.day;
  d.dueDay = Math.max(g.day + d.payment.days, last + 1);
}

export function chooseQty(g: Game, d: Deal, available: number): number {
  const lo = d.qtyNominal * (1 - d.tolPct / 100);
  const hi = d.qtyNominal * (1 + d.tolPct / 100);
  const M = hubPrice(g.market, d.hub, d.product);
  const P = contractPrice(d, g.market);
  // Player-held option: take more when the cargo is worth more than its price (buy) or the price exceeds value (sell)
  let want = d.qtyNominal;
  if (d.tolHolder === "player") {
    const gain = d.side === "buy" ? M - P : P - M;
    want = gain > 0 ? hi : lo;
  } else {
    // counterparty exercises against the player
    const gain = d.side === "buy" ? M - P : P - M;
    want = gain > 0 ? lo : hi;
  }
  return Math.max(0, Math.min(want, available));
}

export function deliverPurchase(g: Game, d: Deal, qty: number, where: Cargo["where"], voyageId?: string): Cargo {
  g.post("optionality", () => {
    d.qty = qty;
  });
  setDelivery(g, d, g.day);
  const c: Cargo = { id: g.id("C"), product: d.product, qty, hub: d.hub, where, voyageId, qualityDiscount: 0, sinceDay: g.day };
  g.post("events", () => {
    d.status = "delivered";
    g.book.cargoes.push(c);
  });
  return c;
}

export function deliverSale(g: Game, s: Deal, c: Cargo, anchor: number) {
  const hi = s.qtyNominal * (1 + s.tolPct / 100);
  const lo = s.qtyNominal * (1 - s.tolPct / 100);
  const qty = Math.min(chooseQty(g, s, Math.min(c.qty, hi)), c.qty);
  g.post("optionality", () => {
    s.qty = qty;
  });
  setDelivery(g, s, anchor);
  g.post("events", () => {
    s.status = "delivered";
    c.qty -= qty;
    if (c.qty < 1) g.book.cargoes = g.book.cargoes.filter((x) => x !== c);
  });
  if (c.qualityDiscount > 0) {
    // the buyer claims the off-spec discount on what was delivered
    g.post("quality", () => {
      g.book.cash -= qty * c.qualityDiscount;
    });
    // the claim offsets the discount already in the cargo mark, so re-add it here
    g.dayAttr.quality.physical += qty * c.qualityDiscount;
    g.dayAttr.events.physical -= qty * c.qualityDiscount;
  }
  if (qty < lo) {
    const short = lo - qty;
    g.post("events", () => {
      g.book.cash -= short * PENALTY.failToDeliver;
    });
    g.alert(`Short delivery on ${s.id}`, `Delivered ${(qty / 1000).toFixed(0)} kbbl, below tolerance. Penalty ${(short * PENALTY.failToDeliver / 1e3).toFixed(0)}k.`);
  }
  if (g.day > s.laycan[1]) {
    g.post("events", () => {
      g.book.cash -= qty * PENALTY.late;
    });
    g.alert(`Late delivery on ${s.id}`, `Arrived after the laycan; late-delivery claim settled at $${PENALTY.late}/bbl.`);
    g.relate(s.cpty, -0.1);
  }
}

export function counterpartyDeliveries(g: Game) {
  for (const d of g.book.deals) {
    if (d.status !== "open" || d.plannedDelivery === undefined || g.day < d.plannedDelivery) continue;
    if (d.side === "buy") {
      const cargo = deliverPurchase(g, d, chooseQty(g, d, Infinity), "tank");
      const late = g.day - d.laycan[1];
      g.alert(`Delivery received: ${d.id}`, `${(d.qty / 1000).toFixed(0)} kbbl ${d.product} delivered into your tank at ${d.hub}${late > 0 ? `, ${late} days after the laycan` : ""}.`, late > 0 ? "warn" : "info");
      const cp = ROSTER.find((x) => x.id === d.cpty);
      const kr = Rng.stream(g.state.seed, `quality:${d.id}`);
      if (cp && kr.bernoulli(cp.offSpec)) {
        const disc = 1.5 + 2 * kr.uniform();
        g.post("quality", () => {
          cargo.qualityDiscount += disc;
        });
        g.alert(`Off-spec delivery from ${cp.name}`, `Inspection finds ${d.id} off-spec: valued $${disc.toFixed(2)}/bbl lower.`);
      }
    } else {
      const c = g.book.cargoes.find((x) => x.where === "tank" && x.hub === d.hub && x.product === d.product);
      if (c) deliverSale(g, d, c, g.day);
    }
  }
}

export function deadlines(g: Game) {
  for (const d of g.book.deals) {
    if (d.status !== "open") continue;
    if (d.side === "buy" && d.incoterm === "FOB" && !d.voyageId && g.day > d.laycan[1]) {
      g.post("events", () => {
        d.status = "cancelled";
        g.book.cash -= d.qtyNominal * PENALTY.failToLift;
        if (d.lcOpen) g.book.lcUsed -= d.qtyNominal * contractPrice(d, g.market);
      });
      g.alert(`Failed to lift ${d.id}`, `No vessel nominated within the laycan. Contract cancelled; penalty $${PENALTY.failToLift}/bbl. ${ROSTER.find((x) => x.id === d.cpty)?.name ?? "The seller"} will remember.`, "critical");
      g.relate(d.cpty, -0.3, "fail");
    }
    if (d.side === "sell" && g.day > d.laycan[1] + 5) {
      const v = d.voyageId ? g.book.voyages.find((x) => x.id === d.voyageId) : undefined;
      if (v && v.status !== "done" && v.status !== "cancelled") continue; // a ship is coming: late delivery handled at discharge
      g.post("events", () => {
        d.status = "cancelled";
        g.book.cash -= d.qtyNominal * PENALTY.failToDeliver;
      });
      g.alert(`Failed to deliver ${d.id}`, `No cargo delivered. Buyer cancels and claims $${PENALTY.failToDeliver}/bbl; the contract's value is lost. ${ROSTER.find((x) => x.id === d.cpty)?.name ?? "The buyer"} will remember.`, "critical");
      g.relate(d.cpty, -0.3, "fail");
    }
  }
}

export function payments(g: Game) {
  for (const d of g.book.deals) {
    if (d.status !== "delivered" || d.dueDay === undefined || g.day < d.dueDay) continue;
    const n = d.pricing.kind === "fixed" ? 0 : d.window?.length ?? 0;
    if (d.pricing.kind !== "fixed" && d.fixings.length < n) continue;
    const P = contractPrice(d, g.market);
    const kr = Rng.stream(g.state.seed, `pay:${d.id}`);
    const cpr = ROSTER.find((x) => x.id === d.cpty);
    const lcRisk = cpr && (cpr.rating === "BB" || cpr.rating === "B") ? 0.15 : 0.06;
    if (d.payment.kind === "LC" && d.side === "sell" && !d.note?.includes("LC delay") && kr.bernoulli(lcRisk)) {
      d.dueDay += 10;
      d.note = (d.note ?? "") + " LC delay";
      g.alert(`LC discrepancy on ${d.id}`, "The bank found a document discrepancy. Payment delayed ~10 days (financing cost).");
      continue;
    }
    if (d.side === "sell" && d.defaultRisk > 0 && kr.bernoulli(d.defaultRisk)) {
      g.post("events", () => {
        d.status = "settled";
        g.book.cash += 0.3 * d.qty * P;
      });
      g.alert(`Counterparty default on ${d.id}`, "Your open-account buyer cannot pay. 30% recovered after legal costs.", "critical");
      continue;
    }
    g.post("events", () => {
      g.book.cash += d.side === "sell" ? d.qty * P : -d.qty * P;
      d.status = "settled";
      g.relate(d.cpty, 0.05, "deal");
      if (d.lcOpen) {
        g.book.lcUsed = Math.max(0, g.book.lcUsed - d.qtyNominal * P);
        d.lcOpen = false;
      }
    });
  }
}
