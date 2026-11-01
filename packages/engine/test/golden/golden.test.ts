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
          "crack": 2123296,
          "events": -1626951,
          "execution": -2625584,
          "finance": -1483801,
          "flat_price": -14927213,
          "freight": -40755226,
          "optionality": 5241722,
          "quality": 0,
          "regional": 20792067,
          "time_spread": -14146055,
        },
        "deals": 22,
        "equity": 2592254,
        "lastBrent": 136.01,
        "voyages": 11,
      }
    `);
  });
  it("normal_2025 arbitrage strategy", () => {
    expect(play("normal_2025")).toMatchInlineSnapshot(`
      {
        "attribution": {
          "crack": 3565071,
          "events": -1209786,
          "execution": -4509754,
          "finance": -470573,
          "flat_price": 2815713,
          "freight": -18674468,
          "optionality": -2045702,
          "quality": 0,
          "regional": 15215854,
          "time_spread": -889522,
        },
        "deals": 24,
        "equity": 43796833,
        "lastBrent": 64.62,
        "voyages": 12,
      }
    `);
  });
});
