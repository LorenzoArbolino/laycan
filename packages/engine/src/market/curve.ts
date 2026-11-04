/**
 * Forward curves as the model's own conditional expectation of future spot prices.
 *
 * A futures price, or the forward value of a cargo, is E_t[spot(T)] under the same dynamics
 * that move the spot market (the regime chain, Brent reversion, crack reversion to seasonal
 * and stock-dependent means, stock reversion, decaying event effects, hub differentials
 * reverting to parity). Nothing is added on top, so rolling futures, carrying cargoes or
 * pricing on the curve earns nothing on average: the shape of the curve is information, not
 * a free lunch.
 *
 * The shape still follows the theory of storage: low stocks lift cracks above their normal,
 * and the expected return to normal puts the curve in backwardation; surpluses depress cracks
 * and put it in contango. A war regime is expected to end (the regime chain), so its curves
 * are backwardated; a crash regime is expected to recover, so its curves are in contango.
 *
 * Representation: expected change vs today's spot, $/bbl, by calendar days ahead. Brent and
 * the USGC cracks carry full paths; a hub differential reverts geometrically to its parity
 * target, so it needs only its target, speed and the business-day count.
 */
import { exp, log, pow } from "../core/dmath";
import { isBusinessDay } from "../core/calendar";
import { PRODUCTS, type ProductId } from "../core/units";
import { MODEL, REGIMES, type Regime } from "../params/model";
import { HUBS, PRICE_GRAPH, type HubId } from "../world/world";
import type { MarketConfig, MarketState } from "./market";

/** Calendar days covered: the sixth listed Brent contract expires within ~6 months. */
export const CURVE_DAYS = 200;
export const DAYS_PER_MONTH = 30.4375;

export interface Curve {
  /** the day the curve was built (index 0) */
  day: number;
  /** expected Brent minus today's Brent, by calendar days ahead (index 0 = today = 0) */
  brent: number[];
  /** expected USGC crack minus today's crack */
  crack: Record<ProductId, number[]>;
  /** business days elapsed by calendar days ahead */
  bd: number[];
  /** parity target and daily reversion speed of each hub differential */
  diffTarget: Record<HubId, Record<ProductId, number>>;
  diffKappa: Record<HubId, Record<ProductId, number>>;
}

/**
 * Event effects that decay geometrically, grouped by what they move: each is updated by one
 * multiplication per calendar day instead of an exp per effect per day.
 */
class Decaying {
  private v: number[] = [];
  private r: number[] = [];
  add(amount: number, age: number, halfLifeDays: number) {
    this.v.push(amount * exp((-age * 0.6931471805599453) / halfLifeDays));
    this.r.push(exp(-0.6931471805599453 / halfLifeDays));
  }
  /** advance one calendar day and return the total */
  step(): number {
    let s = 0;
    for (let i = 0; i < this.v.length; i++) {
      this.v[i] = this.v[i]! * this.r[i]!;
      s += this.v[i]!;
    }
    return s;
  }
}

/** Brent drift that makes the stationary mean, not the median, equal the regime level. */
export function brentDrift(variance: number): number {
  return -0.25 * variance;
}

/** Daily log variance of Brent in a regime: diffusive part plus compound-Poisson jumps. */
export function brentVariance(r: (typeof REGIMES)[number], h: number): number {
  const B = MODEL.brent;
  const vm = B.volMult[r].value;
  const jump = r === "normal" ? 0 : (B.jumpRate.value / 252) * 2 * B.jumpScale.value * B.jumpScale.value;
  return vm * vm * h + jump;
}

/**
 * Build the curve from today's state. The model functions come from the market module
 * (passed in to avoid an import cycle).
 */
