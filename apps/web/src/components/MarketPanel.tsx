import { useState } from "react";
import { CHOKEPOINT_INFO, FUTURES, FUTURES_IDS, HUB_INFO, HUBS, PRODUCTS, REGIONS, REGION_NAME, ROUTES, hubPrice, isoDate, listedMonths, perBbl, rowPrice, type Game } from "@laycan/engine";
import { LineChart } from "./LineChart";
import { shortDate, signed } from "../format";
import { Tips } from "./Tips";

/** ok = long (surplus), bad = short */
const tight = (x: number) => (x <= -3 ? "bad" : x >= 3 ? "ok" : "");
const chokeTone = (s: string) => (s === "open" ? "ok" : s === "restricted" ? "warn" : "bad");

/** Chart title that states the change over the window shown. */
function moved(values: number[], unit = "") {
  if (values.length < 2) return "";
  const d = values[values.length - 1]! - values[0]!;
  return `${signed(d, 1)}${unit} over ${Math.round(values.length / 21)} months`;
}

export function MarketPanel({ game }: { game: Game }) {
  const m = game.market;
  const [tab, setTab] = useState<"prices" | "fundamentals" | "freight" | "curves">("prices");
  const hist = game.state.history;
  const labels = hist.map((r) => shortDate(isoDate(r.day)));
  const diesel = hist.map((r) => r.cracks.diesel);
  const spread = hist.map((r) => rowPrice(r, "ARA", "diesel") - rowPrice(r, "USGC", "diesel"));
  return (
    <section className="panel" aria-label="Market">
      <div className="tabs" role="tablist">
        {(["prices", "fundamentals", "freight", "curves"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={`tab ${tab === t ? "active" : ""}`} onClick={() => setTab(t)} data-testid={`market-${t}`}>
            {t === "prices" ? "Prices" : t === "fundamentals" ? "Stocks" : t === "freight" ? "Freight" : "Curves"}
          </button>
        ))}
      </div>
      <div className="panel-body">
        {tab === "prices" && (
          <>
            <div className="form-row" style={{ gap: "4px 16px", marginBottom: 8, fontSize: 13 }}>
              <span className="kv">
                <span className="k">Brent</span>
                <span className="v">{m.brent.toFixed(2)}</span>
              </span>
              <span className="kv">
                <span className="k">US Gulf cracks</span>
                <span>
                  {PRODUCTS.map((p) => (
                    <span key={p} style={{ marginRight: 8 }}>
                      {p} <span className="strong">{m.cracks[p].toFixed(1)}</span>
                    </span>
                  ))}
                </span>
              </span>
            </div>
            <div className="table-wrap">
              <table aria-label="Hub prices" className="compact">
                <thead>
                  <tr>
                    <th>Hub · $/bbl</th>
                    {PRODUCTS.map((p) => (
                      <th key={p} colSpan={2}>
                        {p}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {HUBS.map((h) => (
                    <tr key={h} title={`${HUB_INFO[h].name}: ${HUB_INFO[h].role}`}>
                      <td>{h}</td>
                      {PRODUCTS.flatMap((p) => [
                        <td key={p} className="strong">
                          {hubPrice(m, h, p).toFixed(2)}
                        </td>,
                        <td key={p + "d"} className="diff">
                          {h === "USGC" ? "" : signed(m.diffs[h][p], 1)}
                        </td>,
                      ])}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              Grey: differential to the US Gulf.
            </p>
            <div className="chart-title">Diesel crack {m.cracks.diesel.toFixed(1)} $/bbl, {moved(diesel)}</div>
            <div className="chart-sub">US Gulf product minus Brent, $/bbl</div>
            <LineChart
              labels={labels}
              series={[
                { name: "Diesel", emphasis: true, values: diesel },
                { name: "Jet", values: hist.map((r) => r.cracks.jet) },
                { name: "Gasoline", values: hist.map((r) => r.cracks.gasoline) },
              ]}
            />
            <div className="chart-title">ARA over US Gulf diesel {spread.length ? spread[spread.length - 1]!.toFixed(2) : ""} $/bbl</div>
            <div className="chart-sub">the transatlantic arb against TC14 freight</div>
            <LineChart labels={labels} digits={1} series={[{ name: "ARA − USGC", emphasis: true, values: spread }]} height={90} />
            <div className="chart-title">Brent {m.brent.toFixed(2)} $/bbl, {moved(hist.map((r) => r.brent))}</div>
            <LineChart labels={labels} series={[{ name: "Brent", emphasis: true, values: hist.map((r) => r.brent) }]} height={90} />
          </>
        )}
        {tab === "fundamentals" && (
          <>
            <Tips
              id="stocks"
              tips={[
                <>Stocks and refinery runs against their 5-year normal. Short regions (red) bid for cargoes and pay a premium; long regions (green) offer them. Outages cut runs and drain stocks over weeks.</>,
                <>A region that stays short is where delivered sales pay best.{game.scenario.kind === "historical" ? " In replays, US stocks and runs are the real EIA weekly data." : ""}</>,
              ]}
            />
            <div className="table-wrap">
              <table aria-label="Regional fundamentals">
                <thead>
                  <tr>
                    <th>Region</th>
                    <th>Runs pp</th>
                    {PRODUCTS.map((p) => (
                      <th key={p}>{p} %</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {REGIONS.map((r) => (
                    <tr key={r} title={REGION_NAME[r]}>
                      <td>{REGION_NAME[r]}</td>
                      <td className={tight(m.util[r] * 2)}>{signed(m.util[r], 1)}</td>
                      {PRODUCTS.map((p) => (
                        <td key={p} className={tight(m.stocks[r][p])}>
                          {signed(m.stocks[r][p], 1)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="chart-title">US diesel stocks {signed(m.stocks.US.diesel, 1)}% vs normal</div>
            <div className="chart-sub">% vs 5-year normal; refinery runs in percentage points</div>
            <LineChart
              labels={labels}
              series={[
                { name: "Diesel", emphasis: true, values: hist.map((r) => r.stocks?.US?.diesel ?? 0) },
                { name: "Gasoline", values: hist.map((r) => r.stocks?.US?.gasoline ?? 0) },
                { name: "Runs", values: hist.map((r) => r.util?.US ?? 0) },
              ]}
            />
            <div className="chart-title">Diesel stocks: Europe {signed(m.stocks.EU.diesel, 1)}%, Asia {signed(m.stocks.ASIA.diesel, 1)}%</div>
            <LineChart
              labels={labels}
              series={[
                { name: "Europe", emphasis: true, values: hist.map((r) => r.stocks?.EU?.diesel ?? 0) },
                { name: "Asia", values: hist.map((r) => r.stocks?.ASIA?.diesel ?? 0) },
              ]}
            />
          </>
        )}
        {tab === "freight" && (
          <>
            <div className="form-row" style={{ gap: "4px 16px", marginBottom: 8, fontSize: 13 }}>
              {Object.entries(m.choke).map(([k, v]) => (
                <span key={k} className={`st ${chokeTone(v)}`}>
                  {CHOKEPOINT_INFO[k as keyof typeof CHOKEPOINT_INFO].name} {v}
                </span>
              ))}
            </div>
            <div className="table-wrap">
              <table aria-label="Freight">
                <thead>
                  <tr>
                    <th>Route</th>
                    <th className="l">Via</th>
                    <th className="l">Ship</th>
                    <th>$/t</th>
                    <th>$/bbl diesel</th>
                    <th>Days</th>
                    <th>War risk</th>
                  </tr>
                </thead>
                <tbody>
                  {ROUTES.flatMap((r) =>
                    game.quotes(r.id).map((q) => (
                      <tr key={r.id + q.via} className={q.feasible ? "" : "blocked"} title={r.analogue}>
                        <td>
                          <span className="code">{r.id}</span> <span className="dim">{r.from}→{r.to}</span>
                        </td>
                        <td className="l">{q.via}</td>
                        <td className="l">{q.cls}</td>
                        <td>{q.allInPerTonne.toFixed(1)}</td>
                        <td>{perBbl(q, "diesel").toFixed(2)}</td>
                        <td>{q.ladenDays.toFixed(0)}</td>
                        <td>{q.feasible ? (q.warRiskUsd > 0 ? `$${(q.warRiskUsd / 1e3).toFixed(0)}k` : "—") : "closed"}</td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </div>
            <div className="chart-title">MR earnings ${(m.tce.MR / 1e3).toFixed(1)}k/day</div>
            <div className="chart-sub">time-charter equivalent, $k/day</div>
            <LineChart
              labels={labels}
              series={[
                { name: "MR", emphasis: true, values: hist.map((r) => r.tce.MR / 1e3) },
                { name: "LR1", values: hist.map((r) => r.tce.LR1 / 1e3) },
                { name: "LR2", values: hist.map((r) => r.tce.LR2 / 1e3) },
              ]}
            />
          </>
        )}
        {tab === "curves" && (
          <>
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
                      <tr key={id} title={spec.name}>
                        <td>
                          <span className="code">{id}</span> <span className="dim">{spec.quoteUnit}</span>
                        </td>
                        {listedMonths(id, game.day).map((lm) => (
                          <td key={lm.code} title={`${lm.code}, expires ${isoDate(lm.expiry)}`}>
                            {(game.futuresQuote(id, lm.y, lm.m) * spec.quotePerBbl).toFixed(spec.quoteUnit === "$/gal" ? 4 : 2)}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="section-title" style={{ marginTop: 14 }}>
              <h3>Expected change over the next month</h3>
              <span className="note">$/bbl</span>
            </div>
            <table aria-label="Front spreads">
              <tbody>
                {Object.entries(m.structure).map(([k, v]) => (
                  <tr key={k}>
                    <td>{k}</td>
                    <td className={-v >= 0 ? "ok" : "bad"}>{signed(-v)}</td>
                    <td className="l dim">{v > 0.05 ? "backwardation" : v < -0.05 ? "contango" : "flat"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
              Curves are the expected spot price, so rolling futures earns nothing on average.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
