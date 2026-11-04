# Laycan

A physical refined-products trading simulator. You run a book of gasoline, diesel and jet cargoes moving between eight real hubs (US Gulf, New York Harbor, ARA, West Africa, Middle East Gulf, Fujairah, Singapore, Japan). You buy and sell cargoes, charter tankers, hedge with futures and live with what really decides P&L on a physical desk: freight, timing, pricing windows, quality, contract optionality, financing and things going wrong.

Every dollar of P&L is attributed to flat price, crack, regional arbitrage, time spread and carry, quality, freight, optionality, deal edge, events and finance. Attribution is the main output.

**Play:** https://lorenzoarbolino.github.io/laycan/ · **Manual:** [docs/MANUAL.md](docs/MANUAL.md) (also inside the game)

## Game modes

| Mode | What it is |
|---|---|
| **Generated market** (default) | A realistic world with no real date or prices. Regime, Brent, cracks, freight, inventories and chokepoints are drawn from the calibrated model and run forward through a three-month burn-in. Every seed is a different market. Play unlimited (the default) and stop when you like, or choose 8, 12, 26 or 52 weeks. |
| **Historical replay** | Real US benchmark prices (Brent, US Gulf cracks, NY Harbor spreads) and US stocks, day by day from EIA data. Other hubs, freight and curves are modelled around them, and the period's main events are scripted. Each episode runs for as long as the event matters: Financial crisis 2008 (24 weeks), Abqaiq 2019 (19), COVID 2020 (18), Texas freeze and Colonial 2021 (17), Ukraine 2022 (20), diesel squeeze and embargo 2022-23 (20), Red Sea 2023-24 (14), Iran war 2026 (26). |

Games are seeded and deterministic: the same seed and actions give identical results on every platform, and the market path does not depend on what the player does.

## What you can do

- **Trade cargoes:** buy FOB, CIF/DES delivered or in-tank (ITT); sell delivered, FOB or in-tank; ask the market for quotes.
- **Ship:** charter MR/LR1/LR2 tankers on thirteen routes (Suez or Cape variants) and see each arb at today's prices.
- **Divert:** re-route a laden ship to another hub when a better market opens. You pay the deviation, and the destination option shows up in the attribution.
- **Blend:** mix butane, naphtha, isomerate, reformate, FCC gasoline, alkylate and ethanol in your tank to make EN 228 or US regular gasoline. Specs cover octane, vapour pressure (seasonal), sulphur, aromatics, olefins, benzene and oxygen; a linear-program optimiser shows the cheapest on-spec recipe to beat.
- **Store:** lease tank capacity (take-or-pay, dearer in contango), hold inventory, sell spot, and compare contango against rent plus financing.
- **Negotiate:** counter any offer; each counterparty has a hidden reservation price and its own patience. Bid in national-oil-company tenders against sealed competing bids.
- **Choose counterparties:** twelve fictional firms (majors, national oil companies, refiners, traders, end users) with credit ratings, reliability and home markets. Relationships remember whether you lift, deliver and pay.
- **Hedge:** RBOB, NY Harbor ULSD, ICE Gasoil and Brent futures with daily variation margin.
- **Watch the world map:** hubs with live prices, sea routes coloured by whether the arb is open, chokepoint states, your ships along their routes, and tank inventories.

## Quick start

```bash
npm install
npm test                 # unit, property, stylized-fact, sanity and golden tests
npm run dev              # web app (http://localhost:5173)
npm run build            # static build in apps/web/dist, deployable to any static host
npm run e2e              # browser end-to-end tests (Playwright, Chromium)
                         # every push to main also deploys the web app to GitHub Pages
npm run play -- --seed 42 --weeks 26            # command-line game (generated market)
npm run play -- --scenario covid_2020 --seed 42  # a historical replay
npx tsx packages/cli/src/main.ts list            # all modes and episodes
npx tsx packages/cli/src/main.ts assumptions > assumptions.md   # assumptions sheet
```

## Layout

```
packages/engine/   pure TypeScript simulation engine (no runtime dependencies, no I/O)
  core/            seeded RNG, deterministic math, units, calendar
  world/           hubs, vessels, chokepoints, routes, price graph
  market/          regime, Brent, cracks, regional spreads, curves, freight
  book/            deals, cargoes, voyages, futures, valuation, attribution
  blending/        gasoline blending specs and a small simplex LP solver
  events/          macro events (hurricanes, outages, export bans, chokepoints, black swans)
  agents/          counterparties, deal flow, negotiation, tenders
  params/          model parameters, generated markets, historical episodes, assumptions sheet
  game.ts          game loop and actions
packages/cli/      terminal interface
apps/web/          browser interface (Vite + React)
calibration/       Python: fetch public data, fit parameters -> params/*.json
params/            fitted parameters with provenance, EIA replay series, sea-route geometry
```

