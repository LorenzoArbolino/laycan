/**
 * Model parameters: fitted values from params/calibration.json (public EIA data) plus
 * labelled estimates for what public data cannot pin down. Scenario files override some
 * of these (levels, regime means) but never remove provenance.
 */
import calibration from "../../../../params/calibration.json";
import type { ProductId } from "../core/units";
import type { HubId, VesselClass } from "../world/world";
import { derived, est, type Param } from "./param";

export type Regime = "normal" | "stressed" | "war";
export const REGIMES: readonly Regime[] = ["normal", "stressed", "war"];

type CalParam<T> = { value: T; unit: string; label: "data" | "derived" | "estimate"; source: string; method: string; date: string };
const cal = calibration as unknown as {
  brent: Record<string, CalParam<number>>;
  cracks: Record<ProductId, { season_fourier: CalParam<number[]> } & Record<Regime, Record<"mean" | "kappa" | "sigma" | "jump_rate" | "jump_scale", CalParam<number>>>>;
  correlation: { order: string[] } & Record<Regime, CalParam<number[][]>>;
  regional_nyh_usgc: Record<"gasoline" | "diesel", Record<"mean" | "kappa" | "sigma" | "band_lo" | "band_hi", CalParam<number>>>;
  regime: { states: string[]; daily_transition: CalParam<number[][]> };
  hurricane: { gulf_hurricanes_per_year_by_month: CalParam<number[]> };
  window_means: Record<"now_last90" | "now_last30" | "normal_2023_2025", CalParam<Record<string, number>>>;
  snapshot_now: Record<string, CalParam<number | string>>;
  snapshot_normal_2025: Record<string, CalParam<number | string>>;
};
export { cal as calibration };

export interface CrackParams {
  season: Param<number[]>;
  byRegime: Record<Regime, { kappa: Param; sigma: Param; jumpRate: Param; jumpScale: Param; mean: Param }>;
}

const jumpCap = (p: CalParam<number>, cap: number): Param => ({
  ...p,
  value: Math.min(p.value, cap),
  method: `${p.method}; capped at ${cap} to remove data-error spikes`,
});

function crackParams(p: ProductId): CrackParams {
  const c = cal.cracks[p];
  const by = {} as CrackParams["byRegime"];
  for (const r of REGIMES) {
    by[r] = {
      kappa: c[r].kappa,
      sigma: c[r].sigma,
      jumpRate: c[r].jump_rate,
      jumpScale: jumpCap(c[r].jump_scale, r === "war" ? 20 : 12),
      mean: c[r].mean,
    };
  }
  return { season: c.season_fourier, byRegime: by };
}

