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
          "crack": 12107671,
          "events": -1317761,
          "execution": -4502283,
          "finance": -965626,
          "flat_price": 21849378,
          "freight": -56965880,
          "optionality": 2792789,
          "quality": -881571,
          "regional": 36937252,
          "time_spread": -16474623,
        },
        "deals": 22,
        "equity": 42579346,
        "lastBrent": 91.81,
        "voyages": 11,
      }
    `);
  });
  it("normal_2025 arbitrage strategy", () => {
    expect(play("normal_2025")).toMatchInlineSnapshot(`
      {
        "attribution": {
          "crack": -248068,
          "events": -721746,
          "execution": -5265715,
          "finance": -161968,
          "flat_price": 10941608,
          "freight": -22027511,
          "optionality": -148146,
          "quality": 0,
          "regional": 8853291,
          "time_spread": 563704,
        },
        "deals": 24,
        "equity": 41785448,
        "lastBrent": 52.79,
        "voyages": 12,
      }
    `);
  });
});
