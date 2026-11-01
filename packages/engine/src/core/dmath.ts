/**
 * Deterministic transcendental functions.
 *
 * ECMAScript leaves Math.exp/log/sin/cos "implementation-approximated", so two browsers can
 * return different last bits. Shared seeds and leaderboards need bit-identical runs, so the
 * engine uses these ports of the classic fdlibm algorithms, built only from IEEE-754
 * +, -, *, / (which are exact and identical everywhere) plus bit manipulation.
 *
 * Accuracy: < 1 ulp for exp/log; sin/cos are accurate to ~1e-16 for |x| < 1e5, which covers
 * every use in the engine (seasonal angles, Box-Muller-free sampling).
 */

const buf = new DataView(new ArrayBuffer(8));

function hiWord(x: number): number {
  buf.setFloat64(0, x);
  return buf.getInt32(0);
}
function loWord(x: number): number {
  buf.setFloat64(0, x);
  return buf.getUint32(4);
}
function fromWords(hi: number, lo: number): number {
  buf.setInt32(0, hi);
  buf.setUint32(4, lo >>> 0);
  return buf.getFloat64(0);
}
function withHighWord(x: number, hi: number): number {
  return fromWords(hi, loWord(x));
}

/** Exact 2^k for integer k, built from bits (no Math.pow). */
export function pow2(k: number): number {
  if (k > 1023) return pow2(1023) * pow2(k - 1023);
  if (k < -1022) return pow2(-1022) * pow2(k + 1022);
  return fromWords((k + 1023) << 20, 0);
}

const LN2_HI = 6.93147180369123816490e-1;
const LN2_LO = 1.90821492927058770002e-10;
const INV_LN2 = 1.4426950408889633870;
const P1 = 1.66666666666666019037e-1;
const P2 = -2.77777777770155933842e-3;
const P3 = 6.61375632143793436117e-5;
const P4 = -1.65339022054652515390e-6;
const P5 = 4.13813679705723846039e-8;

export function exp(x: number): number {
  if (Number.isNaN(x)) return NaN;
  if (x > 709.782712893384) return Infinity;
  if (x < -745.1332191019411) return 0;
  const ax = Math.abs(x);
  let hi = 0;
  let lo = 0;
  let k = 0;
  if (ax > 0.5 * 0.6931471805599453) {
    if (ax < 1.5 * 0.6931471805599453) {
      if (x > 0) {
        hi = x - LN2_HI;
        lo = LN2_LO;
        k = 1;
      } else {
        hi = x + LN2_HI;
        lo = -LN2_LO;
        k = -1;
      }
    } else {
      k = Math.trunc(INV_LN2 * x + (x > 0 ? 0.5 : -0.5));
      hi = x - k * LN2_HI;
      lo = k * LN2_LO;
    }
    x = hi - lo;
  } else if (ax < 3.725290298461914e-9) {
    return 1 + x;
  }
  const t = x * x;
  const c = x - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  if (k === 0) return 1 - ((x * c) / (c - 2.0) - x);
  const y = 1 - (lo - (x * c) / (2.0 - c) - hi);
  return y * pow2(k);
}

const TWO54 = 1.80143985094819840000e16;
const Lg1 = 6.666666666666735130e-1;
const Lg2 = 3.999999999940941908e-1;
const Lg3 = 2.857142874366239149e-1;
const Lg4 = 2.222219843214978396e-1;
const Lg5 = 1.818357216161805012e-1;
const Lg6 = 1.531383769920937332e-1;
const Lg7 = 1.479819860511658591e-1;