export const MODEL = {
  brent: {
    omega: cal.brent.garch_omega!,
    alpha: cal.brent.garch_alpha!,
    beta: cal.brent.garch_beta!,
    nu: cal.brent.t_nu!,
    volMult: {
      normal: est(1, "x", "definition"),
      stressed: cal.brent.vol_mult_stressed!,
      war: cal.brent.vol_mult_war!,
    } as Record<Regime, Param>,
    jumpRate: cal.brent.jump_rate!,
    jumpScale: cal.brent.jump_scale!,
    /** weak pull of log-price towards a regime level, so 20-year paths stay plausible */
    levelKappa: est(0.002, "1/day", "model design", "weak mean reversion of log Brent; half-life ~1 year"),
    level: { normal: est(75, "$/bbl", "2010-2025 typical range"), stressed: est(60, "$/bbl", "GFC/COVID troughs"), war: est(110, "$/bbl", "2022 and 2026 war averages") } as Record<Regime, Param>,
  },
  cracks: { gasoline: crackParams("gasoline"), diesel: crackParams("diesel"), jet: crackParams("jet") } as Record<ProductId, CrackParams>,
  correlation: { normal: cal.correlation.normal, stressed: cal.correlation.stressed, war: cal.correlation.war } as Record<Regime, Param<number[][]>>,
  regimeTransition: cal.regime.daily_transition as Param<number[][]>,
  nyh: cal.regional_nyh_usgc,
  regional: {
    kappaIn: est(0.08, "1/day", "model design", "reversion of a hub differential to its parity point inside the arb band (half-life ~9 days, cf. NYH-USGC diesel 9.3 days in data)"),
    kappaOut: est(0.35, "1/day", "model design", "extra reversion once the arb is open: flows close it with a lag of a few days"),
    sigma: est(0.6, "$/bbl/day", "model design", "differential noise; NYH-USGC diesel robust sigma 0.3, gasoline 0.67 in data"),
    theta: est(0.85, "share of freight", "model design", "importing hubs sit at anchor + 85% of freight, exporting hubs at anchor − 85%: most of the time the arb is nearly but not fully open"),
    friction: est(0.6, "$/bbl", "insurance, losses, inspection, financing on a transatlantic cargo", "added to freight to define the arb bound"),
    strandedPremium: est(14, "$/bbl", "2026 Hormuz closure reporting; magnitude assumption", "when a hub's parity route is closed: exporters trade at a discount (glut), importers at a premium (shortage)"),
    jumpRate: est(2, "per year", "model design"),
    jumpScale: est(3, "$/bbl", "model design"),
  },
  freight: {
    kappa: est(0.03, "1/day", "model design", "log TCE mean reversion, half-life ~3 weeks"),
    sigma: est(0.035, "log/day", "model design", "daily log-TCE volatility"),
    jumpRate: est(3, "per year", "model design"),
    jumpScale: est(0.15, "log", "model design"),
    mean: {
      normal: { MR: est(22_000, "$/day", "clean tanker TCE, 2023-2025 order of magnitude"), LR1: est(28_000, "$/day", "clean tanker TCE, 2023-2025"), LR2: est(35_000, "$/day", "clean tanker TCE, 2023-2025") },
      stressed: { MR: est(18_000, "$/day", "demand-shock periods"), LR1: est(22_000, "$/day", "demand-shock periods"), LR2: est(28_000, "$/day", "demand-shock periods") },
      war: { MR: est(55_000, "$/day", "2022 and 2026 war periods"), LR1: est(170_000, "$/day", "2026 East-of-Suez rates"), LR2: est(200_000, "$/day", "2026 East-of-Suez rates") },
    } as Record<Regime, Record<VesselClass, Param>>,
    /** log-shift to class TCE targets per chokepoint state (tonne-mile absorption) */
    chokeShift: {
      hormuz: { restricted: { MR: 0.1, LR1: 0.4, LR2: 0.5 }, closed: { MR: 0.15, LR1: 0.6, LR2: 0.7 } },
      babelmandeb: { restricted: { MR: 0.1, LR1: 0.3, LR2: 0.2 }, closed: { MR: 0.15, LR1: 0.4, LR2: 0.3 } },
      suez: { restricted: { MR: 0.05, LR1: 0.1, LR2: 0.1 }, closed: { MR: 0.1, LR1: 0.2, LR2: 0.2 } },
    } as const,
    chokeShiftParam: est("table", "log", "Red Sea 2024 and Hormuz 2026 freight responses; magnitudes assumed", "longer voyages absorb tonnage and lift rates everywhere"),
    bunkerPerBrent: est(7.2, "($/t VLSFO)/($/bbl Brent)", "Rotterdam VLSFO vs Brent, 2023-2025 order of magnitude", "VLSFO = 7.2 × Brent"),
    ballastFraction: est(1.0, "share", "Baltic TCE convention", "rates assume a full ballast return leg; positioning shows up in route multipliers"),
    portDays: est(2, "days per port call", "industry rule of thumb"),
  },
  structure: {
    kappa: est(0.04, "1/day", "model design", "front spread mean reversion"),
    sigma: est(0.15, "$/bbl/month/day", "model design"),
    decay: est(0.88, "per month", "model design; ICE Gasoil curve shape, Oct 2026", "monthly spread shrinks by 12% per month along the curve"),
    mean: {
      normal: { brent: est(0.4, "$/bbl/month", "Brent backwardation 2023-2025"), gasoline: est(0.2, "$/bbl/month", "model design"), diesel: est(0.4, "$/bbl/month", "model design"), jet: est(0.4, "$/bbl/month", "model design") },
      stressed: { brent: est(-0.8, "$/bbl/month", "2020 super-contango, damped"), gasoline: est(-0.8, "$/bbl/month", "2020"), diesel: est(-0.8, "$/bbl/month", "2020"), jet: est(-1.2, "$/bbl/month", "2020") },
      war: {
        brent: est(3.0, "$/bbl/month", "spot Brent $123 vs Jan futures ~$113 (late Oct 2026)"),
        gasoline: est(1.5, "$/bbl/month", "model design"),
        diesel: derived(6.5, "$/bbl/month", "ICE Gasoil futures curve, 30 Oct 2026 (private calibration; exchange data not redistributed)", "front-month spreads ~$48-53/t ≈ $6.5-7/bbl"),
        jet: est(5.0, "$/bbl/month", "assumed slightly below diesel"),
      },
    } as Record<Regime, Record<"brent" | ProductId, Param>>,
  },
  hurricane: cal.hurricane.gulf_hurricanes_per_year_by_month as Param<number[]>,
};

