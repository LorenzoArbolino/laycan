/**
 * The market: an exogenous, seeded path that the player cannot move (price-taker).
 *
 * Price architecture (all additive in $/bbl, so P&L attribution is exact):
 *   hub price(h, p) = Brent + crack(p at USGC) + diff(h, p)          (diff(USGC, ·) = 0)
 *   futures(k, T)   = E_t[hub price on the expiry day T]           (see curve.ts)
 *
 * Dynamics (one step per business day):
 *   regime      hidden Markov chain normal / stressed / war
 *   Brent       GARCH(1,1) with Student-t shocks, regime vol multiplier, jumps
 *   cracks      slow + fast + overlay: the slow part reverts over months to the regime's
 *               mean, the fast part (a physical basis) clears within days, and the overlay
 *               is the seasonal pattern, the US stock effect and decaying event shifts;
 *               correlated t shocks; jumps hit the fast part
 *   diffs       band-OU around arbitrage parity: anchor ± θ·freight; extra pull when the arb opens
 *   freight     log-OU time-charter earnings per vessel class, chokepoint-driven shifts, jumps
 *   curves      the model's conditional expectation of future spot (no free lunch);
 *               `structure` is the resulting front spread, a summary for display
 *   chokepoints Markov open / restricted / closed
 */
import { cos, exp, log, sin, sqrt } from "../core/dmath";
import { dayOfYear, isBusinessDay } from "../core/calendar";
import { Rng } from "../core/rng";
import { PRODUCTS, type ProductId } from "../core/units";
import { MODEL, REGIMES, type Regime, type Scenario } from "../params/model";
import { replayRows, type ReplayRow } from "../params/episodes";
import { parseDate } from "../core/calendar";
import {
  CHOKEPOINTS,
  HUBS,
  HUB_REGION,
  PRICE_GRAPH,
  REGIONS,
  type RegionId,
  type ChokeState,
  type ChokepointId,
  type HubId,
  type VesselClass,
} from "../world/world";
import { bestQuote, perBbl, type FreightInputs } from "./freight";
import { brentDrift, brentVariance, buildCurve, frontSpread, type Curve } from "./curve";

export type StructKey = "brent" | ProductId;
export const STRUCT_KEYS: readonly StructKey[] = ["brent", "gasoline", "diesel", "jet"];
const CLASSES: readonly VesselClass[] = ["MR", "LR1", "LR2"];

export type EffectTarget =
  | { kind: "crack"; product: ProductId }
  | { kind: "diff"; hub: HubId; product: ProductId }
  | { kind: "tce"; cls: VesselClass }
  | { kind: "stocks"; product: ProductId; region?: RegionId }
  | { kind: "util"; region: RegionId };

/** A decaying shift to a long-run mean, caused by an event. */
export interface Effect {
  id: string;
  target: EffectTarget;
  amount: number;
  halfLifeDays: number;
  startDay: number;
}

export interface MarketState {
  day: number;
  regime: Regime;
  brent: number;
  brentH: number;
  cracks: Record<ProductId, number>;
  /** crack = crackSlow + crackFast + crackOverlay (season and event shifts) */
  crackSlow: Record<ProductId, number>;
  crackFast: Record<ProductId, number>;
  diffs: Record<HubId, Record<ProductId, number>>;
  tce: Record<VesselClass, number>;
  /** front spread per month implied by the curve, $/bbl (positive = backwardation); derived */
  structure: Record<StructKey, number>;
  /** forward curves: expected spot by days ahead (rebuilt every business day) */
  curve?: Curve;
  /** inventories by region vs 5-year seasonal average, % (positive = surplus) */
  stocks: Record<RegionId, Record<ProductId, number>>;
  /** refinery utilisation by region vs 5-year seasonal average, percentage points */
  util: Record<RegionId, number>;
  choke: Record<ChokepointId, ChokeState>;
  effects: Effect[];
}

export interface MarketConfig {
  scenario: Scenario;
  crackMean: Record<Regime, Record<ProductId, number>>;
  nyhMean: Record<Regime, Record<ProductId, number>>;
  chol: Record<Regime, number[][]>;
  /** for analysis and tests: hold the regime / chokepoints fixed */
  freezeRegime?: boolean;
  freezeChoke?: boolean;
  /** analysis only: skip building forward curves (pure price-path statistics) */
  skipCurve?: boolean;
  /** historical replay: benchmark data by epoch day */
  replay?: Record<number, ReplayRow>;
}

