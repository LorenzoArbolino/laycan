/**
 * Counterparties. A roster of fictional firms with different businesses, credit ratings,
 * reliability and home markets. Deal flow follows the fundamentals: long regions offer
 * cargoes, short regions bid for them. Every offer has a hidden reservation price that the
 * player can negotiate towards; relationships remember how the player performs.
 */
import { isBusinessDay, ymd } from "../core/calendar";
import type { Rng } from "../core/rng";
import { tonnesToBbl, type ProductId } from "../core/units";
import { exp } from "../core/dmath";
import { hubPrice, type MarketState } from "../market/market";
import type { Incoterm, Payment, Pricing, PricingKind } from "../book/types";
import { est, type Param } from "../params/param";
import type { Regime } from "../params/model";
import { HUB_REGION, VESSELS, type HubId, type VesselClass } from "../world/world";

export type Rating = "A" | "BBB" | "BB" | "B";
export type CptyKind = "major" | "noc" | "refiner" | "trader" | "enduser";

export interface Counterparty {
  id: string;
  name: string;
  kind: CptyKind;
  rating: Rating;
  /** hubs where it trades */
  hubs: HubId[];
  products: ProductId[];
  /** sells (player buys) and/or buys (player sells) */
  sells: boolean;
  buys: boolean;
  /** minimum premium it needs over the index, $/bbl (its reservation) */
  minSpread: number;
  /** how much it asks above its reservation at first, $/bbl */
  markup: number;
  /** probability of countering rather than walking away when a counter-offer falls short */
  patience: number;
  /** probability of performing on time when it delivers */
  reliability: number;
  /** probability that a cargo it delivers is off-spec */
  offSpec: number;
  payment: Payment;
  tenders?: { side: "buy" | "sell"; product: ProductId; hub: HubId };
  blurb: string;
}

const LC: Payment = { kind: "LC", days: 30 };
const OPEN: Payment = { kind: "open", days: 30 };

