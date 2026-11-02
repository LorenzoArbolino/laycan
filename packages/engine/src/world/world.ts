/**
 * The physical world: hubs, vessel classes, chokepoints and routes.
 * Distances come from params/calibration.json (searoute on the Eurostat MARNET network).
 */
import calibration from "../../../../params/calibration.json" with { type: "json" };
import { est, type Param } from "../params/param";
import type { ProductId } from "../core/units";

export type HubId = "USGC" | "NYH" | "ARA" | "WAF" | "MEG" | "FUJ" | "SIN" | "JPN";
export const HUBS: readonly HubId[] = ["USGC", "NYH", "ARA", "WAF", "MEG", "FUJ", "SIN", "JPN"];

/** Balance regions for the fundamentals layer. */
export type RegionId = "US" | "EU" | "WAF" | "ME" | "ASIA";
export const REGIONS: readonly RegionId[] = ["US", "EU", "WAF", "ME", "ASIA"];
export const REGION_NAME: Record<RegionId, string> = { US: "United States", EU: "Northwest Europe", WAF: "West Africa", ME: "Middle East", ASIA: "Asia" };
export const HUB_REGION: Record<HubId, RegionId> = { USGC: "US", NYH: "US", ARA: "EU", WAF: "WAF", MEG: "ME", FUJ: "ME", SIN: "ASIA", JPN: "ASIA" };

export interface Hub {
  id: HubId;
  name: string;
  region: string;
  /** [lon, lat] for maps */
  coords: [number, number];
  role: string;
}

export const HUB_INFO: Record<HubId, Hub> = {
  USGC: { id: "USGC", name: "US Gulf Coast", region: "Americas", coords: [-94.9, 29.3], role: "Refining surplus; exports diesel and gasoline. Benchmark hub for all three products." },
  NYH: { id: "NYH", name: "New York Harbor", region: "Americas", coords: [-74.05, 40.6], role: "US East Coast demand hub; NYMEX delivery point." },
  ARA: { id: "ARA", name: "Amsterdam-Rotterdam-Antwerp", region: "Europe", coords: [4.0, 51.95], role: "European hub: gasoline surplus, diesel and jet deficit. ICE Gasoil delivery area." },
  WAF: { id: "WAF", name: "West Africa (Lagos/Lomé)", region: "Africa", coords: [3.35, 6.4], role: "Two-way hub: imports gasoline, exports diesel and jet since Dangote reached full rate." },
  MEG: { id: "MEG", name: "Middle East Gulf (inside Hormuz)", region: "Middle East", coords: [50.2, 26.7], role: "Large export refineries; diesel and jet to Europe and Asia. Exits through Hormuz." },
  FUJ: { id: "FUJ", name: "Fujairah (outside Hormuz)", region: "Middle East", coords: [56.4, 25.15], role: "Storage, bunkering and ship-to-ship hub on the Gulf of Oman side." },
  SIN: { id: "SIN", name: "Singapore", region: "Asia", coords: [103.8, 1.2], role: "Asian hub and price reference." },
  JPN: { id: "JPN", name: "Japan (Tokyo Bay)", region: "Asia", coords: [139.85, 35.45], role: "Large, ageing refining base with shrinking domestic demand: exports diesel and jet, imports some gasoline and Middle East barrels." },
};

export type VesselClass = "MR" | "LR1" | "LR2";

export interface VesselSpec {
  cls: VesselClass;
  cargoTonnes: Param;
  speedKnots: Param;
  seaConsumptionTpd: Param;
  portConsumptionTpd: Param;
  hullValueUsd: Param;
  portCostPerCallUsd: Param;
  laytimeHours: Param;
}

