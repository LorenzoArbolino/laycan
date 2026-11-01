/**
 * Gasoline blending: combine refinery components in a leased tank to make on-spec finished
 * gasoline at minimum cost, a linear program (the classic refinery blending problem).
 *
 * Blending rules (volume basis unless stated):
 *   octane (RON, MON)    linear in blending octane numbers
 *   vapour pressure      linear in the RVP index RVP^1.25
 *   sulphur, oxygen      linear by mass (volume × density)
 *   aromatics, olefins,
 *   benzene, ethanol     linear by volume
 */
import { pow } from "../core/dmath";
import { ymd } from "../core/calendar";
import { hubPrice, type MarketState } from "../market/market";
import { est, type Param } from "../params/param";
import type { HubId } from "../world/world";
import { solveLP } from "./lp";

export type ComponentId = "butane" | "lvn" | "isomerate" | "reformate" | "fcc" | "alkylate" | "ethanol";
export const COMPONENTS: readonly ComponentId[] = ["butane", "lvn", "isomerate", "reformate", "fcc", "alkylate", "ethanol"];

export interface ComponentSpec {
  id: ComponentId;
  name: string;
  ron: number;
  mon: number;
  /** blending vapour pressure, kPa */
  rvp: number;
  /** sulphur, mg/kg */
  sulphur: number;
  aromatics: number;
  olefins: number;
  benzene: number;
  /** oxygen, wt% */
  oxygen: number;
  density: number;
  note: string;
}

const lit = "typical refinery component properties (textbook ranges; blending values for ethanol and butane)";
/** Typical properties. Values are representative, not a specific refinery's assay. */
export const COMPONENT_DATA: Param<Record<ComponentId, ComponentSpec>> = est(
  {
    butane: { id: "butane", name: "Normal butane", ron: 94, mon: 89, rvp: 360, sulphur: 0, aromatics: 0, olefins: 0, benzene: 0, oxygen: 0, density: 0.584, note: "cheap octane but very volatile: RVP limits it, especially in summer" },
    lvn: { id: "lvn", name: "Light virgin naphtha", ron: 68, mon: 66, rvp: 80, sulphur: 5, aromatics: 3, olefins: 0, benzene: 1.5, oxygen: 0, density: 0.66, note: "cheap, low octane, naphtha-priced" },
    isomerate: { id: "isomerate", name: "Isomerate", ron: 87, mon: 85, rvp: 90, sulphur: 1, aromatics: 0, olefins: 0, benzene: 0, oxygen: 0, density: 0.65, note: "upgraded light naphtha, clean but volatile" },
    reformate: { id: "reformate", name: "Reformate", ron: 98, mon: 88, rvp: 21, sulphur: 1, aromatics: 65, olefins: 1, benzene: 3, oxygen: 0, density: 0.81, note: "high octane, but aromatics and benzene are capped" },
    fcc: { id: "fcc", name: "FCC (cat) gasoline", ron: 92, mon: 80, rvp: 34, sulphur: 8, aromatics: 25, olefins: 30, benzene: 1, oxygen: 0, density: 0.74, note: "the workhorse; olefins are capped" },
    alkylate: { id: "alkylate", name: "Alkylate", ron: 95, mon: 92, rvp: 28, sulphur: 2, aromatics: 0, olefins: 0, benzene: 0, oxygen: 0, density: 0.7, note: "premium clean octane, priced accordingly" },
    ethanol: { id: "ethanol", name: "Ethanol", ron: 115, mon: 98, rvp: 124, sulphur: 0, aromatics: 0, olefins: 0, benzene: 0, oxygen: 34.7, density: 0.794, note: "high blending octane; capped at 10% (E10) and by oxygen" },
  },
  "-",
  lit,
);

export interface GradeSpec {
  id: string;
  name: string;
  /** minimum (R+M)/2 when set; otherwise RON and MON minima */
  ronMin?: number;
  monMin?: number;
  akiMin?: number;
  rvpMin: number;
  rvpMax: number;
  sulphurMax: number;
  aromaticsMax: number;
  olefinsMax: number;
  benzeneMax: number;
  oxygenMax: number;
  ethanolMax: number;
  source: string;
}

/** Summer vapour-pressure season (approximation of national calendars). */
export function isSummer(day: number): boolean {
  const { m, d } = ymd(day);
  return (m > 4 && m < 9) || (m === 9 && d <= 15);
}