export function cholesky(a: number[][]): number[][] {
  const n = a.length;
  const L = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = a[i]![j]!;
      for (let k = 0; k < j; k++) s -= L[i]![k]! * L[j]![k]!;
      if (i === j) L[i]![i] = sqrt(Math.max(s, 1e-12));
      else L[i]![j] = s / L[j]![j]!;
    }
  }
  return L;
}

export function makeConfig(scenario: Scenario): MarketConfig {
  const crackMean = {} as MarketConfig["crackMean"];
  const nyhMean = {} as MarketConfig["nyhMean"];
  for (const r of REGIMES) {
    crackMean[r] = {} as Record<ProductId, number>;
    nyhMean[r] = {} as Record<ProductId, number>;
    for (const p of PRODUCTS) {
      crackMean[r][p] = scenario.regimeMeans[r]?.[p]?.value ?? MODEL.cracks[p].byRegime[r].mean.value;
      const calNyh = p === "jet" ? MODEL.nyh.diesel.mean.value : MODEL.nyh[p].mean.value;
      nyhMean[r][p] = scenario.nyhMeans[r]?.[p]?.value ?? calNyh;
    }
  }
  const chol = {} as MarketConfig["chol"];
  for (const r of REGIMES) chol[r] = cholesky(MODEL.correlation[r].value);
  const cfg: MarketConfig = { scenario, crackMean, nyhMean, chol };
  if (scenario.replay) {
    cfg.replay = {};
    for (const row of replayRows(scenario.replay)) cfg.replay[parseDate(row.t)] = row;
    cfg.freezeRegime = true;
  }
  return cfg;
}

export function freightInputs(m: MarketState, cfg: MarketConfig): FreightInputs {
  return { tce: m.tce, brent: m.brent, choke: m.choke, routeMult: cfg.scenario.routeMult };
}

function emptyHubTable(): Record<HubId, Record<ProductId, number>> {
  const t = {} as Record<HubId, Record<ProductId, number>>;
  for (const h of HUBS) t[h] = { gasoline: 0, diesel: 0, jet: 0 };
  return t;
}

export function effectShift(m: MarketState, match: (t: EffectTarget) => boolean): number {
  let s = 0;
  for (const e of m.effects) {
    if (!match(e.target)) continue;
    const age = m.day - e.startDay;
    s += e.amount * exp((-age * 0.6931471805599453) / e.halfLifeDays);
  }
  return s;
}

const diffShift = (m: MarketState, hub: HubId, p: ProductId) => effectShift(m, (t) => t.kind === "diff" && t.hub === hub && t.product === p);

/** A hub trades higher when its region's stocks are lower than its supply region's. */
export function stockGapPremium(m: MarketState, hub: HubId, anchor: HubId, p: ProductId): number {
  const a = HUB_REGION[hub];
  const b = HUB_REGION[anchor];
  if (a === b) return 0;
  return -MODEL.fundamentals.diffPerStock.value * (m.stocks[a][p] - m.stocks[b][p]);
}

/** Global inventory signal for a product: regional stocks weighted by size. */
export function globalStock(m: MarketState, p: ProductId): number {
  const w = MODEL.fundamentals.regionWeight.value;
  return REGIONS.reduce((s, r) => s + w[r] * m.stocks[r][p], 0);
}

/** Parity target and arb bound for one hub differential, given the current anchor diff. */
export function parity(m: MarketState, cfg: MarketConfig, hub: HubId, p: ProductId) {
  const a = PRICE_GRAPH.find((x) => x.hub === hub && x.product === p);
  if (!a) return null;
  const anchorDiff = m.diffs[a.anchor][p];
  const sign = a.dir === "import" ? 1 : -1;
  const R = MODEL.regional;
  if (a.route === null) {
    const mean = hub === "NYH" ? cfg.nyhMean[m.regime][p] : 0;
    return { anchor: a, target: anchorDiff + mean + diffShift(m, hub, p) + stockGapPremium(m, hub, a.anchor, p), bound: null as number | null, freight: 0, feasible: true, arbPoint: anchorDiff + mean };
  }
  const q = bestQuote(a.route, freightInputs(m, cfg));
  const F = perBbl(q, p) + R.friction.value;
  const stranded = q.feasible ? 0 : R.strandedPremium.value;
  const target = anchorDiff + sign * (R.theta.value * F + stranded) + diffShift(m, hub, p) + stockGapPremium(m, hub, a.anchor, p);
  const bound = q.feasible ? anchorDiff + sign * F : null;
  // arbPoint: pure freight parity, without stock or event premia (drives trade flows)
  return { anchor: a, target, bound, freight: F, feasible: q.feasible, arbPoint: anchorDiff + sign * R.theta.value * F };
}

