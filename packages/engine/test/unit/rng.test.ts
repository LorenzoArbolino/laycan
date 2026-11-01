import { describe, expect, it } from "vitest";
import { Rng } from "../../src/core/rng";

describe("seeded RNG", () => {
  it("same seed and stream gives the same sequence", () => {
    const a = Rng.stream("seed-1", "prices");
    const b = Rng.stream("seed-1", "prices");
    for (let i = 0; i < 1000; i++) expect(a.uniform()).toBe(b.uniform());
  });
  it("named streams are independent of each other's usage", () => {
    const p1 = Rng.stream("s", "prices");
    const other = Rng.stream("s", "deals");
    for (let i = 0; i < 500; i++) other.normal();
    const p2 = Rng.stream("s", "prices");
    for (let i = 0; i < 100; i++) expect(p1.normal()).toBe(p2.normal());
  });
  it("different seeds differ", () => {
    expect(Rng.stream("a", "x").uniform()).not.toBe(Rng.stream("b", "x").uniform());
  });
  it("uniform in [0,1) with sane moments", () => {
    const r = new Rng("moments");
    let s = 0,
      s2 = 0;
    const n = 200_000;
    for (let i = 0; i < n; i++) {
      const u = r.uniform();
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
      s += u;
      s2 += u * u;
    }
    expect(s / n).toBeCloseTo(0.5, 2);
    expect(s2 / n - (s / n) ** 2).toBeCloseTo(1 / 12, 2);
  });
  it("normal has mean 0, variance 1", () => {
    const r = new Rng("normal");
    let s = 0,
      s2 = 0;
    const n = 200_000;
    for (let i = 0; i < n; i++) {
      const z = r.normal();
      s += z;
      s2 += z * z;
    }
    expect(Math.abs(s / n)).toBeLessThan(0.01);
    expect(s2 / n).toBeCloseTo(1, 1);
  });
  it("gamma mean equals shape", () => {
    const r = new Rng("gamma");
    for (const k of [0.5, 1, 3.1]) {
      let s = 0;
      for (let i = 0; i < 50_000; i++) s += r.gamma(k);
      expect(s / 50_000).toBeCloseTo(k, 1);
    }
  });
  it("snapshot/restore resumes the exact sequence", () => {
    const r = new Rng("snap");
    r.normal();
    const snap = r.snapshot();
    const a = [r.uniform(), r.normal(), r.uniform()];
    const r2 = new Rng(snap);
    expect([r2.uniform(), r2.normal(), r2.uniform()]).toEqual(a);
  });
  it("golden sequence is stable across platforms", () => {
    const r = Rng.stream("golden", "x");
    expect([r.nextU32(), r.nextU32(), r.nextU32()]).toMatchInlineSnapshot(`
      [
        396863482,
        3665471028,
        1452096551,
      ]
    `);
  });
});