export function log(x: number): number {
  if (Number.isNaN(x) || x < 0) return NaN;
  if (x === 0) return -Infinity;
  if (x === Infinity) return Infinity;
  let hx = hiWord(x);
  let k = 0;
  if (hx < 0x00100000) {
    k -= 54;
    x *= TWO54;
    hx = hiWord(x);
  }
  k += (hx >> 20) - 1023;
  hx &= 0x000fffff;
  const i0 = (hx + 0x95f64) & 0x100000;
  x = withHighWord(x, hx | (i0 ^ 0x3ff00000));
  k += i0 >> 20;
  const f = x - 1.0;
  const dk = k;
  if ((0x000fffff & (2 + hx)) < 3) {
    if (f === 0) return k === 0 ? 0 : dk * LN2_HI + dk * LN2_LO;
    const R = f * f * (0.5 - 0.33333333333333333 * f);
    return k === 0 ? f - R : dk * LN2_HI - (R - dk * LN2_LO - f);
  }
  const s = f / (2.0 + f);
  const z = s * s;
  let i = hx - 0x6147a;
  const w = z * z;
  const j = 0x6b851 - hx;
  const t1 = w * (Lg2 + w * (Lg4 + w * Lg6));
  const t2 = z * (Lg1 + w * (Lg3 + w * (Lg5 + w * Lg7)));
  i |= j;
  const R = t2 + t1;
  if (i > 0) {
    const hfsq = 0.5 * f * f;
    return k === 0 ? f - (hfsq - s * (hfsq + R)) : dk * LN2_HI - (hfsq - (s * (hfsq + R) + dk * LN2_LO) - f);
  }
  return k === 0 ? f - s * (f - R) : dk * LN2_HI - (s * (f - R) - dk * LN2_LO - f);
}

const S1 = -1.66666666666666324348e-1;
const S2 = 8.33333333332248946124e-3;
const S3 = -1.98412698298579493134e-4;
const S4 = 2.75573137070700676789e-6;
const S5 = -2.50507602534068634195e-8;
const S6 = 1.58969099521155010221e-10;
const C1 = 4.16666666666666019037e-2;
const C2 = -1.38888888888741095749e-3;
const C3 = 2.48015872894767294178e-5;
const C4 = -2.75573143513906633035e-7;
const C5 = 2.08757232129817482790e-9;
const C6 = -1.13596475577881948265e-11;

function kSin(x: number, y: number): number {
  const z = x * x;
  const v = z * x;
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  return x - ((z * (0.5 * y - v * r) - y) - v * S1);
}
function kCos(x: number, y: number): number {
  const z = x * x;
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  const hz = 0.5 * z;
  const w = 1.0 - hz;
  return w + ((1.0 - w - hz) + (z * r - x * y));
}

const PIO2_1 = 1.57079632673412561417;
const PIO2_1T = 6.07710050650619224932e-11;
const PIO2_2 = 6.07710050630396597660e-11;
const PIO2_2T = 2.02226624879595063154e-21;
const INV_PIO2 = 6.36619772367581382433e-1;

/** Cody–Waite reduction x = n·π/2 + (y0 + y1), valid for |x| < ~1e5. */
function remPio2(x: number): [number, number, number] {
  const n = Math.floor(x * INV_PIO2 + 0.5);
  let r = x - n * PIO2_1;
  let w = n * PIO2_1T;
  let y0 = r - w;
  // second step for extra precision near multiples of pi/2
  const t = r;
  w = n * PIO2_2;
  r = t - w;
  w = n * PIO2_2T - (t - r - w);
  y0 = r - w;
  const y1 = r - y0 - w;
  return [n, y0, y1];
}

export function sin(x: number): number {
  if (!Number.isFinite(x)) return NaN;
  if (Math.abs(x) <= 0.7853981633974483) return kSin(x, 0);
  const [n, y0, y1] = remPio2(x);
  switch (((n % 4) + 4) % 4) {
    case 0:
      return kSin(y0, y1);
    case 1:
      return kCos(y0, y1);
    case 2:
      return -kSin(y0, y1);
    default:
      return -kCos(y0, y1);
  }
}

export function cos(x: number): number {
  if (!Number.isFinite(x)) return NaN;
  if (Math.abs(x) <= 0.7853981633974483) return kCos(x, 0);
  const [n, y0, y1] = remPio2(x);
  switch (((n % 4) + 4) % 4) {
    case 0:
      return kCos(y0, y1);
    case 1:
      return -kSin(y0, y1);
    case 2:
      return -kCos(y0, y1);
    default:
      return kSin(y0, y1);
  }
}

/** x^y for x > 0 via exp(y·log x). Deterministic, ~2 ulp. */
export function pow(x: number, y: number): number {
  if (y === 0) return 1;
  if (x === 0) return y > 0 ? 0 : Infinity;
  if (x < 0) return NaN;
  return exp(y * log(x));
}

/** sqrt is correctly rounded by IEEE-754, so Math.sqrt is already deterministic. */
export const sqrt = Math.sqrt;
