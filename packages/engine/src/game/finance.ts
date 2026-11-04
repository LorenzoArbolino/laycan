/**
 * Finance and storage: credit and overdraft limits, LC fees, initial margin, interest and
 * tank rent accruals, liquidity checks, tank leases and spot sales from tank.
 */
import type { Deal } from "../book/types";
import { futuresPrice } from "../book/valuation";
import { exp } from "../core/dmath";
import { FUTURES } from "../market/futures";
import { hubPrice } from "../market/market";
import { MODEL } from "../params/model";
import type { HubId } from "../world/world";
import type { Game, ActionResult } from "../game";
import { DAYS_PER_MONTH } from "../market/curve";

/** Initial margin as a share of notional, by regime. */
export const MARGIN_PCT = { normal: 0.08, stressed: 0.12, war: 0.14 } as const;
/** Share of cargo and receivables the credit line lends against. */
export const BORROWING_BASE_ADVANCE = 0.8;

export function overdraftLimit(g: Game): number {
  return g.creditLimit();
}

export function lcFeePct(g: Game): number {
  const f = g.state.financeShock && g.day <= g.state.financeShock.untilDay ? g.state.financeShock.lcFeeMult : 1;
  return (g.scenario.finance.lcFeePct.value / 100) * f;
}

export function marginPct(g: Game): number {
  return MARGIN_PCT[g.market.regime];
}

export function lease(g: Game, hub: HubId, capacityBbl: number, months: number): ActionResult {
  if (!(capacityBbl > 0) || !(months >= 1)) return { ok: false, message: "Capacity must be positive and the term at least one month." };
  const fee = g.leaseQuote(hub);
  const l = { id: g.id("T"), hub, capacityBbl: Math.round(capacityBbl), feePerBblMonth: fee, startDay: g.day, endDay: g.day + Math.round(months * DAYS_PER_MONTH) };
  g.book.leases.push(l);
  return { ok: true, message: `Leased ${(l.capacityBbl / 1000).toFixed(0)} kbbl at ${hub} for ${months} month(s) at ${fee.toFixed(2)} $/bbl/month (take-or-pay: ${((fee * l.capacityBbl) / 1e3).toFixed(0)}k a month).`, id: l.id };
}

/** Sell a parcel from your tank to a merchant now: fixed price at the index less a haircut, paid in 5 days. */
export function sellSpot(g: Game, cargoId: string, qtyBbl?: number): ActionResult {
  const c = g.book.cargoes.find((x) => x.id === cargoId && x.where === "tank");
  if (!c) return { ok: false, message: "Only cargo in tank can be sold spot." };
  const qty = Math.min(c.qty, qtyBbl ?? c.qty);
  const M = hubPrice(g.market, c.hub, c.product);
  const h = MODEL.storage.spotSaleHaircut.value + c.qualityDiscount;
  const d: Deal = {
    id: g.id("S"),
    side: "sell",
    cpty: "spot",
    product: c.product,
    hub: c.hub,
    incoterm: "ITT",
    qtyNominal: qty,
    qty,
    tolPct: 0,
    tolHolder: "cpty",
    laycan: [g.day, g.day],
    pricing: { kind: "fixed", diff: -h, fixedPrice: M },
    payment: { kind: "open", days: 5 },
    status: "delivered",
    createdDay: g.day,
    deliveryDay: g.day,
    dueDay: g.day + 5,
    fixings: [],
    lcOpen: false,
    defaultRisk: 0,
    note: "spot sale",
  };
  g.post("execution", () => {
    g.book.deals.push(d);
    c.qty -= qty;
    if (c.qty < 1) g.book.cargoes = g.book.cargoes.filter((x) => x !== c);
  });
  return { ok: true, message: `Sold ${(qty / 1000).toFixed(0)} kbbl ${c.product} in tank at ${c.hub} for ${(M - h).toFixed(2)} $/bbl (index − ${h.toFixed(2)}).`, id: d.id };
}

export function carryAndInterest(g: Game) {
  // Term leases are take-or-pay; tank inventory above leased capacity pays spot tankage.
  for (const l of g.book.leases) {
    if (g.day < l.startDay || g.day >= l.endDay) continue;
    g.post("time_spread", () => {
      g.book.cash -= (l.capacityBbl * l.feePerBblMonth) / DAYS_PER_MONTH;
    });
  }
  const hubs = new Set(g.book.cargoes.filter((c) => c.where === "tank").map((c) => c.hub));
  for (const hub of hubs) {
    const excess = Math.max(0, g.tankStock(hub) - g.leasedCapacity(hub));
    if (excess <= 0) continue;
    g.post("time_spread", () => {
      g.book.cash -= (excess * g.spotStorageFee(hub)) / DAYS_PER_MONTH;
    });
  }
  const f = g.scenario.finance;
  const rate = g.book.cash >= 0 ? f.depositRate.value : f.borrowRate.value + (g.book.cash < -overdraftLimit(g) ? 0.05 : 0);
  g.post("finance", () => {
    g.book.cash *= exp(rate / 365);
  });
}

export function liquidity(g: Game) {
  if (g.book.cash >= -overdraftLimit(g)) return;
  g.state.liquidityBreachDays++;
  if (g.book.futures.length === 0) {
    g.alert("Credit line breached", "Cash is below the overdraft limit. Penalty interest applies until you raise cash.", "critical");
    return;
  }
  g.alert("Margin call: forced liquidation", "Cash fell below your credit line. The broker closes all futures positions.", "critical");
  for (const f of [...g.book.futures]) {
    const spec = FUTURES[f.contract];
    g.post(
      "finance",
      () => {
        g.book.cash -= Math.abs(f.lots) * spec.feePerLot * 3;
      },
      "paper",
    );
    g.post(
      "execution",
      () => {
        const F = futuresPrice(f.contract, f.expiry, g.market);
        g.book.cash += f.lots * spec.bblPerLot * (F - f.lastSettle) + f.margin;
        g.book.futures = g.book.futures.filter((x) => x !== f);
      },
      "paper",
    );
  }
}