export const ROSTER: readonly Counterparty[] = [
  { id: "meridian", name: "Meridian Energy", kind: "major", rating: "A", hubs: ["USGC", "ARA", "SIN", "NYH", "JPN"], products: ["gasoline", "diesel", "jet"], sells: true, buys: true, minSpread: 0.5, markup: 0.6, patience: 0.3, reliability: 0.97, offSpec: 0.01, payment: OPEN, blurb: "Integrated major. Well informed, rarely leaves money on the table, pays on time." },
  { id: "northgate", name: "Northgate Petroleum", kind: "major", rating: "A", hubs: ["ARA", "NYH", "WAF"], products: ["gasoline", "diesel"], sells: true, buys: true, minSpread: 0.45, markup: 0.5, patience: 0.35, reliability: 0.96, offSpec: 0.01, payment: OPEN, blurb: "Atlantic-basin major with a big gasoline position." },
  { id: "bayside", name: "Bayside Refining", kind: "refiner", rating: "BBB", hubs: ["USGC", "NYH"], products: ["gasoline", "diesel", "jet"], sells: true, buys: true, minSpread: 0.3, markup: 0.5, patience: 0.6, reliability: 0.92, offSpec: 0.03, payment: LC, blurb: "US Gulf independent refiner. Places surplus barrels around run cuts; flexible on price." },
  { id: "rhine", name: "Rhine Delta Refinery", kind: "refiner", rating: "BBB", hubs: ["ARA"], products: ["gasoline", "diesel", "jet"], sells: true, buys: true, minSpread: 0.3, markup: 0.45, patience: 0.55, reliability: 0.93, offSpec: 0.03, payment: LC, blurb: "Northwest European refiner: long gasoline, short diesel." },
  { id: "gulfcrown", name: "Gulf Crown Refining Co.", kind: "noc", rating: "A", hubs: ["MEG", "FUJ"], products: ["diesel", "jet", "gasoline"], sells: true, buys: false, minSpread: 0.55, markup: 0.4, patience: 0.15, reliability: 0.95, offSpec: 0.01, payment: LC, tenders: { side: "sell", product: "diesel", hub: "MEG" }, blurb: "State refiner in the Gulf. Sells export cargoes, often by tender; does not haggle." },
  { id: "coastal", name: "Coastal National Oil Co.", kind: "noc", rating: "BB", hubs: ["WAF"], products: ["gasoline", "diesel", "jet"], sells: true, buys: true, minSpread: 0.6, markup: 0.4, patience: 0.1, reliability: 0.85, offSpec: 0.03, payment: LC, tenders: { side: "buy", product: "gasoline", hub: "WAF" }, blurb: "West African national oil company. Buys gasoline by tender; LCs from local banks can be slow." },
  { id: "kanto", name: "Kanto Bay Refining", kind: "refiner", rating: "A", hubs: ["JPN"], products: ["gasoline", "diesel", "jet"], sells: true, buys: true, minSpread: 0.4, markup: 0.45, patience: 0.3, reliability: 0.98, offSpec: 0.005, payment: LC, blurb: "Japanese refiner with more capacity than home demand: exports diesel and jet, buys gasoline at the margin. Precise and reliable; does not chase price." },
  { id: "straits", name: "Straits Petroleum", kind: "refiner", rating: "BBB", hubs: ["SIN", "FUJ", "JPN"], products: ["gasoline", "diesel", "jet"], sells: true, buys: true, minSpread: 0.35, markup: 0.45, patience: 0.5, reliability: 0.93, offSpec: 0.02, payment: LC, blurb: "Asian refiner and trader. Active in Singapore and Fujairah." },
  { id: "kestrel", name: "Kestrel Trading", kind: "trader", rating: "B", hubs: ["USGC", "ARA", "WAF", "MEG", "FUJ", "SIN", "NYH"], products: ["gasoline", "diesel", "jet"], sells: true, buys: true, minSpread: 0.1, markup: 0.3, patience: 0.8, reliability: 0.82, offSpec: 0.06, payment: OPEN, blurb: "Small, hungry trader. Sharp prices on open account; reliability and credit are your problem." },
  { id: "cobalt", name: "Cobalt Energy Trading", kind: "trader", rating: "BB", hubs: ["ARA", "WAF", "USGC"], products: ["gasoline", "diesel"], sells: true, buys: true, minSpread: 0.2, markup: 0.4, patience: 0.65, reliability: 0.88, offSpec: 0.04, payment: OPEN, blurb: "Mid-sized trader with a West Africa focus." },
  { id: "atlas", name: "Atlas Aviation Fuels", kind: "enduser", rating: "A", hubs: ["ARA", "NYH", "SIN"], products: ["jet"], sells: false, buys: true, minSpread: 0.15, markup: 0.3, patience: 0.4, reliability: 0.98, offSpec: 0, payment: OPEN, blurb: "Airline fuel supplier. Pays up for reliable jet supply; never defaults." },
  { id: "lowlands", name: "Lowlands Distribution", kind: "enduser", rating: "BBB", hubs: ["ARA", "NYH"], products: ["diesel", "gasoline"], sells: false, buys: true, minSpread: 0.2, markup: 0.35, patience: 0.45, reliability: 0.95, offSpec: 0, payment: OPEN, blurb: "Wholesale distributor buying prompt barrels into its network." },
];

/** Kept for compatibility with older saves and UIs. */
export const COUNTERPARTIES = ROSTER;

export const CREDIT: Record<Rating, Param> = {
  A: est(0.002, "prob per invoice", "order of magnitude from corporate default rates, scaled to 30-day trade credit"),
  BBB: est(0.006, "prob per invoice", "order of magnitude from corporate default rates, scaled to 30-day trade credit"),
  BB: est(0.02, "prob per invoice", "order of magnitude from corporate default rates, scaled to 30-day trade credit"),
  B: est(0.06, "prob per invoice", "small traders on open account; includes fraud and disputes"),
};
export const CREDIT_REGIME_MULT: Record<Regime, number> = { normal: 1, stressed: 3, war: 1.5 };
export const SPREAD_REGIME_MULT: Record<Regime, number> = { normal: 1, stressed: 1.3, war: 1.5 };
export const STOCK_SPREAD: Param = est(0.05, "$/bbl per % of regional stocks", "model design", "a long region's sellers cut their asking premium; a short region's buyers pay more");

