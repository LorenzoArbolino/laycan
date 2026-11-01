import type { ProductId } from "../core/units";
import type { FuturesId } from "../market/futures";
import type { HubId, VesselClass } from "../world/world";

export const BUCKETS = [
  "flat_price",
  "crack",
  "regional",
  "time_spread",
  "quality",
  "freight",
  "optionality",
  "execution",
  "events",
  "finance",
] as const;
export type Bucket = (typeof BUCKETS)[number];
export type Leg = "physical" | "paper";

export const BUCKET_INFO: Record<Bucket, { label: string; explain: string }> = {
  flat_price: { label: "Flat price", explain: "Outright exposure to Brent: what an unhedged position gains or loses when crude moves." },
  crack: { label: "Crack", explain: "Exposure to the product margin over Brent (the refining crack) at the US Gulf benchmark." },
  regional: { label: "Regional / arb", explain: "Location spreads between hubs. Includes the value captured when a cargo is loaded for a higher-priced destination (the arbitrage)." },
  time_spread: { label: "Time spread & carry", explain: "Moves in curve structure (backwardation/contango), roll-down of futures towards expiry, and storage costs." },
  quality: { label: "Quality", explain: "Grade and off-spec effects on cargo value." },
  freight: { label: "Freight", explain: "Charter costs, war-risk premiums and cargo insurance booked when ships are fixed." },
  optionality: { label: "Optionality", explain: "Value from quantity tolerance choices and from pricing windows that fix around the bill-of-lading date." },
  execution: { label: "Deal edge", explain: "Premiums and discounts agreed with counterparties against the assessed price, marked on the day of the deal." },
  events: { label: "Events", explain: "Demurrage, delays, outturn losses, counterparty defaults, delivery penalties and reroutes." },
  finance: { label: "Finance", explain: "Interest on cash and the credit line, letter-of-credit fees, exchange fees." },
};

export type Attribution = Record<Bucket, Record<Leg, number>>;

export function emptyAttribution(): Attribution {
  const a = {} as Attribution;
  for (const b of BUCKETS) a[b] = { physical: 0, paper: 0 };
  return a;
}

export function addAttribution(into: Attribution, from: Attribution): void {
  for (const b of BUCKETS) {
    into[b].physical += from[b].physical;
    into[b].paper += from[b].paper;
  }
}

export function attributionTotal(a: Attribution): number {
  let s = 0;
  for (const b of BUCKETS) s += a[b].physical + a[b].paper;
  return s;
}

export type PricingKind = "bl5" | "post5" | "month" | "fixed";
export const PRICING_INFO: Record<PricingKind, string> = {
  bl5: "Average of 5 quotes around the delivery date (2 before, the day, 2 after)",
  post5: "Average of the 5 quotes from the delivery date onwards",
  month: "Average of all quotes in the delivery month",
  fixed: "Fixed price agreed today",
};

export interface Pricing {
  kind: PricingKind;
  /** premium (+) or discount (−) to the index, $/bbl */
  diff: number;
  fixedPrice?: number;
  /** for month pricing */
  month?: { y: number; m: number };
}

/** ITT = in-tank transfer: title passes inside a storage terminal at the hub. */
export type Incoterm = "FOB" | "CIF" | "DES" | "ITT";

export interface Payment {
  kind: "LC" | "open";
  days: number;
}

export interface Deal {
  id: string;
  side: "buy" | "sell";
  cpty: string;
  product: ProductId;
  hub: HubId;
  incoterm: Incoterm;
  qtyNominal: number;
  qty: number;
  tolPct: number;
  tolHolder: "player" | "cpty";
  laycan: [number, number];
  pricing: Pricing;
  payment: Payment;
  status: "open" | "delivered" | "settled" | "cancelled";
  createdDay: number;
  deliveryDay?: number;
  /** pricing window business days, once known */
  window?: number[];
  fixings: { day: number; price: number }[];
  dueDay?: number;
  voyageId?: string;
  /** delivery date drawn for counterparty-performed deliveries (DES purchases, FOB sales) */
  plannedDelivery?: number;
  lcOpen: boolean;
  defaultRisk: number;
  note?: string;
}

export interface Cargo {
  id: string;
  product: ProductId;
  qty: number;
  hub: HubId;
  where: "tank" | "vessel";
  voyageId?: string;
  qualityDiscount: number;
  sinceDay: number;
}

export type VoyageStatus = "fixed" | "loading" | "sailing" | "held" | "discharging" | "done" | "cancelled";

export interface Voyage {
  id: string;
  routeId: string;
  via: "direct" | "suez" | "cape";
  cls: VesselClass;
  from: HubId;
  to: HubId;
  product: ProductId | null;
  status: VoyageStatus;
  laycan: [number, number];
  fixedDay: number;
  arriveLoad: number;
  blDay?: number;
  arriveDisch?: number;
  doneDay?: number;
  sailDays: number;
  capacityTonnes: number;
  freightUsd: number;
  warRiskUsd: number;
  demurrageRate: number;
  laytimeHours: number;
  portHours: number;
  heldDays: number;
  purchaseId?: string;
  saleId?: string;
  cargoId?: string;
  /** pre-drawn micro-event outcomes (keyed RNG per voyage, so player actions elsewhere do not change them) */
  draws: {
    arrivalOffset: number;
    loadDelay: number;
    seaDelay: number;
    incident: boolean;
    incidentDelay: number;
    dischDelay: number;
    offSpec: boolean;
    offSpecDiscount: number;
    outturnLoss: number;
  };
}

export interface FuturesPosition {
  id: string;
  contract: FuturesId;
  y: number;
  m: number;
  expiry: number;
  lots: number;
  lastSettle: number;
  margin: number;
}

export interface Lease {
  id: string;
  hub: HubId;
  capacityBbl: number;
  feePerBblMonth: number;
  startDay: number;
  endDay: number;
}

export interface Payables {
  freight: number;
  demurrage: number;
}

export interface Book {
  cash: number;
  deals: Deal[];
  cargoes: Cargo[];
  voyages: Voyage[];
  futures: FuturesPosition[];
  leases: Lease[];
  payables: Payables;
  lcUsed: number;
  nextId: number;
}

export function emptyBook(cash: number): Book {
  return { cash, deals: [], cargoes: [], voyages: [], futures: [], leases: [], payables: { freight: 0, demurrage: 0 }, lcUsed: 0, nextId: 1 };
}