export function initMarket(scenario: Scenario, cfg: MarketConfig, startDay: number): MarketState {
  const b = MODEL.brent;
  const m: MarketState = {
    day: startDay,
    regime: scenario.regime,
    brent: scenario.brent.value,
    brentH: b.omega.value / (1 - b.alpha.value - b.beta.value),
    cracks: { gasoline: scenario.cracks.gasoline.value, diesel: scenario.cracks.diesel.value, jet: scenario.cracks.jet.value },
    crackSlow: { gasoline: 0, diesel: 0, jet: 0 },
    crackFast: { gasoline: 0, diesel: 0, jet: 0 },
    diffs: emptyHubTable(),
    tce: { MR: scenario.freight.MR.value, LR1: scenario.freight.LR1.value, LR2: scenario.freight.LR2.value },
    structure: { brent: 0, gasoline: 0, diesel: 0, jet: 0 },
    stocks: Object.fromEntries(
      REGIONS.map((r) => [
        r,
        r === "US"
          ? { gasoline: scenario.stocks.gasoline.value, diesel: scenario.stocks.diesel.value, jet: scenario.stocks.jet.value }
          : { gasoline: scenario.regionStocks?.[r]?.gasoline?.value ?? 0, diesel: scenario.regionStocks?.[r]?.diesel?.value ?? 0, jet: scenario.regionStocks?.[r]?.jet?.value ?? 0 },
      ]),
    ) as MarketState["stocks"],
    util: { US: 0, EU: 0, WAF: 0, ME: 0, ASIA: 0 },
    choke: { ...scenario.choke },
    effects: [],
  };
  for (const p of PRODUCTS) m.diffs.NYH[p] = scenario.nyhUsgc[p].value;
  for (const a of PRICE_GRAPH) {
    if (a.hub === "NYH") continue;
    const par = parity(m, cfg, a.hub, a.product);
    if (par) m.diffs[a.hub][a.product] = par.target;
  }
  for (const [h, row] of Object.entries(scenario.diffOverrides ?? {})) {
    for (const [p, v] of Object.entries(row ?? {})) if (v) m.diffs[h as HubId][p as ProductId] = v.value;
  }
  for (const p of PRODUCTS) m.crackSlow[p] = m.cracks[p] - crackOverlay(m, p, m.day);
  refreshCurve(m, cfg);
  return m;
}

/** Rebuild the forward curves from the current state (after any change to it). */
export function refreshCurve(m: MarketState, cfg: MarketConfig): void {
  m.curve = buildCurve(m, cfg, { crackTarget, season, parity });
  for (const k of STRUCT_KEYS) m.structure[k] = frontSpread(m.curve, k);
}

export function cloneMarket(m: MarketState): MarketState {
  return structuredClone(m);
}

export function hubPrice(m: MarketState, hub: HubId, p: ProductId): number {
  return m.brent + m.cracks[p] + m.diffs[hub][p];
}

/** Mean the slow part of a crack reverts to: the regime level. */
export function crackTarget(cfg: MarketConfig, r: Regime, p: ProductId): number {
  return cfg.crackMean[r][p];
}

/**
 * Part of a crack set by observable state on a day: the seasonal pattern, the US stock effect
 * (calibrated as a same-week relation) and decaying event shifts.
 */
export function crackOverlay(m: MarketState, p: ProductId, day: number, stockUS = m.stocks.US[p]): number {
  let s = season(p, day) + MODEL.fundamentals.crackPerStock[p].value * stockUS;
  for (const e of m.effects) {
    if (e.target.kind !== "crack" || e.target.product !== p) continue;
    const age = day - e.startDay;
    if (age >= 0) s += e.amount * exp((-age * 0.6931471805599453) / e.halfLifeDays);
  }
  return s;
}

