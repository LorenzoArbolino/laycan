/**
 * Rule-based counterparties. Offers and bids are priced against the model's assessed hub
 * price (the index) plus a premium or discount that depends on the counterparty's
 * personality, credit quality and a little noise. Fictional names only.
 */
import { isBusinessDay, ymd } from "../core/calendar";
import type { Rng } from "../core/rng";
import { tonnesToBbl, type ProductId } from "../core/units";
import { hubPrice, type MarketState } from "../market/market";
import type { Incoterm, Payment, Pricing, PricingKind } from "../book/types";
import { VESSELS, type HubId, type VesselClass } from "../world/world";

export interface Personality {
  id: string;
  name: string;
  kind: "major" | "refiner" | "trader" | "noc";
  /** typical premium/discount against the index, $/bbl */
  spread: number;
  payment: Payment;
  /** probability of failing to pay (open account only) */
  defaultRisk: number;
  blurb: string;
}

export const COUNTERPARTIES: readonly Personality[] = [
  { id: "major", name: "Meridian Energy (integrated major)", kind: "major", spread: 0.9, payment: { kind: "LC", days: 30 }, defaultRisk: 0, blurb: "Aggressive and well-informed; rarely leaves money on the table. Pays and asks for LCs." },
  { id: "refiner", name: "Bayside Refining (independent refiner)", kind: "refiner", spread: 0.6, payment: { kind: "LC", days: 30 }, defaultRisk: 0, blurb: "Cautious, needs to place or source barrels around run cuts. Fair prices." },
  { id: "trader", name: "Kestrel Trading (small trader)", kind: "trader", spread: 0.25, payment: { kind: "open", days: 30 }, defaultRisk: 0.04, blurb: "Sharp prices on open account terms. Credit risk is yours." },
  { id: "noc", name: "Coastal National Oil Co. (tender)", kind: "noc", spread: 0.5, payment: { kind: "LC", days: 30 }, defaultRisk: 0, blurb: "Large tenders on fixed terms. Reliable payer." },
];

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
  T("sell", "gasoline", "WAF", "DES", "MR", 2, "West African gasoline tender"),
  T("sell", "diesel", "SIN", "DES", "LR1", 1, "Asian import demand"),
  T("sell", "diesel", "ARA", "CIF", "LR1", 1, "Large European diesel parcel, CIF"),
  T("sell", "gasoline", "ARA", "FOB", "MR", 0.7, "Buyer lifting from ARA tanks"),
  T("sell", "diesel", "USGC", "FOB", "MR", 0.7, "Buyer lifting from US Gulf tanks"),
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

function pickTemplate(rng: Rng): Template {
  const total = TEMPLATES.reduce((s, t) => s + t.weight, 0);
  let u = rng.uniform() * total;
  for (const t of TEMPLATES) {
    u -= t.weight;
    if (u <= 0) return t;
  }
  return TEMPLATES[0]!;
}

function nextBusinessDay(d: number): number {
  let x = d;
  while (!isBusinessDay(x)) x++;
  return x;
}

export function makeOffer(rng: Rng, m: MarketState, id: string, expiresDay: number, opts?: { template?: Template; cpty?: Personality; spreadMult?: number }): Offer {
  const t = opts?.template ?? pickTemplate(rng);
  const c = opts?.cpty ?? rng.pick(COUNTERPARTIES);
  const tonnes = VESSELS[t.cls].cargoTonnes.value * (c.kind === "noc" ? 1 : 0.95 + 0.1 * rng.uniform());
  const qtyBbl = t.incoterm === "ITT" ? 50_000 * (2 + rng.int(5)) : Math.round(tonnesToBbl(tonnes, t.product) / 1000) * 1000;
  // Laycans: purchases load soon; delivered sales leave time to ship a cargo there.
  const start =
    t.incoterm === "ITT" ? nextBusinessDay(m.day + 2 + rng.int(4)) : t.incoterm === "FOB" ? nextBusinessDay(m.day + 7 + rng.int(14)) : nextBusinessDay(m.day + 24 + rng.int(18));
  const len = t.incoterm === "ITT" ? 2 : t.incoterm === "FOB" ? 4 : 6;
  const kinds: PricingKind[] = ["bl5", "bl5", "bl5", "post5", "month", "fixed"];
  const kind = rng.pick(kinds);
  const spreadMult = opts?.spreadMult ?? 1;
  // Counterparty sells at a premium, buys at a discount. Occasionally misprices in the player's favour.
  const edge = (c.spread * spreadMult * (0.5 + rng.uniform()) - (rng.bernoulli(0.12) ? 1.2 + rng.uniform() : 0)) * (t.side === "buy" ? 1 : -1);
  const diff = Math.round(edge * 20) / 20;
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
    defaultRisk: c.defaultRisk,
    expiresDay,
    indicative: (kind === "fixed" ? pricing.fixedPrice! : M) + diff,
    vesselClass: t.cls,
    note: t.note,
  };
}

/** Weekly deal flow: a fixed number of offers per decision point, so the market stream is unaffected by player actions. */
export function weeklyOffers(rng: Rng, m: MarketState, firstId: number, expiresDay: number, n = 8): Offer[] {
  const out: Offer[] = [];
  for (let i = 0; i < n; i++) out.push(makeOffer(rng, m, `of${firstId + i}`, expiresDay));
  return out;
}

/** The player asks the market for a specific quote: wider spread (you showed your hand). */
export function requestQuote(rng: Rng, m: MarketState, id: string, expiresDay: number, want: { side: "buy" | "sell"; product: ProductId; hub: HubId; incoterm: Incoterm }): Offer {
  const cls: VesselClass = want.hub === "MEG" || want.hub === "FUJ" ? "LR1" : "MR";
  const template: Template = { ...want, cls, weight: 1, note: "Requested quote" };
  return makeOffer(rng, m, id, expiresDay, { template, spreadMult: 1.4 });
}
