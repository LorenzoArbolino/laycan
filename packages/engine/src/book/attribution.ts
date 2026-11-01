/**
 * Exact daily P&L attribution of market moves.
 *
 * ΔV = V(m4) − V(m0) = [V(m1)−V(m0)] + [V(m2)−V(m1)] + [V(m3)−V(m2)] + [V(m4)−V(m3)]
 *   m1: Brent updated              -> flat price
 *   m2: + cracks updated           -> crack
 *   m3: + regional diffs updated   -> regional
 *   m4: + curve structure and date -> time spread (incl. futures roll-down)
 * The sum telescopes, so the buckets add up to the total by construction.
 */
import type { MarketState } from "../market/market";
import { emptyAttribution, type Attribution, type Book } from "./types";
import { equity, futuresValue } from "./valuation";

function paperValue(book: Book, m: MarketState): number {
  return book.futures.reduce((s, f) => s + futuresValue(f, m), 0);
}

export function attributeMarketMove(book: Book, prev: MarketState, next: MarketState): Attribution {
  const m0 = prev;
  const m1: MarketState = { ...m0, brent: next.brent };
  const m2: MarketState = { ...m1, cracks: next.cracks };
  const m3: MarketState = { ...m2, diffs: next.diffs };
  const m4: MarketState = { ...m3, structure: next.structure, day: next.day };
  const steps: [MarketState, MarketState, "flat_price" | "crack" | "regional" | "time_spread"][] = [
    [m0, m1, "flat_price"],
    [m1, m2, "crack"],
    [m2, m3, "regional"],
    [m3, m4, "time_spread"],
  ];
  const a = emptyAttribution();
  for (const [x, y, b] of steps) {
    const dTot = equity(book, y) - equity(book, x);
    const dPaper = paperValue(book, y) - paperValue(book, x);
    a[b].paper += dPaper;
    a[b].physical += dTot - dPaper;
  }
  return a;
}

export interface Exposure {
  key: string;
  label: string;
  bbl: number;
}

/**
 * Exposure of the book to each price component, in barrels: the change in value for a
 * +$1/bbl move of that component alone.
 */
export function exposures(book: Book, m: MarketState): Exposure[] {
  const base = equity(book, m);
  const out: Exposure[] = [];
  const bump = (key: string, label: string, mod: (x: MarketState) => void) => {
    const y = structuredClone(m);
    mod(y);
    const e = equity(book, y) - base;
    if (Math.abs(e) > 1) out.push({ key, label, bbl: e });
  };
  bump("brent", "Brent (flat price)", (y) => (y.brent += 1));
  for (const p of ["gasoline", "diesel", "jet"] as const) bump(`crack:${p}`, `${p} crack`, (y) => (y.cracks[p] += 1));
  for (const h of Object.keys(m.diffs) as (keyof MarketState["diffs"])[]) {
    if (h === "USGC") continue;
    for (const p of ["gasoline", "diesel", "jet"] as const) bump(`diff:${h}:${p}`, `${h} ${p} diff`, (y) => (y.diffs[h][p] += 1));
  }
  for (const k of ["brent", "gasoline", "diesel", "jet"] as const) bump(`struct:${k}`, `${k} curve spread`, (y) => (y.structure[k] += 1));
  return out;
}
