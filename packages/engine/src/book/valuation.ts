/**
 * Mark-to-market valuation of the whole book at a given market state.
 *
 * Every item's value is linear in the additive price components, so the daily change in
 * equity can be split exactly into flat price, crack, regional and time-spread effects
 * by revaluing against partially-updated markets (a telescoping sum: exact by construction).
 */
import { isBusinessDay } from "../core/calendar";
import { FUTURES, curveFactor, monthsTo } from "../market/futures";
import { hubPrice, type MarketState } from "../market/market";
import type { Book, Cargo, Deal, FuturesPosition } from "./types";

/** Price for which a deal will be invoiced, using fixings so far and the current market for the rest. */
export function contractPrice(d: Deal, m: MarketState): number {
  if (d.pricing.kind === "fixed") return (d.pricing.fixedPrice ?? 0) + d.pricing.diff;
  const M = hubPrice(m, d.hub, d.product);
  const n = d.window ? d.window.length : expectedWindowLength(d);
  const k = d.fixings.length;
  const sum = d.fixings.reduce((s, f) => s + f.price, 0);
  return (sum + Math.max(0, n - k) * M) / Math.max(n, 1) + d.pricing.diff;
}

export function expectedWindowLength(d: Deal): number {
  if (d.pricing.kind === "month" && d.pricing.month) {
    return monthBusinessDays(d.pricing.month.y, d.pricing.month.m).length;
  }
  if (d.pricing.kind === "fixed") return 1;
  return 5;
}

export function monthBusinessDays(y: number, m: number): number[] {
  const start = Math.round(Date.UTC(y, m - 1, 1) / 86_400_000);
  const end = Math.round(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1) / 86_400_000);
  const out: number[] = [];
  for (let d = start; d < end; d++) if (isBusinessDay(d)) out.push(d);
  return out;
}

export function fixedShare(d: Deal): number {
  if (d.pricing.kind === "fixed") return 1;
  const n = d.window ? d.window.length : expectedWindowLength(d);
  return Math.min(1, d.fixings.length / Math.max(n, 1));
}

export function dealValue(d: Deal, m: MarketState): number {
  if (d.status === "settled" || d.status === "cancelled") return 0;
  const P = contractPrice(d, m);
  if (d.status === "open") {
    const M = hubPrice(m, d.hub, d.product);
    return d.side === "buy" ? d.qty * (M - P) : d.qty * (P - M);
  }
  // delivered, awaiting payment: payable or receivable at the (possibly still floating) invoice price
  return d.side === "buy" ? -d.qty * P : d.qty * P;
}

export function cargoValue(c: Cargo, m: MarketState): number {
  return c.qty * (hubPrice(m, c.hub, c.product) - c.qualityDiscount);
}

export function futuresPrice(contract: FuturesPosition["contract"], expiry: number, m: MarketState): number {
  const spec = FUTURES[contract];
  const spot = spec.hub && spec.product ? hubPrice(m, spec.hub, spec.product) : m.brent;
  return spot - m.structure[spec.structureKey] * curveFactor(monthsTo(expiry, m.day));
}

export function futuresValue(f: FuturesPosition, m: MarketState): number {
  const F = futuresPrice(f.contract, f.expiry, m);
  return f.lots * FUTURES[f.contract].bblPerLot * (F - f.lastSettle) + f.margin;
}

export interface EquityBreakdown {
  cash: number;
  cargo: number;
  physicalContracts: number;
  receivables: number;
  payables: number;
  futures: number;
  margin: number;
  total: number;
}

export function equity(book: Book, m: MarketState): number {
  return equityBreakdown(book, m).total;
}

export function equityBreakdown(book: Book, m: MarketState): EquityBreakdown {
  let cargo = 0;
  for (const c of book.cargoes) cargo += cargoValue(c, m);
  let contracts = 0;
  let receivables = 0;
  let payables = 0;
  for (const d of book.deals) {
    const v = dealValue(d, m);
    if (d.status === "open") contracts += v;
    else if (d.status === "delivered") {
      if (v >= 0) receivables += v;
      else payables += v;
    }
  }
  let fut = 0;
  let margin = 0;
  for (const f of book.futures) {
    fut += futuresValue(f, m) - f.margin;
    margin += f.margin;
  }
  payables -= book.payables.freight + book.payables.demurrage;
  const total = book.cash + cargo + contracts + receivables + payables + fut + margin;
  return { cash: book.cash, cargo, physicalContracts: contracts, receivables, payables, futures: fut, margin, total };
}

/** Value split by leg: physical vs paper (futures). */
export function legValue(book: Book, m: MarketState, leg: "physical" | "paper"): number {
  if (leg === "paper") return book.futures.reduce((s, f) => s + futuresValue(f, m), 0);
  return equity(book, m) - legValue(book, m, "paper") - book.cash;
}
