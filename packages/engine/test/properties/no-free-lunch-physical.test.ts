/**
 * No free lunch, physical arbitrage in generated markets: shipping whenever a bid exists loses
 * money (freight, penalties, mismatched laycans and quantities); a disciplined arbitrage that
 * pays for freight and financing and matches quantity and laycan keeps a positive edge, so
 * the game does not teach "never ship".
 */
import { describe, expect, it } from "vitest";
import { arbWeek, disciplinedArbWeek } from "../strategies";
import { excess, mean } from "./nfl-helpers";

describe("no free lunch: physical arbitrage", () => {
  it("naive shipping loses money; a disciplined arbitrage earns a positive edge", () => {
    const naive = excess((g) => arbWeek(g), 25);
    const disciplined = excess((g) => disciplinedArbWeek(g), 40);
    expect(mean(naive)).toBeLessThan(0);
    // ≈ +$0.5m per 12-week game on these seeds (about 1% of equity): an edge, not a money machine
    expect(mean(disciplined)).toBeGreaterThan(0);
    expect(mean(disciplined)).toBeLessThan(5e6);
    expect(mean(disciplined)).toBeGreaterThan(mean(naive) + 5e6);
  });
});
