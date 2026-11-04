import { useState } from "react";
import { CHOKEPOINT_INFO, FUTURES, FUTURES_IDS, HUB_INFO, HUBS, PRODUCTS, REGIONS, REGION_NAME, ROUTES, hubPrice, isoDate, listedMonths, perBbl, rowPrice, type Game } from "@laycan/engine";
import { LineChart } from "./LineChart";
import { shortDate } from "../format";

/** green = long (surplus), red = short */
const tight = (x: number) => (x <= -3 ? "neg" : x >= 3 ? "pos" : "");
const g_kind = (game: Game) => (game.scenario.kind === "historical" ? " In replays, US stocks and runs are the real EIA weekly data." : "");

export function MarketPanel({ game }: { game: Game }) {
  const m = game.market;
  const [tab, setTab] = useState<"prices" | "fundamentals" | "freight" | "curves">("prices");
  const hist = game.state.history;
  const labels = hist.map((r) => shortDate(isoDate(r.day)));
  return (
    <section className="panel" aria-label="Market">
      <div className="tabs" role="tablist">
        {(["prices", "fundamentals", "freight", "curves"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={`tab ${tab === t ? "active" : ""}`} onClick={() => setTab(t)} data-testid={`market-${t}`}>
            {t === "prices" ? "Prices" : t === "fundamentals" ? "Stocks" : t === "freight" ? "Freight" : "Curves"}
          </button>
        ))}
      </div>
      {tab === "prices" && (
        <>
          <div className="table-wrap">
            <table aria-label="Hub prices">
              <thead>
                <tr>
                  <th>$/bbl</th>
                  {PRODUCTS.map((p) => (
                    <th key={p}>{p}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {HUBS.map((h) => (
                  <tr key={h}>
                    <td title={`${HUB_INFO[h].name}: ${HUB_INFO[h].role}`}>
                      <b>{h}</b>
                    </td>
                    {PRODUCTS.map((p) => (
                      <td key={p} className="num">
                        {hubPrice(m, h, p).toFixed(2)}
                        {h !== "USGC" && <div className="diff">{(m.diffs[h][p] >= 0 ? "+" : "") + m.diffs[h][p].toFixed(1)}</div>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ fontSize: 12, margin: "6px 0 10px" }}>
            Brent {m.brent.toFixed(2)} · cracks at US Gulf: {PRODUCTS.map((p) => `${p} ${m.cracks[p].toFixed(1)}`).join(" · ")}. Small numbers are the differential to the US Gulf price.
          </p>
          <h2>Cracks vs Brent ($/bbl)</h2>
          <LineChart
            labels={labels}
            series={[
              { name: "Diesel", color: "#155e75", values: hist.map((r) => r.cracks.diesel) },
              { name: "Jet", color: "#6d4bb5", values: hist.map((r) => r.cracks.jet) },
              { name: "Gasoline", color: "#c2410c", values: hist.map((r) => r.cracks.gasoline) },
            ]}
          />
          <h2 style={{ marginTop: 10 }}>Brent and the ARA − US Gulf diesel spread</h2>
          <LineChart
            labels={labels}
            series={[
              { name: "Brent $/bbl", color: "#15202b", values: hist.map((r) => r.brent) },
              { name: "ARA−USGC diesel ×5", color: "#137a4a", values: hist.map((r) => 5 * (rowPrice(r, "ARA", "diesel") - rowPrice(r, "USGC", "diesel"))) },
            ]}
          />
        </>
      )}
      {tab === "fundamentals" && (
        <>
          <p className="hint">
            Inventories and refinery runs against their 5-year seasonal normal. Low stocks lift cracks and a region's premium, steepen backwardation and pull in cargoes; outages cut refinery runs and drain stocks
            over weeks.{g_kind(game)}
          </p>
          <div className="table-wrap">
            <table aria-label="Regional fundamentals">
              <thead>
                <tr>
                  <th>vs normal</th>
                  <th>Runs, pp</th>
                  {PRODUCTS.map((p) => (
                    <th key={p}>{p} %</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {REGIONS.map((r) => (
                  <tr key={r}>
                    <td title={REGION_NAME[r]}>
                      <b>{r}</b>
                    </td>
                    <td className={`num ${tight(m.util[r] * 2)}`}>{(m.util[r] >= 0 ? "+" : "") + m.util[r].toFixed(1)}</td>
                    {PRODUCTS.map((p) => (
                      <td key={p} className={`num ${tight(m.stocks[r][p])}`}>
                        {(m.stocks[r][p] >= 0 ? "+" : "") + m.stocks[r][p].toFixed(1)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h2 style={{ marginTop: 10 }}>US stocks vs normal (%) and refinery runs (pp)</h2>
          <LineChart
            labels={labels}
            series={[
              { name: "Diesel", color: "#155e75", values: hist.map((r) => r.stocks?.US?.diesel ?? 0) },
              { name: "Gasoline", color: "#c2410c", values: hist.map((r) => r.stocks?.US?.gasoline ?? 0) },
              { name: "Runs", color: "#7b8794", values: hist.map((r) => r.util?.US ?? 0) },
            ]}
          />
          <h2 style={{ marginTop: 10 }}>Europe and Asia diesel stocks (%)</h2>
          <LineChart
            labels={labels}
            series={[
              { name: "Europe", color: "#6d4bb5", values: hist.map((r) => r.stocks?.EU?.diesel ?? 0) },
              { name: "Asia", color: "#137a4a", values: hist.map((r) => r.stocks?.ASIA?.diesel ?? 0) },
            ]}
          />
        </>
      )}
      {tab === "freight" && (
        <>
          <p className="hint">
            Built bottom-up: time-charter earnings × voyage days (with ballast return) + bunkers + port and canal costs, plus war-risk premiums. Chokepoints:{" "}
            {Object.entries(m.choke).map(([k, v]) => (
              <span key={k} className={`badge ${v}`} style={{ marginRight: 4 }}>
                {CHOKEPOINT_INFO[k as keyof typeof CHOKEPOINT_INFO].name}: {v}
              </span>
            ))}
          </p>
          <div className="table-wrap">
            <table aria-label="Freight">
              <thead>
                <tr>
                  <th>Route</th>
                  <th>Via</th>
                  <th>Ship</th>
                  <th>$/t</th>
                  <th>$/bbl dsl</th>
                  <th>Days</th>
                  <th>War risk</th>
                </tr>
              </thead>
              <tbody>
                {ROUTES.flatMap((r) =>
                  game.quotes(r.id).map((q) => (
                    <tr key={r.id + q.via} className={q.feasible ? "" : "blocked"} title={r.analogue}>
                      <td>
                        <b>{r.id}</b> <small>
                          {r.from}→{r.to}
                        </small>
                      </td>
                      <td>{q.via}</td>
                      <td>{q.cls}</td>
                      <td className="num">{q.allInPerTonne.toFixed(1)}</td>
                      <td className="num">{perBbl(q, "diesel").toFixed(2)}</td>
                      <td className="num">{q.ladenDays.toFixed(0)}</td>
                      <td className="num">{q.feasible ? `$${(q.warRiskUsd / 1e3).toFixed(0)}k` : "closed"}</td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
          <h2 style={{ marginTop: 10 }}>Time-charter earnings ($k/day)</h2>
          <LineChart
            labels={labels}
            series={[
              { name: "MR", color: "#155e75", values: hist.map((r) => r.tce.MR / 1e3) },
              { name: "LR1", color: "#6d4bb5", values: hist.map((r) => r.tce.LR1 / 1e3) },
              { name: "LR2", color: "#c2410c", values: hist.map((r) => r.tce.LR2 / 1e3) },
            ]}
          />
        </>
      )}
      {tab === "curves" && (
        <div className="table-wrap">
          <table aria-label="Futures curves">
            <thead>
              <tr>
                <th>Contract</th>
                {listedMonths("BRN", game.day).map((_, i) => (
                  <th key={i}>M{i + 1}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FUTURES_IDS.map((id) => {
                const spec = FUTURES[id];
                return (
                  <tr key={id}>
                    <td>
                      <b>{id}</b> <small>{spec.quoteUnit}</small>
                    </td>
                    {listedMonths(id, game.day).map((lm) => (
                      <td key={lm.code} className="num" title={`${lm.code}, expires ${isoDate(lm.expiry)}`}>
                        {(game.futuresQuote(id, lm.y, lm.m) * spec.quotePerBbl).toFixed(spec.quoteUnit === "$/gal" ? 4 : 2)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="muted" style={{ fontSize: 12 }}>
            Expected change over the next month: {Object.entries(m.structure).map(([k, v]) => `${k} ${v >= 0 ? "−" : "+"}${Math.abs(v).toFixed(2)}`).join(" · ")} $/bbl. The curves are
            the market's expectation of future spot (regime, stocks, season, fading physical basis), so backwardation means prices are expected to fall: rolling futures earns nothing on average.
          </p>
        </div>
      )}
    </section>
  );
}
