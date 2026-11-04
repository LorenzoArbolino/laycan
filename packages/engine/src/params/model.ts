/**
 * Model parameters: fitted values from params/calibration.json (public EIA data) plus
 * labelled estimates for what public data cannot pin down. Scenario files override some
 * of these (levels, regime means) but never remove provenance.
 */
import calibration from "../../../../params/calibration.json" with { type: "json" };
import type { ProductId } from "../core/units";
import type { HubId, RegionId, VesselClass } from "../world/world";
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
  fundamentals: Record<"util_kappa" | "util_sigma" | "util_sd" | "util_min", CalParam<number>> & Record<ProductId, Record<"stock_kappa" | "stock_sigma" | "util_to_stock_ols" | "crack_per_stock" | "ex_stock_kappa" | "ex_stock_sigma" | "fast_share" | "fast_kappa" | "slow_kappa" | "deviation_var", CalParam<number>>>;
  snapshot_now: Record<string, CalParam<number | string>>;
  snapshot_normal_2025: Record<string, CalParam<number | string>>;
};
export { cal as calibration };

export interface CrackParams {
  season: Param<number[]>;
  byRegime: Record<Regime, CrackRegime>;
}

/**
 * crack = slow + fast. The slow part reverts to the regime's seasonal, stock-dependent mean
 * over months; the fast part (a physical basis) reverts to zero within days. kappa/sigma are
 * the single-AR(1) equivalents, kept for reporting and the generator's starting spread.
 */
export interface CrackRegime {
  kappa: Param;
  sigma: Param;
  jumpRate: Param;
  jumpScale: Param;
  mean: Param;
  fastKappa: Param;
  fastSigma: Param;
  slowKappa: Param;
  slowSigma: Param;
}

const jumpCap = (p: CalParam<number>, cap: number): Param => ({
  ...p,
  value: Math.min(p.value, cap),
  method: `${p.method}; capped at ${cap} to remove data-error spikes`,
});

/** Diffusive shock size of the fast part: its variance budget minus what the jumps already supply. */
function fastSigma(budget: number, c: { jump_rate: CalParam<number>; jump_scale: CalParam<number> }): number {
  // jumps = 0.8 × common Laplace(1) × scale + Laplace(0.2 × scale): variance 1.36 × scale²
  const js = c.jump_scale.value;
  const jumpVar = (c.jump_rate.value / 252) * 1.36 * js * js;
  return Math.sqrt(Math.max(0.15 * budget, budget - jumpVar));
}