const vsrc = "industry rules of thumb for clean product tankers";
export const VESSELS: Record<VesselClass, VesselSpec> = {
  MR: {
    cls: "MR",
    cargoTonnes: est(37_000, "t", "Baltic TC2/TC14 route sizes (37-38 kt)"),
    speedKnots: est(13, "kn", vsrc),
    seaConsumptionTpd: est(30, "t/day", vsrc),
    portConsumptionTpd: est(8, "t/day", vsrc),
    hullValueUsd: est(45e6, "$", "secondhand MR value range, mid-2020s"),
    portCostPerCallUsd: est(120_000, "$", "port dues, agency, pilotage per call"),
    laytimeHours: est(72, "h", "typical total laytime load+discharge, voyage charter"),
  },
  LR1: {
    cls: "LR1",
    cargoTonnes: est(65_000, "t", "Baltic TC8 route size (65 kt)"),
    speedKnots: est(13, "kn", vsrc),
    seaConsumptionTpd: est(38, "t/day", vsrc),
    portConsumptionTpd: est(10, "t/day", vsrc),
    hullValueUsd: est(60e6, "$", "secondhand LR1 value range"),
    portCostPerCallUsd: est(160_000, "$", "port costs per call"),
    laytimeHours: est(84, "h", "typical total laytime"),
  },
  LR2: {
    cls: "LR2",
    cargoTonnes: est(75_000, "t", "Baltic TC1 route size (75 kt)"),
    speedKnots: est(13, "kn", vsrc),
    seaConsumptionTpd: est(45, "t/day", vsrc),
    portConsumptionTpd: est(12, "t/day", vsrc),
    hullValueUsd: est(75e6, "$", "secondhand LR2 value range"),
    portCostPerCallUsd: est(190_000, "$", "port costs per call"),
    laytimeHours: est(96, "h", "typical total laytime"),
  },
};

export type ChokepointId = "hormuz" | "babelmandeb" | "suez";
export const CHOKEPOINTS: readonly ChokepointId[] = ["hormuz", "babelmandeb", "suez"];
export type ChokeState = "open" | "restricted" | "closed";

export interface ChokepointSpec {
  id: ChokepointId;
  name: string;
  /** war-risk additional premium as % of hull value per transit, by state */
  warRiskPctHull: Record<ChokeState, Param>;
  /** expected extra delay days per transit, by state */
  delayDays: Record<ChokeState, Param>;
  /** probability per transit that the vessel is involved in a security incident */
  incidentProb: Record<ChokeState, Param>;
  /** canal / transit fee by vessel class */
  transitFeeUsd?: Record<VesselClass, Param>;
}

const wsrc = "war-risk market reporting 2024-2026 (Red Sea, Hormuz); orders of magnitude only";
export const CHOKEPOINT_INFO: Record<ChokepointId, ChokepointSpec> = {
  hormuz: {
    id: "hormuz",
    name: "Strait of Hormuz",
    warRiskPctHull: { open: est(0.05, "%", wsrc), restricted: est(1.0, "%", wsrc), closed: est(3.0, "%", wsrc) },
    delayDays: { open: est(0, "days", wsrc), restricted: est(3, "days", wsrc, "convoy/inspection queues"), closed: est(0, "days", wsrc) },
    incidentProb: { open: est(0.0005, "prob", wsrc), restricted: est(0.015, "prob", wsrc, "~28 incidents per ~400 transits in early Oct 2026, most not cargo-damaging"), closed: est(0.05, "prob", wsrc) },
  },
  babelmandeb: {
    id: "babelmandeb",
    name: "Bab-el-Mandeb / Red Sea",
    warRiskPctHull: { open: est(0.05, "%", wsrc), restricted: est(0.7, "%", wsrc), closed: est(2.0, "%", wsrc) },
    delayDays: { open: est(0, "days", wsrc), restricted: est(1, "days", wsrc), closed: est(0, "days", wsrc) },
    incidentProb: { open: est(0.0005, "prob", wsrc), restricted: est(0.006, "prob", wsrc), closed: est(0.03, "prob", wsrc) },
  },
  suez: {
    id: "suez",
    name: "Suez Canal",
    warRiskPctHull: { open: est(0, "%", wsrc), restricted: est(0.05, "%", wsrc), closed: est(0, "%", wsrc) },
    delayDays: { open: est(1, "days", "canal transit and convoy wait"), restricted: est(4, "days", "congestion"), closed: est(0, "days", wsrc) },
    incidentProb: { open: est(0, "prob", wsrc), restricted: est(0, "prob", wsrc), closed: est(0, "prob", wsrc) },
    transitFeeUsd: {
      MR: est(250_000, "$", "Suez Canal Authority toll calculators, laden product tanker; order of magnitude"),
      LR1: est(350_000, "$", "Suez Canal Authority toll calculators; order of magnitude"),
      LR2: est(450_000, "$", "Suez Canal Authority toll calculators; order of magnitude"),
    },
  },
};

