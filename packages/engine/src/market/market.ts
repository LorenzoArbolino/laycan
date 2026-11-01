/**
 * The market: an exogenous, seeded path that the player cannot move (price-taker).
 *
 * Price architecture (all additive in $/bbl, so P&L attribution is exact):
 *   hub price(h, p) = Brent + crack(p at USGC) + diff(h, p)          (diff(USGC, ·) = 0)
 *   futures(k)      = hub price − structure(p) · g(months to expiry)
 *
 * Dynamics (one step per business day):
 *   regime      hidden Markov chain normal / stressed / war
 *   Brent       GARCH(1,1) with Student-t shocks, regime vol multiplier, jumps
 *   cracks      seasonal Ornstein–Uhlenbeck with regime means, correlated t shocks, jumps
 *   diffs       band-OU around arbitrage parity: anchor ± θ·freight; extra pull when the arb opens
 *   freight     log-OU time-charter earnings per vessel class, chokepoint-driven shifts, jumps
 *   structure   OU front-month spread (backwardation > 0)
 *   chokepoints Markov open / restricted / closed
 */
import { cos, exp, log, sin, sqrt } from "../core/dmath";
import { dayOfYear, isBusinessDay } from "../core/calendar";
import { Rng } from "../core/rng";
import { PRODUCTS, type ProductId } from "../core/units";
import { MODEL, REGIMES, type Regime, type Scenario } from "../params/model";
import {
  CHOKEPOINTS,
  HUBS,
  PRICE_GRAPH,
  type ChokeState,
  type ChokepointId,
  type HubId,
  type VesselClass,
} from "../world/world";
import { bestQuote, perBbl, type FreightInputs } from "./freight";

export type StructKey = "brent" | ProductId;
export const STRUCT_KEYS: readonly StructKey[] = ["brent", "gasoline", "diesel", "jet"];
const CLASSES: readonly VesselClass[] = ["MR", "LR1", "LR2"];

export type EffectTarget =
  | { kind: "crack"; product: ProductId }
  | { kind: "diff"; hub: HubId; product: ProductId }
  | { kind: "tce"; cls: VesselClass }
  | { kind: "structure"; key: StructKey };

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
  diffs: Record<HubId, Record<ProductId, number>>;
  tce: Record<VesselClass, number>;
  structure: Record<StructKey, number>;
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
  return { scenario, crackMean, nyhMean, chol };
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

/** Parity target and arb bound for one hub differential, given the current anchor diff. */
export function parity(m: MarketState, cfg: MarketConfig, hub: HubId, p: ProductId) {
  const a = PRICE_GRAPH.find((x) => x.hub === hub && x.product === p);
  if (!a) return null;
  const anchorDiff = m.diffs[a.anchor][p];
  const sign = a.dir === "import" ? 1 : -1;
  const R = MODEL.regional;
  if (a.route === null) {
    const mean = hub === "NYH" ? cfg.nyhMean[m.regime][p] : 0;
    return { anchor: a, target: anchorDiff + mean + diffShift(m, hub, p), bound: null as number | null, freight: 0, feasible: true };
  }
  const q = bestQuote(a.route, freightInputs(m, cfg));
  const F = perBbl(q, p) + R.friction.value;
  const stranded = q.feasible ? 0 : R.strandedPremium.value;
  const target = anchorDiff + sign * (R.theta.value * F + stranded) + diffShift(m, hub, p);
  const bound = q.feasible ? anchorDiff + sign * F : null;
  return { anchor: a, target, bound, freight: F, feasible: q.feasible };
}

