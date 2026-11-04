/**
 * Generated markets: a realistic world with no real date or prices. The starting state is
 * drawn from the calibrated model (regime, Brent, cracks, freight, stocks, chokepoints) and
 * then run forward for a burn-in period, so the opening market is internally consistent
 * and the charts already have history. Same seed, same world.
 */
import { addMonths, fromYmd, isoDate, weekday } from "../core/calendar";
import { exp } from "../core/dmath";
import { Rng } from "../core/rng";
import { PRODUCTS, type ProductId } from "../core/units";
import { MODEL, ROUTE_MULT_NORMAL, SCENARIOS, calibration, type Regime, type Scenario } from "./model";
import type { Param } from "./param";

const GEN_YEAR = 2031;

const gen = (value: number, unit: string, what: string): Param => ({
  value,
  unit,
  label: "derived",
  source: "generated from the calibrated model (seeded)",
  method: what,
  date: "2026-11-01",
});

export function makeGeneratedScenario(seed: string): Scenario {
  const r = Rng.stream(seed, "setup");
  const u = r.uniform();
  const regime: Regime = u < 0.78 ? "normal" : u < 0.86 ? "stressed" : "war";
  const normal = SCENARIOS.normal_2025!;
  const now = SCENARIOS.now_2026_11!;
  // Start on a Monday in a random month of a fictional year
  const m0 = 1 + r.int(12);
  const s = addMonths(GEN_YEAR, m0, 0);
  let start = fromYmd(s.y, s.m, 1);
  while (weekday(start) !== 1) start++;
  const burnInDays = 91;

  const w23 = calibration.window_means.normal_2023_2025.value;
  const crackMean = (p: ProductId) => (regime === "normal" ? (w23[p] ?? MODEL.cracks[p].byRegime.normal.mean.value) : MODEL.cracks[p].byRegime[regime].mean.value);
  const crackSd = (p: ProductId) => {
    const c = MODEL.cracks[p].byRegime[regime];
    return Math.min(12, c.sigma.value / Math.sqrt(2 * c.kappa.value));
  };
  const cracks = {} as Record<ProductId, Param>;
  for (const p of PRODUCTS) cracks[p] = gen(Math.max(-5, crackMean(p) + crackSd(p) * r.normal()), "$/bbl", `regime mean + stationary noise (${regime})`);
  const stocks = {} as Record<ProductId, Param>;
  for (const p of PRODUCTS) stocks[p] = gen(5 * r.normal() + (regime === "war" ? -5 : regime === "stressed" ? 5 : 0), "%", "drawn around the regime's typical inventory position");

  const regionStocks: Scenario["regionStocks"] = {};
  for (const reg of ["EU", "WAF", "ME", "ASIA"] as const) {
    regionStocks[reg] = {};
    for (const p of PRODUCTS) regionStocks[reg]![p] = gen(4 * r.normal(), "%", "drawn around normal inventories");
  }
  const choke: Scenario["choke"] = { hormuz: "open", babelmandeb: "open", suez: "open" };
  if (regime === "war") {
    if (r.bernoulli(0.6)) choke.hormuz = "restricted";
    if (r.bernoulli(0.6)) choke.babelmandeb = "restricted";
  } else if (r.bernoulli(0.25)) choke.babelmandeb = "restricted";

  const fr = MODEL.freight.mean[regime];
  const freight = {
    MR: gen(fr.MR.value * exp(0.25 * r.normal()), "$/day", "regime mean × lognormal"),
    LR1: gen(fr.LR1.value * exp(0.25 * r.normal()), "$/day", "regime mean × lognormal"),
    LR2: gen(fr.LR2.value * exp(0.25 * r.normal()), "$/day", "regime mean × lognormal"),
  };
  return {
    id: "generated",
    kind: "generated",
    name: "Generated market",
    description: "A realistic world drawn from the calibrated model: no real date, no real prices. Every seed is a different market; share a seed to play the same one.",
    startDate: isoDate(start),
    weeks: 12,
    regime,
    stocks,
    regionStocks,
    burnInDays,
    displayYearBase: GEN_YEAR,
    randomEvents: true,
    brent: gen(MODEL.brent.level[regime].value * exp(0.22 * r.normal()), "$/bbl", "regime level × lognormal"),
    cracks,
    regimeMeans: { normal: { gasoline: gen(w23.gasoline ?? 17, "$/bbl", "2023-2025 mean"), diesel: gen(w23.diesel ?? 25, "$/bbl", "2023-2025 mean"), jet: gen(w23.jet ?? 23, "$/bbl", "2023-2025 mean") } },
    nyhUsgc: { gasoline: MODEL.nyh.gasoline.mean, diesel: MODEL.nyh.diesel.mean, jet: MODEL.nyh.diesel.mean },
    nyhMeans: {},
    freight,
    routeMult: ROUTE_MULT_NORMAL,
    choke,
    chokeTransition: normal.chokeTransition,
    chokeTransitionByRegime: { normal: normal.chokeTransition, stressed: normal.chokeTransition, war: now.chokeTransition },
    finance: normal.finance,
    eventRates: normal.eventRates,
    eventRatesByRegime: { normal: normal.eventRates, stressed: normal.eventRates, war: now.eventRates },
    news: [],
  };
}
