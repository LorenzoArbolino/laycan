/** Golden runs: a fixed seed and scripted strategy must reproduce the same result exactly. */
import { describe, expect, it } from "vitest";
import { Game } from "../../src/game";
import { arbWeek } from "../strategies";

function play(scenario: string) {
  const g = Game.create({ scenario, seed: "golden-1" });
  while (!g.over) {
    arbWeek(g);
    g.advance();
  }
  const round = (x: number) => Math.round(x);
  return {
    equity: round(g.equity()),
    deals: g.book.deals.length,
    voyages: g.book.voyages.length,
    attribution: Object.fromEntries(g.attributionTotals().map((a) => [a.bucket, round(a.total)])),
    lastBrent: Math.round(g.market.brent * 100) / 100,
  };
}

describe("golden runs", () => {
  it("now_2026_11 arbitrage strategy", () => {
    expect(play("now_2026_11")).toMatchInlineSnapshot(`
      {
        "attribution": {
          "crack": -12711263,
          "events": -1899846,
          "execution": -3337537,
          "finance": -2895311,
          "flat_price": 5077826,
          "freight": -79687815,
          "optionality": -1202848,
          "quality": -993898,
          "regional": 47463701,
          "time_spread": -20720133,
        },
        "deals": 20,
        "equity": -20907125,
        "lastBrent": 98.44,
        "voyages": 10,
      }
    `);
  });
  it("normal_2025 arbitrage strategy", () => {
    expect(play("normal_2025")).toMatchInlineSnapshot(`
      {
        "attribution": {
          "crack": -2753147,
          "events": -1197071,
          "execution": -3680234,
          "finance": -740119,
          "flat_price": 14252269,
          "freight": -24196477,
          "optionality": 534771,
          "quality": -1746037,
          "regional": 18662956,
          "time_spread": -1083220,
        },
        "deals": 24,
        "equity": 48053691,
        "lastBrent": 57.36,
        "voyages": 12,
      }
    `);
  });
});