export function gradeFor(hub: HubId, day: number): GradeSpec {
  const summer = isSummer(day);
  if (hub === "USGC" || hub === "NYH") {
    return {
      id: summer ? "us-regular-summer" : "us-regular-winter",
      name: `US regular 87 (${summer ? "summer 9.0 psi" : "winter"})`,
      akiMin: 87,
      rvpMin: 0,
      rvpMax: summer ? 62 : 93,
      sulphurMax: 10,
      aromaticsMax: 100,
      olefinsMax: 100,
      benzeneMax: 1.0,
      oxygenMax: 4.0,
      ethanolMax: 10,
      source: "ASTM D4814 / EPA summer RVP 9.0 psi; Tier 3 sulphur 10 ppm (average); benzene capped at 1.0% here",
    };
  }
  return {
    id: summer ? "en228-e10-summer" : "en228-e10-winter",
    name: `EN 228 E10 95 RON (${summer ? "summer" : "winter"})`,
    ronMin: 95,
    monMin: 85,
    rvpMin: summer ? 45 : 60,
    rvpMax: summer ? 60 : 90,
    sulphurMax: 10,
    aromaticsMax: 35,
    olefinsMax: 18,
    benzeneMax: 1.0,
    oxygenMax: 3.7,
    ethanolMax: 10,
    source: "EN 228:2012+A1:2017 (E10): RON 95, MON 85, aromatics 35%, olefins 18%, benzene 1%, oxygen 3.7%, ethanol 10%, S 10 mg/kg; volatility classes A (summer) and C/D (winter) approximated",
  };
}

export const BLEND_FEE: Param = est(0.35, "$/bbl", "terminal blending, additives and inspection, order of magnitude");

/**
 * Component prices at a hub, $/bbl, derived from the market (estimates). Octane carriers carry
 * a premium that grows with the gasoline crack; butane is cheap and dearer in winter, when RVP
 * rules let more of it into the pool.
 */
export function componentPrices(m: MarketState, hub: HubId): Record<ComponentId, number> {
  const G = hubPrice(m, hub, "gasoline");
  const crack = Math.max(0, G - m.brent);
  const summer = isSummer(m.day);
  const europe = hub === "ARA" || hub === "SIN";
  return {
    butane: G * (summer ? 0.55 : 0.68),
    lvn: m.brent + 1.5,
    isomerate: G + 0.5,
    reformate: G + 2 + 0.1 * crack,
    fcc: europe ? G - 2.5 : G - 0.8,
    alkylate: G + 5 + 0.15 * crack,
    ethanol: europe ? G + 14 : G - 2,
  };
}
export const COMPONENT_PRICE_NOTE = est(
  "formula",
  "$/bbl",
  "relationships typical of 2015-2025 markets; not observed prices",
  "butane 55% (summer) / 68% (winter) of gasoline; LVN = Brent + 1.5; isomerate G + 0.5; reformate G + 2 + 10% of crack; FCC G − 2.5 in Europe (95 RON pool) and G − 0.8 in the US (FCC is nearly finished regular); alkylate G + 5 + 15% of crack; ethanol G + 14 in Europe, G − 2 in the US",
);

export type Recipe = Partial<Record<ComponentId, number>>;

export interface BlendQuality {
  ron: number;
  mon: number;
  aki: number;
  rvp: number;
  sulphur: number;
  aromatics: number;
  olefins: number;
  benzene: number;
  oxygen: number;
  ethanol: number;
}

export interface SpecCheck {
  key: keyof BlendQuality;
  label: string;
  value: number;
  limit: string;
  ok: boolean;
}

function normalise(r: Recipe): Record<ComponentId, number> {
  const out = {} as Record<ComponentId, number>;
  let s = 0;
  for (const c of COMPONENTS) s += Math.max(0, r[c] ?? 0);
  for (const c of COMPONENTS) out[c] = s > 0 ? Math.max(0, r[c] ?? 0) / s : 0;
  return out;
}

export function blendQuality(recipe: Recipe): BlendQuality {
  const x = normalise(recipe);
  const d = COMPONENT_DATA.value;
  let ron = 0,
    mon = 0,
    rvpi = 0,
    mass = 0,
    sMass = 0,
    oMass = 0,
    aro = 0,
    ole = 0,
    benz = 0;
  for (const c of COMPONENTS) {
    const v = x[c];
    const p = d[c];
    ron += v * p.ron;
    mon += v * p.mon;
    rvpi += v * pow(p.rvp, 1.25);
    mass += v * p.density;
    sMass += v * p.density * p.sulphur;
    oMass += v * p.density * p.oxygen;
    aro += v * p.aromatics;
    ole += v * p.olefins;
    benz += v * p.benzene;
  }
  return {
    ron,
    mon,
    aki: (ron + mon) / 2,
    rvp: pow(rvpi, 0.8),
    sulphur: mass > 0 ? sMass / mass : 0,
    aromatics: aro,
    olefins: ole,
    benzene: benz,
    oxygen: mass > 0 ? oMass / mass : 0,
    ethanol: x.ethanol * 100,
  };
}

