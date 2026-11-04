/**
 * No free lunch, paper and random trading in generated markets: P&L in excess of doing
 * nothing (interest on cash), seed by seed.
 */
import { describe, expect, it } from "vitest";
import { randomWeek, rollWeek } from "../strategies";
import { excess, mean, se } from "./nfl-helpers";

describe("no free lunch: paper and random trading", () => {
  it("holding and rolling futures earns only noise", () => {
    for (const [c, lots] of [["BRN", 50], ["HO", 50], ["GO", -60]] as const) {
      const x = excess((g) => rollWeek(g, c, lots), 20);
      expect(Math.abs(mean(x)), `${c}: ${(mean(x) / 1e3).toFixed(0)}k ± ${(se(x) / 1e3).toFixed(0)}k`).toBeLessThan(3 * se(x) + 50_000);
    }
  });
  it("random trading does not make money", () => {
    const x = excess((g, r) => randomWeek(g, r), 25);
    expect(mean(x) - 2 * se(x)).toBeLessThan(0);
  });
});
