import { describe, expect, it } from "vitest";
import { Game } from "../../src/game";
import { arbWeek } from "../strategies";

describe("golden runs (generated and replay)", () => {
  for (const scenario of ["generated", "covid_2020"]) {
    it(scenario, () => {
      const g = Game.create({ scenario, seed: "golden-2" });
      while (!g.over) {
        arbWeek(g);
        g.advance();
      }
      expect({ equity: Math.round(g.equity()), brent: Math.round(g.market.brent * 100) / 100, start: g.displayDate(g.state.startDay) }).toMatchSnapshot();
    });
  }
});
