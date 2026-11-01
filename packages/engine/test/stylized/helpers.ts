import { parseDate } from "../../src/core/calendar";
import { Rng } from "../../src/core/rng";
import { initMarket, makeConfig, stepMarket, priceRow, parity, type MarketState, type PriceRow } from "../../src/market/market";
import { SCENARIOS, type Regime } from "../../src/params/model";

export function simulate(opts: { scenario: string; regime: Regime; years: number; seed: string; freezeChoke?: boolean; onDay?: (m: MarketState, cfg: ReturnType<typeof makeConfig>) => void }): PriceRow[] {
  const sc = { ...SCENARIOS[opts.scenario]!, regime: opts.regime };
  const cfg = { ...makeConfig(sc), freezeRegime: true, freezeChoke: opts.freezeChoke ?? true };
  const m = initMarket(sc, cfg, parseDate(sc.startDate));
  const rng = Rng.stream(opts.seed, "market");
  const rows: PriceRow[] = [];
  const days = Math.round(opts.years * 365.25);
  for (let i = 0; i < days; i++) {
    const before = m.day;
    stepMarket(m, cfg, rng);
    if (m.day !== before && rows.at(-1)?.brent !== m.brent) {
      rows.push(priceRow(m));
      opts.onDay?.(m, cfg);
    }
  }
  return rows;
}

export { parity };

export function excessKurtosis(x: number[]): number {
  const n = x.length;
  const mu = x.reduce((a, b) => a + b, 0) / n;
  let m2 = 0,
    m4 = 0;
  for (const v of x) {
    const d = v - mu;
    m2 += d * d;
    m4 += d * d * d * d;
  }
  m2 /= n;
  m4 /= n;
  return m4 / (m2 * m2) - 3;
}

export function acf(x: number[], lag: number): number {
  const n = x.length;
  const mu = x.reduce((a, b) => a + b, 0) / n;
  let num = 0,
    den = 0;
  for (let i = 0; i < n; i++) {
    den += (x[i]! - mu) ** 2;
    if (i >= lag) num += (x[i]! - mu) * (x[i - lag]! - mu);
  }
  return num / den;
}

export function ar1HalfLife(x: number[]): number {
  const n = x.length - 1;
  let sx = 0,
    sy = 0,
    sxx = 0,
    sxy = 0;
  for (let i = 0; i < n; i++) {
    const a = x[i]!,
      b = x[i + 1]!;
    sx += a;
    sy += b;
    sxx += a * a;
    sxy += a * b;
  }
  const beta = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  return Math.log(2) / -Math.log(beta);
}

export function corr(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0,
    da = 0,
    db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i]! - ma) * (b[i]! - mb);
    da += (a[i]! - ma) ** 2;
    db += (b[i]! - mb) ** 2;
  }
  return num / Math.sqrt(da * db);
}