## Market model

Prices are additive in $/bbl, which makes attribution exact:

```
hub price(h, p) = Brent + crack(p, US Gulf) + regional diff(h, p)
forward(h, p, T) = E_t[hub price(h, p) on day T]   (the model's own expectation)
futures(k)       = forward on the contract's expiry day
```

- **Brent:** GARCH(1,1) with Student-t shocks, a regime volatility multiplier, and jumps in stressed and war regimes. Log price reverts to a regime level with drift −σ²/4, so the level is the long-run average price.
- **Cracks:** two speeds, fitted to the autocorrelation of EIA cracks (2010-2019, 2023-2025): a physical basis with a half-life of 5-8 business days and a fundamental part that reverts to the regime mean over 3-10 months. Season, the US stock effect and event shifts are an additive overlay. Correlated multivariate-t shocks, common jumps.
- **Curves:** forward and futures prices are the conditional expectation of spot under the same model (regime chain, reversion, fading basis, stocks, season, event decay, parity). No risk premium is added, so rolling futures has zero expected P&L in every regime; cargoes, open deals and unpriced pricing days are marked on the curve for their own dates.
- **Regional diffs:** each hub is anchored to another through a shipping route. Importing hubs sit near anchor + freight and exporting hubs near anchor − freight. Once the arbitrage opens, mean reversion strengthens. If the route is blocked, the hub decouples: exporters face a glut, importers a shortage.
- **Fundamentals:** regional refinery runs and stocks (US, Europe, West Africa, Middle East, Asia) against their 5-year normals. Outages cut runs and drain stocks over weeks. Low stocks lift cracks (slopes fitted to EIA data), raise a region's premium, put the curve in backwardation (the stock effect is expected to fade as stocks refill) and pull in cargoes; arbitrage flows move barrels from suppliers to short regions, conserving volume. Counterparties offer from long regions and bid in short ones. In replays, US runs and stocks are the real weekly EIA data.
- **Freight:** built bottom-up from time-charter earnings, distance, speed, bunkers, port and canal costs, plus war-risk premiums. Reproduces published route rates for TC1, TC2, TC8, TC14 and TC19 within 7%.
- **Chokepoints:** Hormuz, Bab-el-Mandeb and Suez, each open, restricted or closed. Restricted means premiums, delays and incident risk. Closed means rerouting or stranded cargoes.

## Data and licensing

Calibration uses public-domain data: U.S. EIA daily spot prices (via FRED) and weekly stocks and refinery utilisation (via the EIA API), NOAA HURDAT2 hurricane tracks, and sea distances computed with searoute (Apache-2.0). Raw downloads stay local in `data/raw/` (gitignored). The repository holds only fitted parameters, the daily EIA series needed for the historical replays, and computed route geometry. Exchange and price-reporting-agency data are never redistributed. Every number is labelled `data`, `derived` or `estimate` with its source and method; the assumptions sheet lists them all. See [DATA_SOURCES.md](DATA_SOURCES.md) for attributions.

To refresh calibration, replay episodes and map geometry (requires `uv`, plus a free `EIA_API_KEY` for the weekly series):

```bash
cd calibration && uv run python fetch.py && uv run python fit.py && uv run python replay.py && uv run python geo.py
```

## Status

The engine, the web app and the CLI cover physical trading, shipping, diversions, storage, blending, hedging, regional fundamentals, counterparties and full P&L attribution, in generated markets and eight historical replays. Tests check accounting identities, determinism across JavaScript engines, stylized facts against history (including Brent's average level in each regime and crack autocorrelation from one day to three months), event propagation, and *no free lunch*: rolled futures earn nothing in any regime, random trading and naive shipping lose money, and only a disciplined arbitrage keeps an edge. Many parameters (counterparty behaviour, blending component prices, event magnitudes, freight positioning) are informed estimates awaiting review by practitioners. Comments and corrections are welcome.

## Disclaimer

Laycan is an educational simulation. Its prices are modelled, not forecasts or market data, and nothing in it is investment advice. Counterparties are fictional. Historical replays follow real US benchmark prices but model everything else; scripted headlines summarise public reporting and some dates are approximate.

## License

Code: [MIT](LICENSE). Data attributions: [DATA_SOURCES.md](DATA_SOURCES.md).
