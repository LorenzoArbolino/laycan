# Data sources and attributions

The code is MIT-licensed (see `LICENSE`). The data shipped in `params/` comes from the sources
below. Raw downloads are never committed; `npm run check:data` enforces this.

| What | Source | Terms | Where it is used |
|---|---|---|---|
| Daily spot prices: Brent, WTI, US Gulf and New York Harbor gasoline, ULSD, jet, heating oil | U.S. Energy Information Administration, via FRED (Federal Reserve Bank of St. Louis): series DCOILBRENTEU, DCOILWTICO, DGASUSGULF, DGASNYH, DDFUELUSGULF, DDFUELNYH, DJFUELUSGULF, DHOILNYH | Public domain, citation requested (EIA: "U.S. government publications are in the public domain"; FRED marks these series "Public Domain: Citation Requested") | Fitted parameters in `params/calibration.json`; daily replay series in `params/replay.json` |
| Weekly US stocks and refinery utilisation | EIA Weekly Petroleum Status Report via the EIA Open Data API: WDISTUS1, WGTSTUS1, WKJSTUS1, WPULEUS3 | Public domain, citation requested | Fundamentals calibration; replay series |
| Atlantic hurricane tracks | NOAA National Hurricane Center, HURDAT2 | Public domain (U.S. government) | Hurricane frequency by month (derived rates only) |
| Sea routes and distances | `searoute` (Apache-2.0) on the Eurostat MARNET maritime network | Apache-2.0 for the software; outputs are computed distances and simplified paths | `params/geo.json`, freight distances |
| Land outlines for the map | Natural Earth 1:110m, via the `world-atlas` package (ISC) | Natural Earth is public domain | Web app map |
| Clean-tanker route rates (four data points, 19-20 Oct 2026) | Optima Shipbroking public market summary | Cited facts | Starting freight levels in one regime preset; freight model validation |
| Futures curve shape (one derived number) | ICE Gasoil futures observations, late Oct 2026 | Exchange data used for calibration only; no exchange data is redistributed | Backwardation level in the war-regime preset |

Every parameter in the engine carries its source, method and date, and is labelled `data`,
`derived` or `estimate`. The assumptions sheet lists them all:

```bash
npx tsx packages/cli/src/main.ts assumptions > assumptions.md
```

Historical replay headlines summarise public reporting of the period. Dates marked "approx."
are approximate. Counterparties in the game are fictional.
