import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { Game } from "../../../packages/engine/src/game";

function playPassive(seed: string): string {
  const g = Game.create({ scenario: "now_2026_11", seed });
  while (!g.over) g.advance();
  return createHash("sha256").update(JSON.stringify(g.state.history)).digest("hex");
}

test("a game is bit-identical in Node and in the browser", async ({ page }) => {
  await page.goto("/");
  const browserHistory = await page.evaluate(() => {
    const { Game } = (window as unknown as { laycan: { Game: typeof import("../../../packages/engine/src/game").Game } }).laycan;
    const g = Game.create({ scenario: "now_2026_11", seed: "cross-engine" });
    while (!g.over) g.advance();
    return JSON.stringify(g.state.history);
  });
  const browserHash = createHash("sha256").update(browserHistory).digest("hex");
  expect(browserHash).toBe(playPassive("cross-engine"));
});

test("play two weeks: buy and ship a cargo, see it in the book and P&L", async ({ page }) => {
  await page.goto("/?seed=e2e-1");
  await page.getByTestId("scenario-now_2026_11").click();
  await page.getByTestId("start").click();
  await expect(page.getByTestId("date")).toHaveText("2 Nov 2026");
  const buy = page.getByRole("button", { name: "Buy + ship" }).first();
  await expect(buy).toBeVisible();
  await buy.click();
  await expect(page.getByTestId("deal").first()).toBeVisible();
  await expect(page.getByTestId("voyage").first()).toBeVisible();
  await expect(page.getByTestId("ship").first()).toBeVisible();
  await page.getByTestId("next").click();
  await expect(page.getByTestId("date")).toHaveText("9 Nov 2026");
  await page.getByTestId("next").click();
  await expect(page.getByTestId("date")).toHaveText("16 Nov 2026");
  await expect(page.getByLabel("P&L attribution")).toContainText("Freight");
  await expect(page.getByText("exact")).toBeVisible();
  await page.getByRole("button", { name: "Assumptions" }).click();
  await expect(page.getByRole("dialog", { name: "Assumptions" })).toContainText("GARCH");
  await page.screenshot({ path: "test-results/after-two-weeks.png", fullPage: true });
});

test("the default generated market resumes after a reload", async ({ page }) => {
  await page.goto("/?seed=e2e-2");
  await page.getByTestId("start").click();
  await expect(page.getByTestId("date")).toContainText("Year 1");
  const first = await page.getByTestId("date").textContent();
  await page.getByTestId("next").click();
  await expect(page.getByTestId("date")).not.toHaveText(first!);
  const second = await page.getByTestId("date").textContent();
  await page.reload();
  await page.getByRole("button", { name: /Resume saved game/ }).click();
  await expect(page.getByTestId("date")).toHaveText(second!);
});

test("historical replay, storage and futures buttons", async ({ page }) => {
  await page.goto("/?seed=e2e-3");
  await page.getByTestId("scenario-covid_2020").click();
  await page.getByTestId("start").click();
  await expect(page.getByTestId("date")).toHaveText("2 Mar 2020");
  await page.getByTestId("tab-book").click();
  await page.getByRole("button", { name: /Lease tank/ }).click();
  await expect(page.getByText(/kbbl at ARA/).first()).toBeVisible();
  await page.getByTestId("fut-sell").click();
  await expect(page.getByText(/Short 100/)).toBeVisible();
  await page.getByTestId("hub-ARA").click();
  await expect(page.getByText("Showing ARA only")).toBeVisible();
  await page.screenshot({ path: "test-results/replay.png", fullPage: true });
});
