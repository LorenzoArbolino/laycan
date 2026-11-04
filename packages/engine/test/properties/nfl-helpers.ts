/** Shared helpers for the no-free-lunch suites. */
import { Rng } from "../../src/core/rng";
import { Game } from "../../src/game";

export const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / x.length;
export const se = (x: number[]) => {
  const m = mean(x);
  return Math.sqrt(x.reduce((a, b) => a + (b - m) ** 2, 0) / (x.length - 1) / x.length);
};

const baseline = new Map<number, number>();
/** P&L of doing nothing (interest on cash) in the generated market of a seed. */
function idle(s: number): number {
  let v = baseline.get(s);
  if (v === undefined) {
    const g = Game.create({ scenario: "generated", seed: `nfl-${s}` });
    const e0 = g.equity();
    while (!g.over) g.advance();
    v = g.equity() - e0;
    baseline.set(s, v);
  }
  return v;
}

/** P&L of a strategy minus the P&L of doing nothing, seed by seed, in generated 12-week games. */
export function excess(f: (g: Game, r: Rng) => void, seeds: number): number[] {
  const out: number[] = [];
  for (let s = 0; s < seeds; s++) {
    const g = Game.create({ scenario: "generated", seed: `nfl-${s}` });
    const e0 = g.equity();
    const r = Rng.stream(`nfl-${s}`, "strategy");
    while (!g.over) {
      f(g, r);
      g.advance();
    }
    out.push(g.equity() - e0 - idle(s));
  }
  return out;
}
