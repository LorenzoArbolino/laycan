import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { cos, exp, log, pow, pow2, sin } from "../../src/core/dmath";

const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(1e-300, Math.abs(b));

describe("deterministic math matches IEEE references", () => {
  it("pow2 builds exact powers of two", () => {
    for (let k = -1074; k <= 1023; k += 7) expect(pow2(k)).toBe(2 ** k);
  });
  it("exp is within 2 ulp of Math.exp", () => {
    fc.assert(fc.property(fc.double({ min: -700, max: 700, noNaN: true }), (x) => rel(exp(x), Math.exp(x)) < 5e-16));
  });
  it("log is within 2 ulp of Math.log", () => {
    fc.assert(fc.property(fc.double({ min: 1e-300, max: 1e300, noNaN: true }), (x) => Math.abs(log(x) - Math.log(x)) <= 4.5e-16 * Math.max(1, Math.abs(Math.log(x)))));
  });
  it("sin and cos are accurate on the engine's range", () => {
    fc.assert(
      fc.property(fc.double({ min: -1000, max: 1000, noNaN: true }), (x) =>
        Math.abs(sin(x) - Math.sin(x)) < 1e-15 && Math.abs(cos(x) - Math.cos(x)) < 1e-15,
      ),
    );
  });
  it("pow agrees with Math.pow for positive bases", () => {
    fc.assert(fc.property(fc.double({ min: 1e-3, max: 1e3, noNaN: true }), fc.double({ min: -5, max: 5, noNaN: true }), (x, y) => rel(pow(x, y), Math.pow(x, y)) < 1e-14));
  });
  it("golden vector is stable (guards against accidental algorithm changes)", () => {
    const v = [exp(1), log(10), sin(1), cos(2), exp(-3.3), log(0.07)];
    expect(v.map((x) => x.toPrecision(17))).toMatchInlineSnapshot(`
      [
        "2.7182818284590455",
        "2.3025850929940459",
        "0.84147098480789650",
        "-0.41614683654714241",
        "0.036883167401240015",
        "-2.6592600369327779",
      ]
    `);
  });
});
