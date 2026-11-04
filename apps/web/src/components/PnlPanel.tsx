import { BUCKET_INFO, isoDate, type Game } from "@laycan/engine";
import { LineChart } from "./LineChart";
import { cls, money, shortDate } from "../format";

export function PnlPanel({ game }: { game: Game }) {
  const rows = game.attributionTotals();
  const maxAbs = Math.max(1, ...rows.map((r) => Math.max(Math.abs(r.physical), Math.abs(r.paper), Math.abs(r.total))));
  const days = game.state.days;
  const start = game.scenario.finance.equity.value;
  const s = game.score();
  const varNow = game.var99();
  const limit = game.scenario.finance.varLimit.value;
  const w = (x: number) => `${(Math.abs(x) / maxAbs) * 50}%`;
  const left = (x: number) => (x >= 0 ? "50%" : `${50 - (Math.abs(x) / maxAbs) * 50}%`);
  return (
    <section className="panel" aria-label="P&L attribution">
      <div className="panel-head">
        <h2>P&amp;L</h2>
        <span className={`strong ${cls(s.pnl)}`} style={{ fontSize: 20 }} data-testid="pnl">
          {money(s.pnl)}
        </span>
      </div>
      <div className="panel-body">
        <div className="attrib">
          {rows.map((r) => (
            <div className="attrib-row" key={r.bucket} title={BUCKET_INFO[r.bucket].explain}>
              <span className="name">{BUCKET_INFO[r.bucket].label}</span>
              <div className="track">
                <div className="mid" />
                <div className="b phys" style={{ left: left(r.physical), width: w(r.physical) }} />
                <div className="b paper" style={{ left: left(r.paper), width: w(r.paper) }} />
              </div>
              <span className={`strong ${cls(r.total)}`} style={{ textAlign: "right" }}>
                {money(r.total)}
              </span>
            </div>
          ))}
        </div>
        <div className="legend">
          <span>
            <span className="sw" style={{ background: "var(--accent)" }} />
            physical
          </span>
          <span>
            <span className="sw" style={{ background: "var(--paper)" }} />
            futures
          </span>
          <span>hover a row for its meaning</span>
        </div>
        <div className="chart-title">Equity {money(game.equity())}</div>
        <LineChart labels={[shortDate(isoDate(game.state.startDay)), ...days.map((d) => shortDate(isoDate(d.day)))]} series={[{ name: "Equity", emphasis: true, values: [start / 1e6, ...days.map((d) => d.equity / 1e6)] }]} height={90} digits={1} />
        <table style={{ marginTop: 8 }} aria-label="Risk">
          <tbody>
            <tr>
              <td>Return on starting equity</td>
              <td className={`strong ${cls(s.returnPct)}`}>{s.returnPct.toFixed(1)}%</td>
            </tr>
            <tr>
              <td>Max drawdown</td>
              <td>{money(s.maxDrawdown)}</td>
            </tr>
            <tr>
              <td>VaR 99%, 1 day</td>
              <td className={varNow > limit ? "bad strong" : ""}>
                {money(varNow)} <span className="dim">/ {money(limit, 0)}</span>
              </td>
            </tr>
            <tr>
              <td>Days over VaR / credit breaches</td>
              <td>
                {s.varBreachDays} / {s.liquidityBreachDays}
              </td>
            </tr>
            <tr title="Largest daily difference between equity change and the sum of the attribution buckets">
              <td>Accounting check</td>
              <td className={game.state.maxResidual < 1e-4 ? "ok" : "bad"}>{game.state.maxResidual < 1e-4 ? "exact" : money(game.state.maxResidual)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
