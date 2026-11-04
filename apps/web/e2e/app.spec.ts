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
  await page.getByTestId("scenario-redsea_2023").click();
  await page.getByTestId("start").click();
  await expect(page.getByTestId("date")).toHaveText("4 Dec 2023");
  const buy = page.getByRole("button", { name: "Buy + ship" }).first();
  await expect(buy).toBeVisible();
  await buy.click();
  await expect(page.getByTestId("deal").first()).toBeVisible();
  await expect(page.getByTestId("voyage").first()).toBeVisible();
  await expect(page.getByTestId("ship").first()).toBeVisible();
  await page.getByTestId("next").click();
  await expect(page.getByTestId("date")).toHaveText("11 Dec 2023");
  await page.getByTestId("next").click();
  await expect(page.getByTestId("date")).toHaveText("18 Dec 2023");
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
  await page.getByTestId("tab-storage").click();
  await page.getByRole("button", { name: /Lease tank/ }).click();
  await expect(page.getByText(/kbbl at ARA/).first()).toBeVisible();
  await page.getByTestId("tab-hedge").click();
  await page.getByTestId("fut-sell").click();
  await expect(page.getByText(/Short 100/)).toBeVisible();
  await page.getByTestId("hub-ARA").click();
  await expect(page.getByText("Showing ARA only")).toBeVisible();
  await page.screenshot({ path: "test-results/replay.png", fullPage: true });
});

test("blending and diversion from the book", async ({ page }) => {
  await page.goto("/?seed=e2e-4");
  await page.getByTestId("scenario-covid_2020").click();
  await page.getByTestId("start").click();
  await page.getByRole("button", { name: "Buy + ship" }).first().click();
  await page.getByTestId("tab-storage").click();
  await page.getByRole("button", { name: /Lease tank/ }).click();
  await page.getByTestId("tab-blend").click();
  await page.getByTestId("blend").click();
  await expect(page.getByText(/Blended 200 kbbl/)).toBeVisible();
  for (let i = 0; i < 4; i++) await page.getByTestId("next").click();
  await page.getByTestId("tab-book").click();
  const divert = page.getByRole("button", { name: "Divert…" }).first();
  await expect(divert).toBeVisible();
  await divert.click();
  await page.getByRole("button", { name: "Divert", exact: true }).first().click();
  await expect(page.getByText(/diverted to/).first()).toBeVisible();
  await page.screenshot({ path: "test-results/ops.png", fullPage: true });
});

test("negotiation, counterparties and fundamentals views", async ({ page }) => {
  await page.goto("/?seed=e2e-5");
  await page.getByTestId("start").click();
  const counter = page.locator('[data-testid^="counter-"]').first();
  await counter.click();
  await expect(page.locator(".toast")).toContainText(/agrees|comes back|walks away/);
  await page.getByTestId("tab-cpty").click();
  await expect(page.getByRole("table", { name: "Counterparties" })).toContainText("Meridian Energy");
  await page.getByTestId("market-fundamentals").click();
  await expect(page.getByRole("table", { name: "Regional fundamentals" })).toContainText("Northwest Europe");
});

test("the manual opens in the app and its contents links work; Japan is on the map", async ({ page }) => {
  await page.goto("/?seed=e2e-6");
  await page.getByTestId("start-manual").click();
  const manual = page.getByRole("dialog", { name: "Manual" });
  await expect(manual).toContainText("Laycan — game manual");
  await manual.getByRole("link", { name: "Blending" }).first().click();
  await expect(manual.locator('[id="12-blending"]')).toBeInViewport();
  await manual.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByTestId("start").click();
  await expect(page.getByTestId("hub-JPN")).toBeVisible();
});

test("tips close one at a time; the book says what each voyage carries", async ({ page }) => {
  await page.goto("/?seed=e2e-tips");
  await page.getByTestId("scenario-redsea_2023").click();
  await page.getByTestId("start").click();
  const tip = page.getByTestId("tip-offers");
  await expect(tip).toContainText("Tip 1/");
  await tip.getByRole("button", { name: "Next tip" }).click();
  await expect(tip).toContainText("Tip 2/");
  await expect(tip).toContainText("Where title passes");
  await page.getByRole("button", { name: "Buy + ship" }).first().click();
  await expect(page.getByTestId("voyage-cargo").first()).toContainText(/To load \d+ kbbl \w+ at/);
  await expect(page.getByTestId("deal").first()).toContainText(/to receive|to deliver/);
  await page.screenshot({ path: "test-results/book.png", fullPage: true });
});

test("an unlimited game (the default) has no end date and ends on request", async ({ page }) => {
  await page.goto("/?seed=e2e-open");
  await page.getByTestId("scenario-generated").click();
  await expect(page.getByLabel("Duration")).toHaveValue("0"); // unlimited is the default
  await page.getByRole("button", { name: "Start unlimited game" }).click();
  await expect(page.getByTestId("week")).toHaveText("1");
  for (let i = 0; i < 3; i++) await page.getByTestId("next").click();
  await expect(page.getByTestId("week")).toHaveText("4");
  page.once("dialog", (d) => d.accept());
  await page.getByTestId("end-game").click();
  await expect(page.getByRole("heading", { name: "Game over" })).toBeVisible();
  await expect(page.getByTestId("next")).toBeDisabled();
});