export function buildCurve(
  m: MarketState,
  cfg: MarketConfig,
  fns: {
    crackTarget: (cfg: MarketConfig, r: Regime, p: ProductId) => number;
    season: (p: ProductId, day: number) => number;
    parity: (m: MarketState, cfg: MarketConfig, hub: HubId, p: ProductId) => { target: number } | null;
  },
): Curve {
  const { crackTarget, season, parity } = fns;
  const B = MODEL.brent;
  const FD = MODEL.fundamentals;
  const T = MODEL.regimeTransition.value;
  // A frozen regime (analysis, tests) is known to stay; otherwise the chain is expected to move.
  // Replays freeze the regime only to follow history, which players do not know in advance.
  const frozen = !!cfg.freezeRegime && !cfg.replay;
  const pi: number[] = REGIMES.map((r) => (r === m.regime ? 1 : 0));
  const next = [0, 0, 0];

  // constants by regime (i) and product (j)
  const logL = REGIMES.map((r) => log(B.level[r].value));
  const vm2 = REGIMES.map((r) => B.volMult[r].value * B.volMult[r].value);
  const jv = REGIMES.map((r) => brentVariance(r, 0));
  const ks = PRODUCTS.map((p) => REGIMES.map((r) => MODEL.cracks[p].byRegime[r].slowKappa.value));
  const kf = PRODUCTS.map((p) => REGIMES.map((r) => MODEL.cracks[p].byRegime[r].fastKappa.value));
  const ksMu = PRODUCTS.map((p, j) => REGIMES.map((r, i) => ks[j]![i]! * crackTarget(cfg, r, p)));
  const cps = PRODUCTS.map((p) => FD.crackPerStock[p].value);
  const u2s = PRODUCTS.map((p) => FD.utilToStock[p].value);
  const sk = PRODUCTS.map((p) => FD.stockKappa[p].value);
  const kB = B.levelKappa.value;
  const ab = B.alpha.value + B.beta.value;

  let x = log(m.brent);
  let V = 0;
  let h = m.brentH;
  const fast = PRODUCTS.map((p) => m.crackFast[p]);
  const slow = PRODUCTS.map((p) => m.crackSlow[p]);
  const stockUS = PRODUCTS.map((p) => m.stocks.US[p]);
  let utilUS = m.util.US;
  const crackFx = PRODUCTS.map(() => new Decaying());
  const stockFx = PRODUCTS.map(() => new Decaying());
  const utilFx = new Decaying();
  for (const e of m.effects) {
    const age = m.day - e.startDay;
    const t = e.target;
    if (t.kind === "crack") crackFx[PRODUCTS.indexOf(t.product)]!.add(e.amount, age, e.halfLifeDays);
    else if (t.kind === "stocks" && (t.region ?? "US") === "US") stockFx[PRODUCTS.indexOf(t.product)]!.add(e.amount, age, e.halfLifeDays);
    else if (t.kind === "util" && t.region === "US") utilFx.add(e.amount, age, e.halfLifeDays);
  }

  const out: Curve = {
    day: m.day,
    brent: [0],
    crack: { gasoline: [0], diesel: [0], jet: [0] },
    bd: [0],
    diffTarget: {} as Curve["diffTarget"],
    diffKappa: {} as Curve["diffKappa"],
  };
  const crackOut = PRODUCTS.map((p) => out.crack[p]);
  let nbd = 0;
  for (let n = 1; n <= CURVE_DAYS; n++) {
    const day = m.day + n;
    const stockFlow = [stockFx[0]!.step(), stockFx[1]!.step(), stockFx[2]!.step()];
    const utilTarget = utilFx.step();
    if (isBusinessDay(day)) {
      nbd++;
      if (!frozen) {
        for (let j = 0; j < 3; j++) next[j] = pi[0]! * T[0]![j]! + pi[1]! * T[1]![j]! + pi[2]! * T[2]![j]!;
        for (let j = 0; j < 3; j++) pi[j] = next[j]!;
      }
      // Brent: E[log B] and Var[log B] of the log-AR(1) with the same drift as the spot step
      let target = 0;
      let varN = 0;
      for (let i = 0; i < 3; i++) {
        target += pi[i]! * logL[i]!;
        varN += pi[i]! * (vm2[i]! * h + jv[i]!);
      }
      x = x + kB * (target - x) + brentDrift(varN);
      V = (1 - kB) * (1 - kB) * V + varN;
      h = B.omega.value + ab * h;
      // Cracks: the fast part fades; the slow part reverts to the regime-weighted mean
      for (let j = 0; j < 3; j++) {
        let a = 0;
        let b = 0;
        let c = 0;
        for (let i = 0; i < 3; i++) {
          a += pi[i]! * ks[j]![i]!;
          b += pi[i]! * ksMu[j]![i]!;
          c += pi[i]! * kf[j]![i]!;
        }
        slow[j] = slow[j]! + b - a * slow[j]!;
        fast[j] = fast[j]! * (1 - c);
      }
      // US stocks and refinery runs (the stock signal in the crack overlay)
      for (let j = 0; j < 3; j++) stockUS[j] = stockUS[j]! + u2s[j]! * utilUS + stockFlow[j]! - sk[j]! * stockUS[j]!;
      utilUS += FD.utilKappa.value * (utilTarget - utilUS);
    }
    out.brent.push(exp(x + V / 2) - m.brent);
    for (let j = 0; j < 3; j++) {
      // same overlay as the spot crack: season + US stock effect + event shifts
      const overlay = season(PRODUCTS[j]!, day) + cps[j]! * stockUS[j]! + crackFx[j]!.step();
      crackOut[j]!.push(slow[j]! + fast[j]! + overlay - m.cracks[PRODUCTS[j]!]);
    }
    out.bd.push(nbd);
  }

  for (const hub of HUBS) {
    out.diffTarget[hub] = { gasoline: 0, diesel: 0, jet: 0 };
    out.diffKappa[hub] = { gasoline: 0, diesel: 0, jet: 0 };
    for (const p of PRODUCTS) {
      const par = cfg.replay && hub === "NYH" && p !== "jet" ? null : parity(m, cfg, hub, p);
      const arc = PRICE_GRAPH.find((a) => a.hub === hub && a.product === p);
      out.diffTarget[hub][p] = par ? par.target : m.diffs[hub][p];
      let kap = arc ? MODEL.regional.kappaIn.value : 0;
      if (arc && hub === "NYH") kap = (p === "jet" ? MODEL.nyh.diesel : MODEL.nyh[p]).kappa.value;
      out.diffKappa[hub][p] = par ? kap : 0;
    }
  }
  return out;
}

