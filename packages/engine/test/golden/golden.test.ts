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
          "crack": 9983299,
          "events": -1752906,
          "execution": -6353025,
          "finance": -1562129,
          "flat_price": -489501,
          "freight": -66119268,
          "optionality": 6278555,
          "quality": -1032108,
          "regional": -1321181,
          "time_spread": 6068810,
        },
        "deals": 22,
        "equity": -6299453,
        "lastBrent": 93.25,
        "voyages": 11,
      }
    `);
  });
  it("normal_2025 arbitrage strategy", () => {
    expect(play("normal_2025")).toMatchInlineSnapshot(`
      {
        "attribution": {
          "crack": 5153300,
          "events": -1262215,
          "execution": -4450647,
          "finance": -480746,
          "flat_price": 1460193,
          "freight": -25946501,
          "optionality": -375999,
          "quality": 0,
          "regional": 24871926,
          "time_spread": -1852947,
        },
        "deals": 22,
        "equity": 47116364,
        "lastBrent": 64.97,
        "voyages": 11,
      }
    `);
  });
});