export function initMarket(scenario: Scenario, cfg: MarketConfig, startDay: number): MarketState {
  const b = MODEL.brent;
  const m: MarketState = {
    day: startDay,
    regime: scenario.regime,
    brent: scenario.brent.value,
    brentH: b.omega.value / (1 - b.alpha.value - b.beta.value),
    cracks: { gasoline: scenario.cracks.gasoline.value, diesel: scenario.cracks.diesel.value, jet: scenario.cracks.jet.value },
    diffs: emptyHubTable(),
    tce: { MR: scenario.freight.MR.value, LR1: scenario.freight.LR1.value, LR2: scenario.freight.LR2.value },
    structure: { brent: scenario.structure.brent.value, gasoline: scenario.structure.gasoline.value, diesel: scenario.structure.diesel.value, jet: scenario.structure.jet.value },
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
  return m;
}

export function cloneMarket(m: MarketState): MarketState {
  return structuredClone(m);
}

export function hubPrice(m: MarketState, hub: HubId, p: ProductId): number {
  return m.brent + m.cracks[p] + m.diffs[hub][p];
}

export function season(p: ProductId, day: number): number {
  const c = MODEL.cracks[p].season.value;
  const doy = dayOfYear(day);
  let s = 0;
  for (let j = 0; j < c.length / 2; j++) {
    const w = (2 * Math.PI * (j + 1) * doy) / 365.25;
    s += (c[2 * j] ?? 0) * cos(w) + (c[2 * j + 1] ?? 0) * sin(w);
  }
  return s;
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
  const row = T[ri]!;
  let next = m.regime;
  for (let j = 0; j < row.length; j++) {
    acc += row[j]!;
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
    const tr = cfg.freezeChoke ? {} : (cfg.scenario.chokeTransition[c].value[m.choke[c]] ?? {});
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
  // Mean reversion of log price towards the regime level, with the volatility (Itô) correction
  // so that the price level, not just the log, tracks the target in high-volatility regimes.
  ret += B.levelKappa.value * (log(B.level[r].value) - log(m.brent)) + 0.5 * vm * vm * m.brentH;
  m.brentH = B.omega.value + B.alpha.value * diffusive * diffusive + B.beta.value * m.brentH;
  m.brent = Math.max(5, m.brent * exp(ret));

  // Cracks. Historical crack jumps (hurricanes, outages) hit products together, so jumps are a
  // common shock with product-specific scale plus a smaller idiosyncratic part.
  const jumpRate = PRODUCTS.reduce((s, p) => s + MODEL.cracks[p].byRegime[r].jumpRate.value, 0) / PRODUCTS.length;
  const jumpDay = rng.bernoulli(jumpRate / 252);
  const common = jumpDay ? rng.laplace(1) : 0;
  PRODUCTS.forEach((p, i) => {
    const cp = MODEL.cracks[p].byRegime[r];
    const mu = cfg.crackMean[r][p] + season(p, m.day) + effectShift(m, (t) => t.kind === "crack" && t.product === p);
    let x = m.cracks[p];
    x += cp.kappa.value * (mu - x) + cp.sigma.value * sw * (z[i + 1] ?? 0);
    if (jumpDay) x += 0.8 * common * cp.jumpScale.value + rng.laplace(0.2 * cp.jumpScale.value);
    m.cracks[p] = x;
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

  // Curve structure
  const S = MODEL.structure;
  for (const k of STRUCT_KEYS) {
    const mu = S.mean[r][k].value + effectShift(m, (t) => t.kind === "structure" && t.key === k);
    m.structure[k] += S.kappa.value * (mu - m.structure[k]) + S.sigma.value * rng.normal();
  }

  // Regional differentials, in topological order of the price graph
  const R = MODEL.regional;
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
      if (a.dir === "import" && d > par.bound) d += R.kappaOut.value * (par.bound - d);
      if (a.dir === "export" && d < par.bound) d += R.kappaOut.value * (par.bound - d);
    }
    if (a.hub === "NYH" && r === "normal") {
      const cal = a.product === "jet" ? MODEL.nyh.diesel : MODEL.nyh[a.product];
      if (d > cal.band_hi.value + 1) d += R.kappaOut.value * (cal.band_hi.value - d);
      if (d < cal.band_lo.value - 1) d += R.kappaOut.value * (cal.band_lo.value - d);
    }
    m.diffs[a.hub][a.product] = d;
  }
  return news;
}

/** Snapshot of all hub prices for history and pricing windows. */
export interface PriceRow {
  day: number;
  brent: number;
  cracks: Record<ProductId, number>;
  diffs: Record<HubId, Record<ProductId, number>>;
  structure: Record<StructKey, number>;
  tce: Record<VesselClass, number>;
  regime: Regime;
  choke: Record<ChokepointId, ChokeState>;
}

export function priceRow(m: MarketState): PriceRow {
  return structuredClone({ day: m.day, brent: m.brent, cracks: m.cracks, diffs: m.diffs, structure: m.structure, tce: m.tce, regime: m.regime, choke: m.choke });
}

export function rowPrice(row: PriceRow, hub: HubId, p: ProductId): number {
  return row.brent + row.cracks[p] + row.diffs[hub][p];
}