const SEASON_CACHE: Record<string, number[]> = {};

/** Seasonal crack pattern (2-harmonic Fourier in day of year), cached by day of year. */
export function season(p: ProductId, day: number): number {
  const doy = dayOfYear(day);
  let tab = SEASON_CACHE[p];
  if (!tab) {
    tab = [];
    const c = MODEL.cracks[p].season.value;
    for (let d = 0; d <= 366; d++) {
      let s = 0;
      for (let j = 0; j < c.length / 2; j++) {
        const w = (2 * Math.PI * (j + 1) * d) / 365.25;
        s += (c[2 * j] ?? 0) * cos(w) + (c[2 * j + 1] ?? 0) * sin(w);
      }
      tab.push(s);
    }
    SEASON_CACHE[p] = tab;
  }
  return tab[doy]!;
}

export interface MarketStepNews {
  kind: "regime" | "choke";
  text: string;
  from: string;
  to: string;
  chokepoint?: ChokepointId;
}

/**
 * Advance the market by one calendar day. Prices move on business days only.
 * Mutates `m` in place; returns state-change notices (regime, chokepoints).
 */
export function stepMarket(m: MarketState, cfg: MarketConfig, rng: Rng): MarketStepNews[] {
  m.day += 1;
  const news: MarketStepNews[] = [];
  m.effects = m.effects.filter((e) => m.day - e.startDay < e.halfLifeDays * 8);
  if (!isBusinessDay(m.day)) return news;

  // Regime
  const T = MODEL.regimeTransition.value;
  const ri = REGIMES.indexOf(m.regime);
  const u = rng.uniform();
  let acc = 0;
  const trow = T[ri]!;
  let next = m.regime;
  for (let j = 0; j < trow.length; j++) {
    acc += trow[j]!;
    if (u < acc) {
      next = REGIMES[j]!;
      break;
    }
  }
  if (cfg.freezeRegime) next = m.regime;
  if (next !== m.regime) {
    news.push({ kind: "regime", text: `Market regime shifts from ${m.regime} to ${next}.`, from: m.regime, to: next });
    m.regime = next;
  }

  // Chokepoints
  for (const c of CHOKEPOINTS) {
    const table = cfg.scenario.chokeTransitionByRegime?.[m.regime] ?? cfg.scenario.chokeTransition;
    const tr = cfg.freezeChoke ? {} : (table[c].value[m.choke[c]] ?? {});
    const v = rng.uniform();
    let a = 0;
    for (const [to, p] of Object.entries(tr)) {
      a += p;
      if (v < a) {
        news.push({ kind: "choke", chokepoint: c, from: m.choke[c], to, text: "" });
        m.choke[c] = to as ChokeState;
        break;
      }
    }
  }

  const r = m.regime;
  // Correlated multivariate-t shocks: [brent, gasoline, diesel, jet]
  const W = rng.studentScale(MODEL.brent.nu.value);
  const sw = sqrt(W);
  const e = [rng.normal(), rng.normal(), rng.normal(), rng.normal()];
  const L = cfg.chol[r];
  const z = L.map((row) => row.reduce((s, l, k) => s + l * (e[k] ?? 0), 0));

  // Brent
  const B = MODEL.brent;
  const vm = B.volMult[r].value;
  const diffusive = sqrt(m.brentH) * sw * (z[0] ?? 0);
  let ret = vm * diffusive;
  // The GARCH-t was fitted on normal-regime returns that already contain the large moves, so
  // stochastic jumps are added only in stressed/war regimes (avoids double-counting tails).
  // Normal-regime shocks come from the events engine.
  if (r !== "normal" && rng.bernoulli(B.jumpRate.value / 252)) ret += rng.laplace(B.jumpScale.value);
  // Mean reversion of log price towards the regime level. With log reversion speed κ and daily
  // log variance σ², the stationary log price has mean log L + c/κ and variance ≈ σ²/(2κ), so
  // E[price] = L·exp((c + σ²/4)/κ): a drift c = −σ²/4 makes the regime level the average price
  // (c = 0 would make it the median; jumps count towards σ²).
  ret += B.levelKappa.value * (log(B.level[r].value) - log(m.brent)) + brentDrift(brentVariance(r, m.brentH));
  const row = cfg.replay?.[m.day];
  if (cfg.replay) {
    // Replay: Brent follows the data; the variance filter still updates (for risk metrics)
    if (row) {
      const realised = log(row.b / m.brent) / vm;
      m.brentH = B.omega.value + B.alpha.value * realised * realised + B.beta.value * m.brentH;
      m.brent = row.b;
    }
  } else {
    m.brentH = B.omega.value + B.alpha.value * diffusive * diffusive + B.beta.value * m.brentH;
    m.brent = Math.max(5, m.brent * exp(ret));
  }

  // Cracks: slow + fast parts with correlated shocks (a second draw for the fast part).
  // Historical crack jumps (hurricanes, outages) hit products together and fade quickly, so
  // jumps are a common shock to the fast part with a smaller idiosyncratic piece.
  const e2 = [rng.normal(), rng.normal(), rng.normal(), rng.normal()];
  const z2 = L.map((row) => row.reduce((s, l, k) => s + l * (e2[k] ?? 0), 0));
  const jumpRate = PRODUCTS.reduce((s, p) => s + MODEL.cracks[p].byRegime[r].jumpRate.value, 0) / PRODUCTS.length;
  const jumpDay = rng.bernoulli(jumpRate / 252);
  const common = jumpDay ? rng.laplace(1) : 0;
  PRODUCTS.forEach((p, i) => {
    const cp = MODEL.cracks[p].byRegime[r];
    const mu = crackTarget(cfg, r, p);
    const overlay = crackOverlay(m, p, m.day);
    let fast = m.crackFast[p];
    let slow = m.crackSlow[p];
    slow += cp.slowKappa.value * (mu - slow);
    fast -= cp.fastKappa.value * fast;
    if (row) {
      // Replay: the data give the total; split the surprise by the two parts' shock variances
      const obs = row[p === "gasoline" ? "g" : p === "diesel" ? "d" : "j"];
      const vf = cp.fastSigma.value * cp.fastSigma.value;
      fast += ((obs - slow - fast - overlay) * vf) / (vf + cp.slowSigma.value * cp.slowSigma.value);
      slow = obs - fast - overlay;
      m.cracks[p] = obs;
    } else {
      slow += cp.slowSigma.value * sw * (z[i + 1] ?? 0);
      fast += cp.fastSigma.value * sw * (z2[i + 1] ?? 0);
      if (jumpDay) fast += 0.8 * common * cp.jumpScale.value + rng.laplace(0.2 * cp.jumpScale.value);
      m.cracks[p] = slow + fast + overlay;
    }
    m.crackFast[p] = fast;
    m.crackSlow[p] = slow;
  });


  // Freight (log TCE per class)
  const F = MODEL.freight;
  for (const c of CLASSES) {
    let shift = 0;
    for (const k of CHOKEPOINTS) {
      const st = m.choke[k];
      if (st !== "open") shift += F.chokeShift[k][st][c];
    }
    shift += effectShift(m, (t) => t.kind === "tce" && t.cls === c);
    const target = log(F.mean[r][c].value) + shift;
    let lx = log(m.tce[c]);
    lx += F.kappa.value * (target - lx) + F.sigma.value * rng.normal();
    if (rng.bernoulli(F.jumpRate.value / 252)) lx += rng.laplace(F.jumpScale.value);
    m.tce[c] = exp(lx);
  }

  // Regional differentials, in topological order of the price graph
  const R = MODEL.regional;
  const flows: { into: RegionId; from: RegionId; product: ProductId; excess: number }[] = [];
  for (const a of PRICE_GRAPH) {
    const par = parity(m, cfg, a.hub, a.product);
    if (!par) continue;
    let d = m.diffs[a.hub][a.product];
    let kappa = R.kappaIn.value;
    let sigma = R.sigma.value;
    if (a.hub === "NYH") {
      const cal = a.product === "jet" ? MODEL.nyh.diesel : MODEL.nyh[a.product];
      kappa = cal.kappa.value;
      sigma = cal.sigma.value * (r === "normal" ? 1 : 2);
    }
    d += kappa * (par.target - d) + sigma * rng.normal();
    if (rng.bernoulli(R.jumpRate.value / 252)) d += rng.laplace(R.jumpScale.value);
    if (par.bound !== null) {
      // An open arb pulls the price back (cargoes arrive) and moves barrels between regions
      if (a.dir === "import" && d > par.bound) d += R.kappaOut.value * (par.bound - d);
      if (a.dir === "export" && d < par.bound) d += R.kappaOut.value * (par.bound - d);
    }
    if (a.hub === "NYH" && r === "normal") {
      const cal = a.product === "jet" ? MODEL.nyh.diesel : MODEL.nyh[a.product];
      if (d > cal.band_hi.value + 1) d += R.kappaOut.value * (cal.band_hi.value - d);
      if (d < cal.band_lo.value - 1) d += R.kappaOut.value * (cal.band_lo.value - d);
    }
    m.diffs[a.hub][a.product] = d;
    // Trade flows respond to price vs parity, symmetrically (zero on average): a hub above its
    // parity point draws extra imports (or exports less); below parity, the reverse.
    if (par.feasible && a.route !== null) {
      const gap = a.dir === "import" ? d - par.arbPoint : par.arbPoint - d;
      const [into, from] = a.dir === "import" ? [HUB_REGION[a.hub], HUB_REGION[a.anchor]] : [HUB_REGION[a.anchor], HUB_REGION[a.hub]];
      flows.push({ into, from, product: a.product, excess: gap });
    }
  }
  if (row) {
    m.diffs.NYH.gasoline = row.ng;
    m.diffs.NYH.diesel = row.nd;
  }

  // Fundamentals: refinery utilisation and regional stocks (vs 5-year normals).
  //   util: OU around event-driven targets; stocks: refinery output (via utilisation) +
  //   arbitrage flows + event shifts, mean-reverting; US data in replays
  const FD = MODEL.fundamentals;
  for (const reg of REGIONS) {
    const target = effectShift(m, (t) => t.kind === "util" && t.region === reg);
    m.util[reg] += FD.utilKappa.value * (target - m.util[reg]) + FD.utilSigma.value * rng.normal();
  }
  if (row && row.ud !== null && row.ud !== undefined) m.util.US = row.ud;
  for (const reg of REGIONS) {
    for (const p of PRODUCTS) {
      // stock effects are decaying flows (% of stocks per business day): bans, outages, demand shocks
      const flow = effectShift(m, (t) => t.kind === "stocks" && t.product === p && (t.region ?? "US") === reg);
      m.stocks[reg][p] += FD.utilToStock[p].value * m.util[reg] + flow - FD.stockKappa[p].value * m.stocks[reg][p] + FD.stockSigma[p].value * rng.normal() * (reg === "US" ? 1 : 0.8);
    }
  }
  // Arb flows move barrels: stocks are % of each region's normal inventory, so the same
  // barrels are a larger share of a smaller region's stocks (weights = relative sizes).
  const w = FD.regionWeight.value;
  for (const f of flows) {
    if (f.into === f.from) continue;
    const q = FD.arbFlow.value * Math.max(-10, Math.min(f.excess, 10));
    m.stocks[f.into][f.product] += q;
    m.stocks[f.from][f.product] -= (q * w[f.into]) / w[f.from];
  }
  if (row) {
    if (row.sg !== null) m.stocks.US.gasoline = row.sg;
    if (row.sd !== null) m.stocks.US.diesel = row.sd;
    if (row.sj !== null) m.stocks.US.jet = row.sj;
  }
  if (!cfg.skipCurve) refreshCurve(m, cfg);
  return news;
}

/** Snapshot of all hub prices for history and pricing windows. */
export interface PriceRow {
  day: number;
  brent: number;
  cracks: Record<ProductId, number>;
  diffs: Record<HubId, Record<ProductId, number>>;
  structure: Record<StructKey, number>;
  stocks: Record<RegionId, Record<ProductId, number>>;
  util: Record<RegionId, number>;
  tce: Record<VesselClass, number>;
  regime: Regime;
  choke: Record<ChokepointId, ChokeState>;
}

export function priceRow(m: MarketState): PriceRow {
  return structuredClone({ day: m.day, brent: m.brent, cracks: m.cracks, diffs: m.diffs, structure: m.structure, stocks: m.stocks, util: m.util, tce: m.tce, regime: m.regime, choke: m.choke });
}

export function rowPrice(row: PriceRow, hub: HubId, p: ProductId): number {
  return row.brent + row.cracks[p] + row.diffs[hub][p];
}