/** Route-specific TCE multipliers against the class index: tonnage positioning (TC2 is a backhaul, TC14 is in demand). */
export type RouteMult = Record<string, Param>;

export const ROUTE_MULT_NORMAL: RouteMult = {
  TC2: est(0.75, "x", "TC2/TC14 lopsidedness, 2023-2025 typical"),
  TC14: est(1.1, "x", "TC2/TC14 lopsidedness, 2023-2025 typical"),
  TC19: est(1.0, "x", "model design"),
  "WAF-ARA": est(0.9, "x", "model design"),
  TC8: est(1.0, "x", "definition"),
  "FUJ-ARA": est(1.0, "x", "definition"),
  "MEG-SIN": est(1.0, "x", "definition"),
  "FUJ-SIN": est(0.9, "x", "model design"),
  "USGC-NYH": est(1.8, "x", "Jones Act premium for US-flag tonnage"),
  "USGC-WAF": est(1.0, "x", "model design"),
};

export const ROUTE_MULT_NOW: RouteMult = {
  TC2: { value: 8_600 / 61_000, unit: "x", label: "data", source: "Optima Shipbroking clean tanker summary, 19-20 Oct 2026 (TC2 TCE ~$8.6k/day vs MR Atlantic basket ~$61k/day)", method: "ratio of route TCE to class basket", date: "2026-10-20" },
  TC14: { value: 51_800 / 61_000, unit: "x", label: "data", source: "Optima, 19-20 Oct 2026 (TC14 TCE ~$51.8k/day)", method: "ratio of route TCE to class basket", date: "2026-10-20" },
  TC19: { value: 32_100 / 61_000, unit: "x", label: "data", source: "Optima, 19-20 Oct 2026 (TC19 TCE ~$32.1k/day)", method: "ratio of route TCE to class basket", date: "2026-10-20" },
  "WAF-ARA": est(0.6, "x", "assumed between TC19 and TC14"),
  TC8: est(1.0, "x", "definition (LR1 index is TC8)"),
  "FUJ-ARA": est(1.0, "x", "definition"),
  "MEG-SIN": est(1.0, "x", "definition (LR2 index is TC1-type)"),
  "FUJ-SIN": est(0.7, "x", "assumed: outside-Hormuz loading avoids the war premium on tonnage"),
  "USGC-NYH": est(1.5, "x", "Jones Act premium"),
  "USGC-WAF": est(0.7, "x", "assumed"),
};

export interface Scenario {
  id: string;
  name: string;
  description: string;
  startDate: string;
  weeks: number;
  regime: Regime;
  brent: Param;
  cracks: Record<ProductId, Param>;
  /** crack long-run means for the current regime (overrides the calibrated regime means) */
  regimeMeans: Partial<Record<Regime, Record<ProductId, Param>>>;
  nyhUsgc: Record<ProductId, Param>;
  nyhMeans: Partial<Record<Regime, Record<ProductId, Param>>>;
  freight: Record<VesselClass, Param>;
  routeMult: RouteMult;
  choke: Record<"hormuz" | "babelmandeb" | "suez", "open" | "restricted" | "closed">;
  chokeTransition: Record<"hormuz" | "babelmandeb" | "suez", Param<Record<string, Record<string, number>>>>;
  structure: Record<"brent" | ProductId, Param>;
  /** starting differentials that override parity at day 0 (rare) */
  diffOverrides?: Partial<Record<HubId, Partial<Record<ProductId, Param>>>>;
  finance: {
    equity: Param;
    overdraftLimit: Param;
    lcLimit: Param;
    borrowRate: Param;
    depositRate: Param;
    lcFeePct: Param;
    varLimit: Param;
  };
  eventRates: Record<string, Param>;
  news: string[];
}