function at(xs: number[], n: number): number {
  return xs[Math.max(0, Math.min(xs.length - 1, n))] ?? 0;
}

/** Calendar days from the curve's build day, clamped to the curve. */
function offset(c: Curve, day: number): number {
  return Math.max(0, Math.min(CURVE_DAYS, Math.round(day - c.day)));
}

/** Expected Brent on a future day (today's spot for today or earlier). */
export function brentForward(m: MarketState, day: number): number {
  if (!m.curve || day <= m.day) return m.brent;
  return m.brent + at(m.curve.brent, offset(m.curve, day)) - at(m.curve.brent, offset(m.curve, m.day));
}

/** Expected hub price on a future day (today's spot for today or earlier). */
export function hubForward(m: MarketState, hub: HubId, p: ProductId, day: number): number {
  const c = m.curve;
  const d = m.diffs[hub][p];
  if (!c || day <= m.day) return m.brent + m.cracks[p] + d;
  // values relative to today: the curve may have been built on an earlier (business) day
  const n = offset(c, day);
  const n0 = offset(c, m.day);
  const tgt = c.diffTarget[hub]?.[p] ?? d;
  const kap = c.diffKappa[hub]?.[p] ?? 0;
  const diff = kap > 0 ? tgt + (d - tgt) * pow(1 - kap, at(c.bd, n) - at(c.bd, n0)) : d;
  return m.brent + at(c.brent, n) - at(c.brent, n0) + m.cracks[p] + at(c.crack[p], n) - at(c.crack[p], n0) + diff;
}

/** Front spread summary: expected fall in price over the next month, $/bbl (positive = backwardation). */
export function frontSpread(c: Curve, key: "brent" | ProductId): number {
  const n = Math.round(DAYS_PER_MONTH);
  const b = at(c.brent, n);
  return -(key === "brent" ? b : b + at(c.crack[key], n));
}

/** Steepen a curve by $1/bbl per month (for risk sensitivities). */
export function tilt(c: Curve, key: "brent" | ProductId, perMonth: number): void {
  const xs = key === "brent" ? c.brent : c.crack[key];
  for (let n = 0; n < xs.length; n++) xs[n] = xs[n]! - (perMonth * n) / DAYS_PER_MONTH;
}