export function defaultProbability(c: Counterparty, regime: Regime): number {
  return CREDIT[c.rating].value * CREDIT_REGIME_MULT[regime];
}

export interface Relation {
  score: number;
  deals: number;
  fails: number;
}

export function emptyRelations(): Record<string, Relation> {
  return Object.fromEntries(ROSTER.map((c) => [c.id, { score: 0, deals: 0, fails: 0 }]));
}

export interface Offer {
  id: string;
  /** player's side if accepted */
  playerSide: "buy" | "sell";
  cpty: string;
  cptyName: string;
  product: ProductId;
  hub: HubId;
  incoterm: Incoterm;
  qtyBbl: number;
  tolPct: number;
  tolHolder: "player" | "cpty";
  laycan: [number, number];
  pricing: Pricing;
  payment: Payment;
  defaultRisk: number;
  expiresDay: number;
  /** indicative all-in price at today's market, $/bbl */
  indicative: number;
  vesselClass: VesselClass;
  note: string;
  /** hidden: the counterparty's walk-away premium (cpty sells) or maximum premium (cpty buys) */
  reservation: number;
  rounds: number;
  agreed?: boolean;
}

interface Template {
  side: "buy" | "sell";
  product: ProductId;
  hub: HubId;
  incoterm: Incoterm;
  cls: VesselClass;
  weight: number;
  note: string;
}

const T = (side: "buy" | "sell", product: ProductId, hub: HubId, incoterm: Incoterm, cls: VesselClass, weight: number, note: string): Template => ({ side, product, hub, incoterm, cls, weight, note });

/** Where cargoes typically come from (player buys) and go to (player sells). */
export const TEMPLATES: readonly Template[] = [
  T("buy", "diesel", "USGC", "FOB", "MR", 3, "US Gulf export cargo"),
  T("buy", "gasoline", "USGC", "FOB", "MR", 2, "US Gulf gasoline export"),
  T("buy", "jet", "USGC", "FOB", "MR", 1.5, "US Gulf jet export"),
  T("buy", "gasoline", "ARA", "FOB", "MR", 3, "Northwest Europe surplus gasoline"),
  T("buy", "diesel", "WAF", "FOB", "MR", 1.5, "Nigerian refinery export"),
  T("buy", "jet", "WAF", "FOB", "MR", 1, "Nigerian refinery export"),
  T("buy", "diesel", "MEG", "FOB", "LR1", 2, "Gulf refinery export (inside Hormuz)"),
  T("buy", "jet", "MEG", "FOB", "LR1", 1.5, "Gulf refinery export (inside Hormuz)"),
  T("buy", "diesel", "FUJ", "FOB", "LR1", 1.5, "Fujairah storage cargo (outside Hormuz)"),
  T("buy", "gasoline", "SIN", "FOB", "MR", 0.5, "Singapore cargo"),
  T("sell", "diesel", "ARA", "DES", "MR", 3, "European diesel import demand"),
  T("sell", "jet", "ARA", "DES", "MR", 2, "European jet import demand"),
  T("sell", "gasoline", "NYH", "DES", "MR", 2.5, "US East Coast gasoline demand"),
  T("sell", "diesel", "NYH", "DES", "MR", 1, "US East Coast distillate demand"),
  T("sell", "gasoline", "WAF", "DES", "MR", 2, "West African gasoline demand"),
  T("sell", "diesel", "SIN", "DES", "LR1", 1, "Asian import demand"),
  T("sell", "diesel", "ARA", "CIF", "LR1", 1, "Large European diesel parcel, CIF"),
  T("sell", "gasoline", "ARA", "FOB", "MR", 0.7, "Buyer lifting from ARA tanks"),
  T("sell", "diesel", "USGC", "FOB", "MR", 0.7, "Buyer lifting from US Gulf tanks"),
  T("sell", "jet", "SIN", "DES", "MR", 0.8, "Asian jet demand"),
  T("buy", "diesel", "JPN", "FOB", "MR", 1.2, "Japanese refinery export"),
  T("buy", "jet", "JPN", "FOB", "MR", 1, "Japanese refinery export"),
  T("sell", "gasoline", "JPN", "DES", "MR", 0.6, "Japanese gasoline top-up"),
  T("sell", "diesel", "JPN", "DES", "LR2", 0.3, "Japanese buyer of Middle East diesel"),
  // Prompt in-tank parcels: the raw material of storage plays
  T("buy", "diesel", "ARA", "ITT", "MR", 1.2, "Prompt parcel in an ARA terminal"),
  T("buy", "gasoline", "ARA", "ITT", "MR", 0.8, "Prompt parcel in an ARA terminal"),
  T("buy", "diesel", "USGC", "ITT", "MR", 0.8, "Prompt parcel in a Houston terminal"),
  T("buy", "jet", "SIN", "ITT", "MR", 0.5, "Prompt parcel in a Singapore terminal"),
  T("buy", "diesel", "FUJ", "ITT", "MR", 0.5, "Prompt parcel in a Fujairah terminal"),
  T("sell", "diesel", "ARA", "ITT", "MR", 1, "Wholesaler buying in-tank at ARA"),
  T("sell", "gasoline", "NYH", "ITT", "MR", 0.6, "Blender buying in-tank at NY Harbor"),
  T("sell", "jet", "ARA", "ITT", "MR", 0.6, "Airline supplier buying in-tank at ARA"),
];