function crackParams(p: ProductId): CrackParams {
  const c = cal.cracks[p];
  const by = {} as CrackParams["byRegime"];
  // Normal regime: the crack process net of the stock channel (the engine adds slope × stocks)
  const fx = cal.fundamentals[p];
  const w = fx.fast_share!.value;
  const kf = fx.fast_kappa!.value;
  const stationary = (k: number, s: number) => (s * s) / (1 - (1 - k) * (1 - k));
  const vNormal = fx.deviation_var!.value;
  for (const r of REGIMES) {
    const kappa = r === "normal" ? fx.ex_stock_kappa! : c[r].kappa;
    const sigma = r === "normal" ? fx.ex_stock_sigma! : c[r].sigma;
    // Stressed and war windows are too short for a two-speed fit: their variance scales with
    // the single-AR(1) fit, the split is the normal one, and the slow part reprices within
    // ~2 months (2022: diesel cracks tripled in about six weeks).
    const V = r === "normal" ? vNormal : (vNormal * stationary(c[r].kappa.value, c[r].sigma.value)) / stationary(fx.ex_stock_kappa!.value, fx.ex_stock_sigma!.value);
    const ks = r === "normal" ? fx.slow_kappa!.value : Math.max(fx.slow_kappa!.value, 0.6931471805599453 / 40);
    const how = r === "normal" ? "from the two-speed ACF fit and the variance of the deseasonalised crack" : "normal-regime split and half-lives; variance scaled by the regime's AR(1) fit; slow half-life capped at 40 business days";
    by[r] = {
      kappa,
      sigma,
      jumpRate: c[r].jump_rate,
      jumpScale: jumpCap(c[r].jump_scale, r === "war" ? 20 : 12),
      mean: c[r].mean,
      fastKappa: derived(kf, "1/business day", fx.fast_kappa!.source, "two-speed ACF fit (normal regime)"),
      fastSigma: derived(fastSigma(w * V * (1 - (1 - kf) * (1 - kf)), c[r]), "$/bbl/day", fx.fast_share!.source, `${how}; net of the jump variance, which also lands on the fast part`),
      slowKappa: r === "normal" ? derived(ks, "1/business day", fx.slow_kappa!.source, "two-speed ACF fit") : est(ks, "1/business day", "model design", how),
      slowSigma: derived(Math.sqrt((1 - w) * V * (1 - (1 - ks) * (1 - ks))), "$/bbl/day", fx.fast_share!.source, how),
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
    levelKappa: est(0.006, "1/business day", "model design; 2010-2025 Brent stayed mostly within $50-115 outside crises", "mean reversion of log Brent to the regime level; half-life ~5 months, so 52-week games stay plausible"),
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
    slopeSigma: est(0.15, "$/bbl/month per day", "model design", "day-to-day noise in the front spread, for VaR on curve exposure"),
    // Observed front spreads, used only to validate the curves the model implies (curve.ts):
    // the curve is the model's own expectation of future spot, not an input.
    observed: {
      normal: { brent: est(0.4, "$/bbl/month", "Brent backwardation 2023-2025, typical") },
      stressed: { brent: est(-2, "$/bbl/month", "Brent contango Apr-May 2020 (spot ~$20-30 vs Dec-20 ~$35-40); 2008-09 similar") },
      war: {
        brent: est(3.0, "$/bbl/month", "spot Brent $123 vs Jan futures ~$113 (late Oct 2026)"),
        diesel: derived(6.5, "$/bbl/month", "ICE Gasoil futures curve observations, late Oct 2026 (used for calibration only; exchange data not redistributed)", "front-month spreads ~$48-53/t ≈ $6.5-7/bbl"),
      },
    } as Record<Regime, Partial<Record<"brent" | ProductId, Param>>>,
  },
  hurricane: cal.hurricane.gulf_hurricanes_per_year_by_month as Param<number[]>,
  fundamentals: {
    utilKappa: cal.fundamentals.util_kappa!,
    utilSigma: cal.fundamentals.util_sigma!,
    stockKappa: { gasoline: cal.fundamentals.gasoline.stock_kappa, diesel: cal.fundamentals.diesel.stock_kappa, jet: cal.fundamentals.jet.stock_kappa } as Record<ProductId, Param>,
    stockSigma: { gasoline: cal.fundamentals.gasoline.stock_sigma, diesel: cal.fundamentals.diesel.stock_sigma, jet: cal.fundamentals.jet.stock_sigma } as Record<ProductId, Param>,
    crackPerStock: { gasoline: cal.fundamentals.gasoline.crack_per_stock, diesel: cal.fundamentals.diesel.crack_per_stock, jet: cal.fundamentals.jet.crack_per_stock } as Record<ProductId, Param>,
    /** stock change per business day for one percentage point of utilisation (physics, not the attenuated OLS) */
    utilToStock: {
      gasoline: est(0.012, "%/business day per pp", "net pass-through: about a quarter of the US mass balance (1 pp of 17.5 mb/d at ~45% gasoline yield vs ~230 mb stocks)", "between the attenuated weekly OLS (~0.003) and the gross mass balance (~0.05); trade and demand offset the rest"),
      diesel: est(0.015, "%/business day per pp", "net pass-through: about a quarter of the US mass balance (1 pp of 17.5 mb/d at ~30% distillate yield vs ~120 mb stocks)", "between the attenuated weekly OLS (~0.003) and the gross mass balance (~0.06)"),
      jet: est(0.01, "%/business day per pp", "net pass-through: about a quarter of the US mass balance (1 pp of 17.5 mb/d at ~10% jet yield vs ~42 mb stocks)", "between the attenuated weekly OLS (~0.004) and the gross mass balance (~0.04)"),
    } as Record<ProductId, Param>,
    arbFlow: est(0.04, "%/business day per $/bbl", "model design", "trade flows respond to a hub's price relative to its parity point: above parity, imports accelerate and the importing region's stocks rise (the exporter's fall); below parity they slow"),
    diffPerStock: est(0.25, "$/bbl per % stock gap", "model design; scaled to the calibrated US crack-stock slopes", "a hub's differential rises when its region is shorter than its supply region"),
    regionWeight: est({ US: 0.4, EU: 0.3, ASIA: 0.2, ME: 0.05, WAF: 0.05 }, "weight", "rough shares of traded product inventories", "regional stocks combine into a global signal; also converts arb flows between regions, since the same barrels are a larger share of a smaller region's stocks") as Param<Record<RegionId, number>>,
  },
  storage: {
    baseFee: {
      USGC: est(0.4, "$/bbl/month", "independent terminal tariffs, order of magnitude"),
      NYH: est(0.55, "$/bbl/month", "independent terminal tariffs, order of magnitude"),
      ARA: est(0.45, "$/bbl/month", "ARA independent storage, order of magnitude"),
      WAF: est(0.8, "$/bbl/month", "limited independent tankage"),
      MEG: est(0.7, "$/bbl/month", "limited independent tankage"),
      FUJ: est(0.6, "$/bbl/month", "Fujairah storage, order of magnitude"),
      SIN: est(0.5, "$/bbl/month", "Singapore storage, order of magnitude"),
      JPN: est(0.6, "$/bbl/month", "Japanese terminal storage, order of magnitude"),
    } as Record<HubId, Param>,
    contangoPremium: est(0.25, "share of contango", "storage rents rise when contango makes storage valuable", "lease fee × (1 + 0.25 × contango in $/bbl/month)"),
    spotMultiplier: est(1.6, "x", "short-term spot tankage costs more than a term lease"),
    spotSaleHaircut: est(0.6, "$/bbl", "discount a merchant asks to take a prompt parcel off your hands"),
  },
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
  TC1: est(1.0, "x", "definition (the LR2 index is TC1-type)"),
  "JPN-SIN": est(0.9, "x", "model design: intra-Asia MR trade"),
  "SIN-JPN": est(0.9, "x", "model design: intra-Asia MR trade"),
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
  TC1: { value: 1.0, unit: "x", label: "data", source: "Optima Shipbroking, TC1 TCE ~$282k/day, 19 Oct 2026, which sets the LR2 index", method: "definition", date: "2026-10-20" },
  "JPN-SIN": est(0.5, "x", "assumed: intra-Asia MR rates well below the war-inflated East-of-Suez LR market"),
  "SIN-JPN": est(0.5, "x", "assumed: intra-Asia MR rates well below the war-inflated East-of-Suez LR market"),
};

export type ScenarioKind = "generated" | "historical" | "snapshot";

/** A dated, scripted event for historical replays (or scripted scenarios). */
export interface ScriptedEvent {
  date: string;
  title: string;
  body?: string;
  severity?: "info" | "warn" | "critical";
  regime?: Regime;
  choke?: ["hormuz" | "babelmandeb" | "suez", "open" | "restricted" | "closed"];
  finance?: { lcFeeMult: number; overdraftMult: number; days: number };
  port?: [HubId, number];
  /** decaying shifts: [target, amount, half-life days] */
  tce?: [VesselClass, number, number][];
  diff?: [HubId, ProductId, number, number][];
  stocks?: [ProductId, number, number][];
  /** regional stock flows: [region, product, total % over the episode, half-life days] (amount is converted to a decaying daily flow) */
  regionStocks?: [RegionId, ProductId, number, number][];
  util?: [RegionId, number, number][];
}

export interface Scenario {
  id: string;
  kind: ScenarioKind;
  name: string;
  description: string;
  startDate: string;
  weeks: number;
  regime: Regime;
  /** US stocks vs 5-year seasonal average, % */
  stocks: Record<ProductId, Param>;
  /** other regions' starting stocks, % (default 0) */
  regionStocks?: Partial<Record<RegionId, Partial<Record<ProductId, Param>>>>;
  /** days simulated before the start, so charts have history and the state is consistent */
  burnInDays: number;
  /** generated worlds show years as "Year 1, 2…" relative to this calendar year */
  displayYearBase?: number;
  /** stochastic macro events on/off (historical replays use only the scripted ones) */
  randomEvents: boolean;
  chokeTransitionByRegime?: Partial<Record<Regime, Scenario["chokeTransition"]>>;
  eventRatesByRegime?: Partial<Record<Regime, Record<string, Param>>>;
  replay?: string;
  script?: ScriptedEvent[];
  /** provenance for the scripted events of a replay */
  scriptSource?: Param<string>;
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
    kind: "snapshot",
    burnInDays: 0,
    randomEvents: true,
    stocks: {
      gasoline: snapN.us_gasoline_stocks_vs_5y_pct!,
      diesel: snapN.us_distillate_stocks_vs_5y_pct!,
      jet: est(4.7, "%", "EIA WPSR WKJSTUS1, week to 23 Oct 2026 (computed in calibration)"),
    },
    regionStocks: {
      EU: { diesel: est(-8, "%", "European diesel described as structurally short in Oct 2026 reporting; magnitude assumed"), jet: est(-4, "%", "assumed") },
      ME: { diesel: est(6, "%", "Gulf barrels backed up behind Hormuz; magnitude assumed"), jet: est(6, "%", "assumed") },
    },
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
    kind: "snapshot",
    burnInDays: 0,
    randomEvents: true,
    stocks: { gasoline: est(0, "%", "assumed near average"), diesel: est(0, "%", "assumed near average"), jet: est(0, "%", "assumed near average") },
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