export function checkSpec(q: BlendQuality, g: GradeSpec): SpecCheck[] {
  const out: SpecCheck[] = [];
  const min = (key: keyof BlendQuality, label: string, v: number | undefined) => v !== undefined && out.push({ key, label, value: q[key], limit: `≥ ${v}`, ok: q[key] >= v - 1e-6 });
  const max = (key: keyof BlendQuality, label: string, v: number) => v < 100 && out.push({ key, label, value: q[key], limit: `≤ ${v}`, ok: q[key] <= v + 1e-6 });
  min("ron", "RON", g.ronMin);
  min("mon", "MON", g.monMin);
  min("aki", "(R+M)/2", g.akiMin);
  if (g.rvpMin > 0) min("rvp", "Vapour pressure, kPa", g.rvpMin);
  max("rvp", "Vapour pressure, kPa", g.rvpMax);
  max("sulphur", "Sulphur, mg/kg", g.sulphurMax);
  max("aromatics", "Aromatics, %v", g.aromaticsMax);
  max("olefins", "Olefins, %v", g.olefinsMax);
  max("benzene", "Benzene, %v", g.benzeneMax);
  max("oxygen", "Oxygen, %m", g.oxygenMax);
  max("ethanol", "Ethanol, %v", g.ethanolMax);
  return out;
}

export function recipeCost(recipe: Recipe, prices: Record<ComponentId, number>): number {
  const x = normalise(recipe);
  return COMPONENTS.reduce((s, c) => s + x[c] * prices[c], 0);
}

/** Cheapest on-spec recipe (volume fractions), or null if no blend can meet the grade. */
export function optimalRecipe(prices: Record<ComponentId, number>, g: GradeSpec): Record<ComponentId, number> | null {
  const d = COMPONENT_DATA.value;
  const n = COMPONENTS.length;
  const col = (f: (p: ComponentSpec) => number) => COMPONENTS.map((c) => f(d[c]));
  const aUb: number[][] = [];
  const bUb: number[] = [];
  const le = (row: number[], b: number) => {
    aUb.push(row);
    bUb.push(b);
  };
  if (g.ronMin !== undefined) le(col((p) => -p.ron), -g.ronMin);
  if (g.monMin !== undefined) le(col((p) => -p.mon), -g.monMin);
  if (g.akiMin !== undefined) le(col((p) => -(p.ron + p.mon) / 2), -g.akiMin);
  le(col((p) => pow(p.rvp, 1.25)), pow(g.rvpMax, 1.25));
  if (g.rvpMin > 0) le(col((p) => -pow(p.rvp, 1.25)), -pow(g.rvpMin, 1.25));
  le(col((p) => p.density * (p.sulphur - g.sulphurMax)), 0);
  le(col((p) => p.density * (p.oxygen - g.oxygenMax)), 0);
  if (g.aromaticsMax < 100) le(col((p) => p.aromatics), g.aromaticsMax);
  if (g.olefinsMax < 100) le(col((p) => p.olefins), g.olefinsMax);
  le(col((p) => p.benzene), g.benzeneMax);
  le(COMPONENTS.map((c) => (c === "ethanol" ? 100 : 0)), g.ethanolMax);
  const res = solveLP({ c: COMPONENTS.map((c) => prices[c]), aUb, bUb, aEq: [new Array<number>(n).fill(1)], bEq: [1] });
  if (res.status !== "optimal") return null;
  const out = {} as Record<ComponentId, number>;
  COMPONENTS.forEach((c, i) => (out[c] = Math.max(0, res.x[i]!)));
  return out;
}

/** Discount applied to an off-spec blend (re-blending, claims), $/bbl. */
export function offSpecDiscount(checks: SpecCheck[]): number {
  const failed = checks.filter((c) => !c.ok).length;
  return failed === 0 ? 0 : 2 + 1 * failed;
}
export const OFFSPEC_NOTE = est("2 + 1 per failed spec", "$/bbl", "cost of re-blending, downgrading or a buyer's claim, order of magnitude");