const snapN = cal.snapshot_now as Record<string, CalParam<number>>;
const snap25 = cal.snapshot_normal_2025 as Record<string, CalParam<number>>;
const w30 = cal.window_means.now_last30;
const w23 = cal.window_means.normal_2023_2025;
const winParam = (w: CalParam<Record<string, number>>, k: string): Param => ({ ...w, value: w.value[k] ?? 0 });

const finance = (equity: number, rateNote: string) => ({
  equity: est(equity, "$", "game design: a mid-sized trading book"),
  overdraftLimit: est(40e6, "$", "game design: bank revolving credit line"),
  lcLimit: est(250e6, "$", "game design: letter-of-credit facility"),
  borrowRate: est(0.072, "1/yr", `SOFR-type base plus trade-finance spread (${rateNote})`),
  depositRate: est(0.035, "1/yr", "money-market rate"),
  lcFeePct: est(0.15, "% of LC value", "documentary LC opening and confirmation fees, order of magnitude"),
  varLimit: est(6e6, "$ 1-day 99%", "game design: desk risk limit"),
});

export const SCENARIOS: Record<string, Scenario> = {
  now_2026_11: {
    id: "now_2026_11",
    name: "Now — November 2026 (war regime)",
    description:
      "Initialised from public data to 27 Oct 2026: Hormuz restricted after the July re-closure, the Red Sea hazardous, Brent spot above $120, diesel cracks near records while gasoline collapses, East-of-Suez freight at extreme levels.",
    startDate: "2026-11-02",
    weeks: 12,
    regime: "war",
    brent: snapN.brent!,
    cracks: { gasoline: snapN.crack_usgc_gasoline!, diesel: snapN.crack_usgc_diesel!, jet: snapN.crack_usgc_jet! },
    regimeMeans: { war: { gasoline: winParam(w30, "gasoline"), diesel: winParam(w30, "diesel"), jet: winParam(w30, "jet") } },
    nyhUsgc: { gasoline: snapN.nyh_usgc_gasoline!, diesel: snapN.nyh_usgc_diesel!, jet: est(2, "$/bbl", "assumed: jet NYH-USGC similar to diesel") },
    nyhMeans: { war: { gasoline: winParam(w30, "nyh_usgc_gasoline"), diesel: winParam(w30, "nyh_usgc_diesel"), jet: est(4, "$/bbl", "assumed") } },
    freight: {
      MR: { value: 61_000, unit: "$/day", label: "data", source: "Optima Shipbroking, MR Atlantic basket TCE, 19 Oct 2026", method: "reported", date: "2026-10-20" },
      LR1: { value: 245_000, unit: "$/day", label: "data", source: "Optima Shipbroking, TC8 TCE, 19 Oct 2026", method: "reported", date: "2026-10-20" },
      LR2: { value: 282_000, unit: "$/day", label: "data", source: "Optima Shipbroking, TC1 TCE, 19 Oct 2026", method: "reported", date: "2026-10-20" },
    },
    routeMult: ROUTE_MULT_NOW,
    choke: { hormuz: "restricted", babelmandeb: "restricted", suez: "open" },
    chokeTransition: {
      hormuz: est({ open: { restricted: 0.004, closed: 0.001 }, restricted: { open: 0.004, closed: 0.008 }, closed: { restricted: 0.03, open: 0.003 } }, "prob/day", "2026 chronology: closed Mar, partly reopened Apr-Jun, closed Jul, restricted since; binary catalysts pending"),
      babelmandeb: est({ open: { restricted: 0.003, closed: 0.0005 }, restricted: { open: 0.003, closed: 0.002 }, closed: { restricted: 0.02, open: 0.002 } }, "prob/day", "Houthi campaign 2023-2026"),
      suez: est({ open: { restricted: 0.001, closed: 0.0002 }, restricted: { open: 0.05, closed: 0.001 }, closed: { open: 0.1, restricted: 0.05 } }, "prob/day", "Ever Given 2021: ~6-day closure"),
    },
    structure: { brent: MODEL.structure.mean.war.brent, gasoline: MODEL.structure.mean.war.gasoline, diesel: MODEL.structure.mean.war.diesel, jet: MODEL.structure.mean.war.jet },
    finance: finance(50e6, "Nov 2026"),
    eventRates: {
      exportBan: est(4, "per year", "Russia diesel/gasoline bans and China quota halts, 2023-2026 frequency"),
      refineryAttack: est(6, "per year", "Ukrainian drone strikes on Russian refineries; Houthi strikes on Saudi facilities, 2026"),
      refineryOutage: est(5, "per year", "unplanned outages large enough to move a regional price"),
      emergencyRelease: est(1.5, "per year", "IEA collective actions / SPR releases in war years"),
      gasSwitching: est(2, "per year (Dec-Feb only)", "record-low EU gas storage entering winter 2026"),
      blackSwan: est(0.8, "per year", "war-regime base rate of extreme shocks"),
    },
    news: [
      "Brent spot printed $123/bbl on 27 Oct; front futures settled near $113 at month end — a steep backwardation.",
      "US Gulf diesel crack ~$77/bbl over Brent; gasoline crack has collapsed to ~$7.",
      "Hormuz traffic runs at a fraction of normal under attack; war-risk cover is expensive and patchy.",
      "Red Sea 'operationally hazardous': Saudi-linked tankers routing via the Cape.",
      "TC8 (MEG → UK-Continent, LR1) at ~$245/t; TC2 (Europe → US gasoline) weak at ~$29/t.",
    ],
  },
  normal_2025: {
    id: "normal_2025",
    name: "Normal — November 2025 (baseline)",
    description: "A calmer baseline from public data around early November 2025: Brent in the $60s, moderate cracks, ordinary freight. Play it next to 'Now' to see how the same strategy behaves in another regime.",
    startDate: "2025-11-03",
    weeks: 12,
    regime: "normal",
    brent: snap25.brent!,
    cracks: { gasoline: snap25.crack_usgc_gasoline!, diesel: snap25.crack_usgc_diesel!, jet: snap25.crack_usgc_jet! },
    regimeMeans: { normal: { gasoline: winParam(w23, "gasoline"), diesel: winParam(w23, "diesel"), jet: winParam(w23, "jet") } },
    nyhUsgc: { gasoline: snap25.nyh_usgc_gasoline!, diesel: snap25.nyh_usgc_diesel!, jet: est(2.5, "$/bbl", "assumed") },
    nyhMeans: { normal: { gasoline: winParam(w23, "nyh_usgc_gasoline"), diesel: winParam(w23, "nyh_usgc_diesel"), jet: est(2.5, "$/bbl", "assumed") } },
    freight: { MR: MODEL.freight.mean.normal.MR, LR1: MODEL.freight.mean.normal.LR1, LR2: MODEL.freight.mean.normal.LR2 },
    routeMult: ROUTE_MULT_NORMAL,
    choke: { hormuz: "open", babelmandeb: "restricted", suez: "open" },
    chokeTransition: {
      hormuz: est({ open: { restricted: 0.0003, closed: 0.00005 }, restricted: { open: 0.02, closed: 0.003 }, closed: { restricted: 0.05, open: 0.01 } }, "prob/day", "pre-2026 base rates; low probability of escalation"),
      babelmandeb: est({ open: { restricted: 0.001, closed: 0.0002 }, restricted: { open: 0.006, closed: 0.001 }, closed: { restricted: 0.03, open: 0.005 } }, "prob/day", "late-2025: attacks paused but most tonnage still avoiding the Red Sea"),
      suez: est({ open: { restricted: 0.0005, closed: 0.0001 }, restricted: { open: 0.05, closed: 0.001 }, closed: { open: 0.1, restricted: 0.05 } }, "prob/day", "Ever Given 2021"),
    },
    structure: { brent: MODEL.structure.mean.normal.brent, gasoline: MODEL.structure.mean.normal.gasoline, diesel: MODEL.structure.mean.normal.diesel, jet: MODEL.structure.mean.normal.jet },
    finance: finance(50e6, "Nov 2025"),
    eventRates: {
      exportBan: est(1, "per year", "Russia/China product export restrictions, 2023-2025"),
      refineryAttack: est(1, "per year", "drone strikes, 2024-2025"),
      refineryOutage: est(5, "per year", "unplanned outages"),
      emergencyRelease: est(0.1, "per year", "rare outside crises"),
      gasSwitching: est(0.3, "per year (Dec-Feb only)", "normal gas storage"),
      blackSwan: est(0.25, "per year", "normal-regime base rate of extreme shocks"),
    },
    news: [
      "Brent in the mid-$60s; product cracks near multi-year averages.",
      "Clean tanker rates ordinary; most Red Sea traffic still routes via the Cape as a precaution.",
      "Dangote ramping up: Nigeria exporting more products into Europe.",
    ],
  },
};
