/**
 * Seeded, splittable pseudo-random numbers (xoshiro128**), using only 32-bit integer ops
 * and deterministic math, so the same seed gives the same game on every platform.
 *
 * Streams are named: rng.stream("prices") always yields the same sequence for a given seed,
 * independent of how much any other stream has been used. That is what makes the market path
 * independent of the player's actions.
 */
import { exp, log, sqrt } from "./dmath";

/** cyrb128 string hash -> four 32-bit words. */
function hash128(str: string): [number, number, number, number] {
  let h1 = 1779033703,
    h2 = 3144134277,
    h3 = 1013904242,
    h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

export interface RngState {
  s: [number, number, number, number];
  spare: number | null;
}

export class Rng {
  private s: [number, number, number, number];
  private spare: number | null = null;

  constructor(seed: string | RngState) {
    if (typeof seed === "string") {
      this.s = hash128(seed);
      if ((this.s[0] | this.s[1] | this.s[2] | this.s[3]) === 0) this.s[0] = 1;
    } else {
      this.s = [...seed.s];
      this.spare = seed.spare;
    }
  }

  /** Derive an independent named stream. */
  static stream(seed: string, name: string): Rng {
    return new Rng(`${seed}::${name}`);
  }

  snapshot(): RngState {
    return { s: [...this.s], spare: this.spare };
  }

  nextU32(): number {
    const s = this.s;
    const result = Math.imul(rotl(Math.imul(s[1], 5), 7), 9) >>> 0;
    const t = s[1] << 9;
    s[2] ^= s[0];
    s[3] ^= s[1];
    s[1] ^= s[2];
    s[0] ^= s[3];
    s[2] ^= t;
    s[3] = rotl(s[3], 11);
    s[0] >>>= 0;
    s[1] >>>= 0;
    s[2] >>>= 0;
    s[3] >>>= 0;
    return result;
  }

  /** Uniform in [0, 1) with 53 bits of precision. */
  uniform(): number {
    const a = this.nextU32() >>> 5;
    const b = this.nextU32() >>> 6;
    return (a * 67108864 + b) / 9007199254740992;
  }

  /** Integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.uniform() * n);
  }

  pick<T>(xs: readonly T[]): T {
    const v = xs[this.int(xs.length)];
    if (v === undefined) throw new Error("pick from empty array");
    return v;
  }

  bernoulli(p: number): boolean {
    return this.uniform() < p;
  }

  /** Standard normal via the Marsaglia polar method (needs only log and sqrt). */
  normal(): number {
    if (this.spare !== null) {
      const v = this.spare;
      this.spare = null;
      return v;
    }
    let u = 0,
      v = 0,
      s = 0;
    do {
      u = 2 * this.uniform() - 1;
      v = 2 * this.uniform() - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);
    const m = sqrt((-2 * log(s)) / s);
    this.spare = v * m;
    return u * m;
  }

  /** Gamma(shape, 1) via Marsaglia–Tsang. */
  gamma(shape: number): number {
    if (shape < 1) {
      const u = this.uniform();
      return this.gamma(shape + 1) * exp(log(u) / shape);
    }
    const d = shape - 1 / 3;
    const c = 1 / sqrt(9 * d);
    for (;;) {
      let x = 0,
        v = 0;
      do {
        x = this.normal();
        v = 1 + c * x;
      } while (v <= 0);
      v = v * v * v;
      const u = this.uniform();
      if (u < 1 - 0.0331 * x * x * x * x) return d * v;
      if (log(u) < 0.5 * x * x + d * (1 - v + log(v))) return d * v;
    }
  }

  /** Scale factor W so that z·sqrt(W) is Student-t(nu) for z ~ N(0,1), rescaled to unit variance. */
  studentScale(nu: number): number {
    const chi2 = 2 * this.gamma(nu / 2);
    return (nu - 2) / chi2;
  }

  /** Two-sided fat-tailed jump size: Laplace with given mean absolute size. */
  laplace(meanAbs: number): number {
    const u = this.uniform() - 0.5;
    const sign = u < 0 ? -1 : 1;
    return -meanAbs * sign * log(1 - 2 * Math.abs(u));
  }
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}