function nextBusinessDay(d: number): number {
  let x = d;
  while (!isBusinessDay(x)) x++;
  return x;
}

function weighted<T>(rng: Rng, items: readonly T[], w: (t: T) => number): T | undefined {
  const ws = items.map((x) => Math.max(0, w(x)));
  const total = ws.reduce((a, b) => a + b, 0);
  if (total <= 0) return undefined;
  let u = rng.uniform() * total;
  for (let i = 0; i < items.length; i++) {
    u -= ws[i]!;
    if (u <= 0) return items[i];
  }
  return items[items.length - 1];
}

/** Who could take the other side of a template. */
export function candidates(t: Pick<Template, "side" | "product" | "hub">, relations: Record<string, Relation>): Counterparty[] {
  return ROSTER.filter((c) => c.hubs.includes(t.hub) && c.products.includes(t.product) && (t.side === "buy" ? c.sells : c.buys) && (relations[c.id]?.score ?? 0) > -0.5);
}

/**
 * Reservation premium vs the index for a counterparty on a template, $/bbl:
 *   seller: minimum premium it accepts (lower when its region is long or it likes you)
 *   buyer:  maximum premium it pays (higher when its region is short or it likes you)
 */
export function reservation(c: Counterparty, t: Pick<Template, "side" | "product" | "hub">, m: MarketState, rel: number): number {
  const stock = m.stocks[HUB_REGION[t.hub]][t.product];
  const base = c.minSpread * SPREAD_REGIME_MULT[m.regime];
  return t.side === "buy" ? base - STOCK_SPREAD.value * stock - 0.3 * rel : -base - STOCK_SPREAD.value * stock + 0.3 * rel;
}

export interface OfferContext {
  regime: Regime;
  relations: Record<string, Relation>;
}