export interface RouteVariant {
  via: "direct" | "suez" | "cape";
  distanceNm: number;
  chokepoints: ChokepointId[];
}

export interface RouteDef {
  id: string;
  from: HubId;
  to: HubId;
  cls: VesselClass;
  analogue: string;
  variants: RouteVariant[];
  /** route-specific TCE multiplier vs the vessel-class index (tonnage positioning), by scenario regime set */
  note: string;
}

const D = calibration.distances_nm.value as Record<string, number>;
const dist = (k: string): number => {
  const v = D[k];
  if (v === undefined) throw new Error(`missing distance ${k}`);
  return v;
};

export const ROUTES: readonly RouteDef[] = [
  { id: "TC2", from: "ARA", to: "NYH", cls: "MR", analogue: "Baltic TC2 (ARA → US Atlantic coast, 37 kt)", variants: [{ via: "direct", distanceNm: dist("ARA-NYH"), chokepoints: [] }], note: "Transatlantic gasoline" },
  { id: "TC14", from: "USGC", to: "ARA", cls: "MR", analogue: "Baltic TC14 (US Gulf → Continent, 38 kt)", variants: [{ via: "direct", distanceNm: dist("USGC-ARA"), chokepoints: [] }], note: "Transatlantic diesel" },
  { id: "TC19", from: "ARA", to: "WAF", cls: "MR", analogue: "Baltic TC19 (ARA → West Africa, 37 kt)", variants: [{ via: "direct", distanceNm: dist("ARA-WAF"), chokepoints: [] }], note: "Europe → West Africa gasoline" },
  { id: "WAF-ARA", from: "WAF", to: "ARA", cls: "MR", analogue: "no Baltic analogue (Nigeria → Europe products)", variants: [{ via: "direct", distanceNm: dist("WAF-ARA"), chokepoints: [] }], note: "Dangote exports to Europe" },
  {
    id: "TC8",
    from: "MEG",
    to: "ARA",
    cls: "LR1",
    analogue: "Baltic TC8 (Middle East Gulf → UK-Continent, 65 kt)",
    variants: [
      { via: "suez", distanceNm: dist("MEG-ARA-suez"), chokepoints: ["hormuz", "babelmandeb", "suez"] },
      { via: "cape", distanceNm: dist("MEG-ARA-cape"), chokepoints: ["hormuz"] },
    ],
    note: "East of Suez → Europe diesel/jet",
  },
  {
    id: "FUJ-ARA",
    from: "FUJ",
    to: "ARA",
    cls: "LR1",
    analogue: "TC8-type from outside Hormuz",
    variants: [
      { via: "suez", distanceNm: dist("FUJ-ARA-suez"), chokepoints: ["babelmandeb", "suez"] },
      { via: "cape", distanceNm: dist("FUJ-ARA-cape"), chokepoints: [] },
    ],
    note: "Hormuz bypass → Europe",
  },
  { id: "MEG-SIN", from: "MEG", to: "SIN", cls: "LR2", analogue: "TC1-type (Middle East Gulf → Asia), shorter haul", variants: [{ via: "direct", distanceNm: dist("MEG-SIN"), chokepoints: ["hormuz"] }], note: "Middle East → Asia" },
  { id: "FUJ-SIN", from: "FUJ", to: "SIN", cls: "LR1", analogue: "Fujairah → Singapore", variants: [{ via: "direct", distanceNm: dist("FUJ-SIN"), chokepoints: [] }], note: "Outside Hormuz → Asia" },
  { id: "USGC-NYH", from: "USGC", to: "NYH", cls: "MR", analogue: "Jones Act (US-flag) coastwise voyage", variants: [{ via: "direct", distanceNm: dist("USGC-NYH"), chokepoints: [] }], note: "Requires a US-flag vessel: expensive" },
  { id: "USGC-WAF", from: "USGC", to: "WAF", cls: "MR", analogue: "US Gulf → West Africa", variants: [{ via: "direct", distanceNm: dist("USGC-WAF"), chokepoints: [] }], note: "US gasoline to West Africa" },
  { id: "TC1", from: "MEG", to: "JPN", cls: "LR2", analogue: "Baltic TC1 (Middle East Gulf → Japan, 75 kt)", variants: [{ via: "direct", distanceNm: dist("MEG-JPN"), chokepoints: ["hormuz"] }], note: "Middle East → Japan" },
  { id: "JPN-SIN", from: "JPN", to: "SIN", cls: "MR", analogue: "Japan → Singapore", variants: [{ via: "direct", distanceNm: dist("JPN-SIN"), chokepoints: [] }], note: "Japanese diesel and jet exports" },
  { id: "SIN-JPN", from: "SIN", to: "JPN", cls: "MR", analogue: "Singapore → Japan", variants: [{ via: "direct", distanceNm: dist("SIN-JPN"), chokepoints: [] }], note: "Gasoline into Japan" },
];

