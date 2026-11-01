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
          "crack": 10719569,
          "events": -23640396,
          "execution": -4985759,
          "finance": -1524180,
          "flat_price": 1333814,
          "freight": -47681001,
          "optionality": -500930,
          "quality": 0,
          "regional": 28173527,
          "time_spread": -15440723,
        },
        "deals": 22,
        "equity": -3546078,
        "lastBrent": 130.25,
        "voyages": 11,
      }
    `);
  });
  it("normal_2025 arbitrage strategy", () => {
    expect(play("normal_2025")).toMatchInlineSnapshot(`
      {
        "attribution": {
          "crack": 3011956,
          "events": -494509,
          "execution": -5047055,
          "finance": -319185,
          "flat_price": 770806,
          "freight": -22108052,
          "optionality": -427598,
          "quality": 0,
          "regional": 14310121,
          "time_spread": -1083968,
        },
        "deals": 24,
        "equity": 38612515,
        "lastBrent": 70.2,
        "voyages": 12,
      }
    `);
  });
});
