# Laycan

A physical refined-products trading simulator. You run a book of gasoline, diesel and jet cargoes moving between real hubs (US Gulf, New York Harbor, ARA, West Africa, Middle East Gulf, Fujairah, Singapore). You buy and sell cargoes, charter tankers, hedge with futures and live with what really decides P&L on a physical desk: freight, timing, pricing windows, quality, contract optionality, financing and things going wrong.

Every dollar of P&L is attributed to flat price, crack, regional arbitrage, time spread and carry, quality, freight, optionality, deal edge, events and finance. Attribution is the main output.

## Scenarios

| Scenario | Start | What it feels like |
|---|---|---|
| `now_2026_11` | 2 Nov 2026 | War regime, initialised from public data to 27 Oct 2026. Hormuz restricted, Red Sea hazardous, Brent spot above $120, diesel cracks near records while gasoline collapses, East-of-Suez freight at extreme levels. |
| `normal_2025` | 3 Nov 2025 | Calmer baseline: Brent in the $60s, moderate cracks, ordinary freight. |

Games are seeded and deterministic: the same seed and the same actions give identical results on every platform. The market path does not depend on what the player does.

## Quick start

```bash
npm install
npm test                 # unit, property, stylized-fact, sanity and golden tests
npm run dev              # web app (http://localhost:5173)
npm run build            # static build in apps/web/dist, deployable to any static host
npm run e2e              # browser end-to-end tests (Playwright, Chromium)
npm run play -- --scenario now_2026_11 --seed 42      # command-line game
npx tsx packages/cli/src/main.ts assumptions > assumptions.md   # assumptions sheet
```

## Layout

```
packages/engine/   pure TypeScript simulation engine (no runtime dependencies, no I/O)
  core/            seeded RNG, deterministic math, units, calendar
  world/           hubs, vessels, chokepoints, routes, price graph
  market/          regime, Brent, cracks, regional spreads, curves, freight
  book/            deals, cargoes, voyages, futures, valuation, attribution
  events/          macro events (hurricanes, outages, export bans, chokepoints, black swans)
  agents/          counterparties and deal flow
  game.ts          game loop and actions
packages/cli/      terminal interface
apps/web/          browser interface (Vite + React)
calibration/       Python: fetch public data, fit parameters -> params/*.json
params/            fitted parameters with provenance (no raw data)
```

## Market model

Prices are additive in $/bbl, which makes attribution exact:

```
hub price(h, p) = Brent + crack(p, US Gulf) + regional diff(h, p)
futures(k)      = hub price − curve spread(p) · g(months to expiry)
```

- **Brent:** GARCH(1,1) with Student-t shocks, a regime volatility multiplier, and jumps in stressed and war regimes.
- **Cracks:** seasonal Ornstein–Uhlenbeck processes with regime-dependent means, correlated multivariate-t shocks, and common jumps.
- **Regional diffs:** each hub is anchored to another through a shipping route. Importing hubs sit near anchor + freight and exporting hubs near anchor − freight. Once the arbitrage opens, mean reversion strengthens. If the route is blocked, the hub decouples: exporters face a glut, importers a shortage.
- **Freight:** built bottom-up from time-charter earnings, distance, speed, bunkers, port and canal costs, plus war-risk premiums. Reproduces published route rates for TC2, TC8, TC14 and TC19 within 10%.
- **Chokepoints:** Hormuz, Bab-el-Mandeb and Suez, each open, restricted or closed. Restricted means premiums, delays and incident risk. Closed means rerouting or stranded cargoes.

## Data and licensing

Calibration uses public-domain U.S. EIA data (daily spot prices via FRED, weekly stocks via the EIA API), NOAA HURDAT2 and searoute (Apache-2.0) sea distances. Raw downloads stay local in `data/raw/` (gitignored). Only fitted parameters are committed, each carrying its source, method and date. Exchange and price-reporting-agency data are not redistributed. Every number is labelled `data`, `derived` or `estimate`, and the assumptions sheet lists them all.

To refresh calibration (requires `uv`, plus a free `EIA_API_KEY` for the weekly series):

```bash
cd calibration && uv run python fetch.py && uv run python fit.py
```