export function routeById(id: string): RouteDef {
  const r = ROUTES.find((x) => x.id === id);
  if (!r) throw new Error(`unknown route ${id}`);
  return r;
}

export function routesFrom(hub: HubId): RouteDef[] {
  return ROUTES.filter((r) => r.from === hub);
}

/**
 * Price graph: how each hub's price for each product is anchored to another hub through
 * a route (arbitrage parity). Import hubs sit at anchor + freight, export hubs at
 * anchor − freight. USGC is the benchmark for all products (it has free daily data).
 */
export interface Anchor {
  hub: HubId;
  product: ProductId;
  anchor: HubId;
  /** route used for parity; null = no shipping parity (pipeline / calibrated OU) */
  route: string | null;
  /** import: price = anchor + θ·freight; export: price = anchor − θ·freight */
  dir: "import" | "export";
}

export const PRICE_GRAPH: readonly Anchor[] = [
  // NYH vs USGC is calibrated directly from data (Colonial pipeline / Jones Act economics)
  { hub: "NYH", product: "gasoline", anchor: "USGC", route: null, dir: "import" },
  { hub: "NYH", product: "diesel", anchor: "USGC", route: null, dir: "import" },
  { hub: "NYH", product: "jet", anchor: "USGC", route: null, dir: "import" },
  { hub: "ARA", product: "diesel", anchor: "USGC", route: "TC14", dir: "import" },
  { hub: "ARA", product: "jet", anchor: "USGC", route: "TC14", dir: "import" },
  { hub: "ARA", product: "gasoline", anchor: "NYH", route: "TC2", dir: "export" },
  { hub: "WAF", product: "gasoline", anchor: "ARA", route: "TC19", dir: "import" },
  { hub: "WAF", product: "diesel", anchor: "ARA", route: "WAF-ARA", dir: "export" },
  { hub: "WAF", product: "jet", anchor: "ARA", route: "WAF-ARA", dir: "export" },
  { hub: "MEG", product: "diesel", anchor: "ARA", route: "TC8", dir: "export" },
  { hub: "MEG", product: "jet", anchor: "ARA", route: "TC8", dir: "export" },
  { hub: "FUJ", product: "diesel", anchor: "ARA", route: "FUJ-ARA", dir: "export" },
  { hub: "FUJ", product: "jet", anchor: "ARA", route: "FUJ-ARA", dir: "export" },
  { hub: "SIN", product: "diesel", anchor: "MEG", route: "MEG-SIN", dir: "import" },
  { hub: "SIN", product: "jet", anchor: "MEG", route: "MEG-SIN", dir: "import" },
  // Singapore gasoline floats around USGC with no shipping parity (Asian balance); MEG/FUJ gasoline export to SIN
  { hub: "SIN", product: "gasoline", anchor: "USGC", route: null, dir: "import" },
  { hub: "MEG", product: "gasoline", anchor: "SIN", route: "MEG-SIN", dir: "export" },
  { hub: "FUJ", product: "gasoline", anchor: "SIN", route: "FUJ-SIN", dir: "export" },
  // Japan: long middle distillates (exports to Singapore), short gasoline at the margin
  { hub: "JPN", product: "diesel", anchor: "SIN", route: "JPN-SIN", dir: "export" },
  { hub: "JPN", product: "jet", anchor: "SIN", route: "JPN-SIN", dir: "export" },
  { hub: "JPN", product: "gasoline", anchor: "SIN", route: "SIN-JPN", dir: "import" },
];

export function anchorOf(hub: HubId, product: ProductId): Anchor | undefined {
  return PRICE_GRAPH.find((a) => a.hub === hub && a.product === product);
}