export function makeOffer(rng: Rng, m: MarketState, id: string, expiresDay: number, ctx: OfferContext, opts?: { template?: Template; cpty?: Counterparty; spreadMult?: number }): Offer | null {
  // Fundamentals drive the flow: long regions offer cargoes, short regions bid for them.
  const t =
    opts?.template ??
    weighted(rng, TEMPLATES, (x) => {
      const s = m.stocks[HUB_REGION[x.hub]][x.product];
      return x.weight * exp((x.side === "buy" ? 0.08 : -0.08) * Math.max(-15, Math.min(15, s)));
    })!;
  const cands = candidates(t, ctx.relations);
  const c = opts?.cpty ?? weighted(rng, cands, (x) => 1 + (ctx.relations[x.id]?.score ?? 0));
  if (!c) return null;
  const rel = ctx.relations[c.id]?.score ?? 0;
  const tonnes = VESSELS[t.cls].cargoTonnes.value * (c.kind === "noc" ? 1 : 0.95 + 0.1 * rng.uniform());
  const qtyBbl = t.incoterm === "ITT" ? 50_000 * (2 + rng.int(5)) : Math.round(tonnesToBbl(tonnes, t.product) / 1000) * 1000;
  // Laycans: purchases load soon; delivered sales leave time to ship a cargo there.
  const start =
    t.incoterm === "ITT" ? nextBusinessDay(m.day + 2 + rng.int(4)) : t.incoterm === "FOB" ? nextBusinessDay(m.day + 7 + rng.int(14)) : nextBusinessDay(m.day + 24 + rng.int(18));
  const len = t.incoterm === "ITT" ? 2 : t.incoterm === "FOB" ? 4 : 6;
  const kinds: PricingKind[] = ["bl5", "bl5", "bl5", "post5", "month", "fixed"];
  const kind = rng.pick(kinds);
  const r = reservation(c, t, m, rel) * (opts?.spreadMult ?? 1);
  const sign = t.side === "buy" ? 1 : -1;
  // Opening price: reservation plus a markup; now and then a counterparty misjudges and leaves edge on the table.
  const markup = c.markup * (0.5 + rng.uniform());
  const opening = rng.bernoulli(0.08) ? r - sign * (0.3 + 0.7 * rng.uniform()) : r + sign * markup;
  const diff = Math.round(opening * 20) / 20;
  const M = hubPrice(m, t.hub, t.product);
  const pricing: Pricing = { kind, diff };
  if (kind === "fixed") pricing.fixedPrice = Math.round(M * 100) / 100;
  if (kind === "month") {
    const { y, m: mo } = ymd(start);
    pricing.month = { y, m: mo };
  }
  return {
    id,
    playerSide: t.side,
    cpty: c.id,
    cptyName: c.name,
    product: t.product,
    hub: t.hub,
    incoterm: t.incoterm,
    qtyBbl,
    tolPct: t.incoterm === "ITT" ? 0 : 5,
    tolHolder: t.incoterm === "FOB" && t.side === "buy" ? "player" : "cpty",
    laycan: [start, start + len],
    pricing,
    payment: c.payment,
    defaultRisk: defaultProbability(c, ctx.regime),
    expiresDay,
    indicative: (kind === "fixed" ? pricing.fixedPrice! : M) + diff,
    vesselClass: t.cls,
    note: t.note,
    reservation: r,
    rounds: 0,
  };
}

/** Weekly deal flow. */
export function weeklyOffers(rng: Rng, m: MarketState, firstId: number, expiresDay: number, ctx: OfferContext, n = 9): Offer[] {
  const out: Offer[] = [];
  for (let i = 0; i < n; i++) {
    const o = makeOffer(rng, m, `of${firstId + i}`, expiresDay, ctx);
    if (o) out.push(o);
  }
  return out;
}

/** The player asks the market for a specific quote: wider spread (you showed your hand). */
export function requestQuote(rng: Rng, m: MarketState, id: string, expiresDay: number, ctx: OfferContext, want: { side: "buy" | "sell"; product: ProductId; hub: HubId; incoterm: Incoterm }): Offer | null {
  const cls: VesselClass = want.hub === "MEG" || want.hub === "FUJ" ? "LR1" : "MR";
  const template: Template = { ...want, cls, weight: 1, note: "Requested quote" };
  return makeOffer(rng, m, id, expiresDay, ctx, { template, spreadMult: 1.4 });
}

