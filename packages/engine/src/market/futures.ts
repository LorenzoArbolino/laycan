/**
 * Exchange futures used for hedging. Specs follow the exchanges' published contract terms;
 * expiry rules were checked against the listed expiry ladders (Oct 2026):
 *  - NYMEX RBOB (RB) and NY Harbor ULSD (HO): 42,000 gal; trading ends on the last business
 *    day of the month before the delivery month (e.g. Dec-26 HO: 30 Nov 2026)
 *  - ICE Low Sulphur Gasoil (G): 100 t, $/t; trading ends 2 business days before the 14th of
 *    the delivery month (e.g. Dec-26: 10 Dec 2026). Converted at 7.45 bbl/t.
 *  - ICE Brent (B): 1,000 bbl; trading ends on the last business day of the second month
 *    before the delivery month (e.g. Jan-27: 30 Nov 2026)
 */
import { addMonths, businessDaysBefore, fromYmd, isBusinessDay, lastBusinessDay, MONTH_CODES, ymd } from "../core/calendar";
import type { ProductId } from "../core/units";
import type { HubId } from "../world/world";

export type FuturesId = "RB" | "HO" | "GO" | "BRN";
export const FUTURES_IDS: readonly FuturesId[] = ["RB", "HO", "GO", "BRN"];

export interface FuturesSpec {
  id: FuturesId;
  name: string;
  exchange: string;
  /** null = Brent itself */
  product: ProductId | null;
  hub: HubId | null;
  /** barrels per lot used for valuation */
  bblPerLot: number;
  quoteUnit: "$/gal" | "$/t" | "$/bbl";
  /** multiply a $/bbl price by this to get the quote unit */
  quotePerBbl: number;
  structureKey: "brent" | ProductId;
  /** commission + exchange fee per lot, round trip half */
  feePerLot: number;
}

export const FUTURES: Record<FuturesId, FuturesSpec> = {
  RB: { id: "RB", name: "NYMEX RBOB Gasoline", exchange: "NYMEX", product: "gasoline", hub: "NYH", bblPerLot: 1000, quoteUnit: "$/gal", quotePerBbl: 1 / 42, structureKey: "gasoline", feePerLot: 3 },
  HO: { id: "HO", name: "NYMEX NY Harbor ULSD", exchange: "NYMEX", product: "diesel", hub: "NYH", bblPerLot: 1000, quoteUnit: "$/gal", quotePerBbl: 1 / 42, structureKey: "diesel", feePerLot: 3 },
  GO: { id: "GO", name: "ICE Low Sulphur Gasoil", exchange: "ICE Futures Europe", product: "diesel", hub: "ARA", bblPerLot: 745, quoteUnit: "$/t", quotePerBbl: 7.45, structureKey: "diesel", feePerLot: 3 },
  BRN: { id: "BRN", name: "ICE Brent Crude", exchange: "ICE Futures Europe", product: null, hub: null, bblPerLot: 1000, quoteUnit: "$/bbl", quotePerBbl: 1, structureKey: "brent", feePerLot: 3 },
};

export function expiryDay(id: FuturesId, y: number, m: number): number {
  switch (id) {
    case "RB":
    case "HO": {
      const p = addMonths(y, m, -1);
      return lastBusinessDay(p.y, p.m);
    }
    case "GO": {
      const d14 = fromYmd(y, m, 14);
      return businessDaysBefore(d14, 2);
    }
    case "BRN": {
      const p = addMonths(y, m, -2);
      return lastBusinessDay(p.y, p.m);
    }
  }
}

export interface ContractMonth {
  id: FuturesId;
  y: number;
  m: number;
  code: string;
  expiry: number;
}

export function contractCode(id: FuturesId, y: number, m: number): string {
  return `${id}${MONTH_CODES[m - 1]}${String(y).slice(-2)}`;
}

/** The next n listed months still trading on `day`. */
export function listedMonths(id: FuturesId, day: number, n = 6): ContractMonth[] {
  const { y, m } = ymd(day);
  const out: ContractMonth[] = [];
  for (let k = 0; out.length < n && k < n + 4; k++) {
    const t = addMonths(y, m, k);
    const e = expiryDay(id, t.y, t.m);
    if (e >= day) out.push({ id, y: t.y, m: t.m, code: contractCode(id, t.y, t.m), expiry: e });
  }
  return out;
}

export { isBusinessDay };