export type CounterResult = { outcome: "accepted"; diff: number } | { outcome: "countered"; diff: number } | { outcome: "walked" };

/**
 * Negotiate: the player proposes a premium. The counterparty accepts anything at or better than
 * its reservation; otherwise it may split the difference (never past its reservation) or walk.
 */
export function negotiate(rng: Rng, o: Offer, proposed: number, c: Counterparty, rel: number): CounterResult {
  const sign = o.playerSide === "buy" ? 1 : -1;
  const better = sign * (proposed - o.reservation) >= -1e-9; // cpty sells: proposed ≥ reservation
  if (better) return { outcome: "accepted", diff: proposed };
  const patience = Math.min(0.95, c.patience + 0.2 * rel - 0.15 * o.rounds);
  if (o.rounds >= 3 || !rng.bernoulli(patience)) return { outcome: "walked" };
  const mid = (o.pricing.diff + proposed) / 2;
  const next = sign > 0 ? Math.max(o.reservation, mid) : Math.min(o.reservation, mid);
  return { outcome: "countered", diff: Math.round(next * 20) / 20 };
}

// ---------------------------------------------------------------- tenders

export interface Tender {
  id: string;
  cpty: string;
  cptyName: string;
  /** player's side if they win */
  playerSide: "buy" | "sell";
  product: ProductId;
  hub: HubId;
  incoterm: Incoterm;
  qtyBbl: number;
  laycan: [number, number];
  closeDay: number;
  competitors: number;
  status: "open" | "won" | "lost" | "cancelled";
  bid?: number;
  winning?: number;
  dealId?: string;
}

export const TENDER_NOTE = est("sealed bid", "-", "model design", "competitors quote around the market-clearing premium with noise; the national oil company awards the best price, if it beats its cap");

export function maybeTender(rng: Rng, m: MarketState, id: string, ctx: OfferContext): Tender | null {
  const issuers = ROSTER.filter((c) => c.tenders && (ctx.relations[c.id]?.score ?? 0) > -0.5);
  if (!issuers.length || !rng.bernoulli(0.45)) return null;
  const c = rng.pick(issuers);
  const tt = c.tenders!;
  const cls: VesselClass = tt.hub === "MEG" ? "LR1" : "MR";
  const qtyBbl = Math.round(tonnesToBbl(VESSELS[cls].cargoTonnes.value, tt.product) / 1000) * 1000;
  // NOC buys delivered (player sells DES); NOC sells FOB (player buys)
  const playerSide = tt.side === "buy" ? "sell" : "buy";
  const start = nextBusinessDay(m.day + (playerSide === "sell" ? 28 : 12) + rng.int(10));
  return {
    id,
    cpty: c.id,
    cptyName: c.name,
    playerSide,
    product: tt.product,
    hub: tt.hub,
    incoterm: playerSide === "sell" ? "DES" : "FOB",
    qtyBbl,
    laycan: [start, start + (playerSide === "sell" ? 6 : 4)],
    closeDay: nextBusinessDay(m.day + 3),
    competitors: 3 + rng.int(4),
    status: "open",
  };
}

/** Best competing premium in a tender (lowest offer when the NOC buys, highest bid when it sells). */
export function tenderCompetition(rng: Rng, t: Tender, m: MarketState): number {
  const stock = m.stocks[HUB_REGION[t.hub]][t.product];
  const centre = t.playerSide === "sell" ? 0.5 * SPREAD_REGIME_MULT[m.regime] - STOCK_SPREAD.value * stock : -0.3 * SPREAD_REGIME_MULT[m.regime] - STOCK_SPREAD.value * stock;
  let best = t.playerSide === "sell" ? Infinity : -Infinity;
  for (let i = 0; i < t.competitors; i++) {
    const q = centre + 0.45 * rng.normal();
    best = t.playerSide === "sell" ? Math.min(best, q) : Math.max(best, q);
  }
  return Math.round(best * 100) / 100;
}
