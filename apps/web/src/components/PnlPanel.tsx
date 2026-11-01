import { BUCKET_INFO, isoDate, type Game } from "@laycan/engine";
import { LineChart } from "./LineChart";
import { cls, money, shortDate } from "../format";

export function PnlPanel({ game }: { game: Game }) {
  const rows = game.attributionTotals();
  const maxAbs = Math.max(1, ...rows.map((r) => Math.max(Math.abs(r.physical), Math.abs(r.paper), Math.abs(r.total))));
  const days = game.state.days;
  const start = game.scenario.finance.equity.value;
  const s = game.score();
  return (
    <section className="panel" aria-label="P&L attribution">
      <div className="panel-head">
        <h2>P&amp;L attribution</h2>
        <span className={`num ${cls(s.pnl)}`} data-testid="pnl">
          {money(s.pnl)}
        </span>
      </div>
      <div className="bars">
        {rows.map((r) => {
          const w = (x: number) => `${(Math.abs(x) / maxAbs) * 50}%`;
          const left = (x: number) => (x >= 0 ? "50%" : `${50 - (Math.abs(x) / maxAbs) * 50}%`);
          return (
            <div className="bar-row" key={r.bucket} title={BUCKET_INFO[r.bucket].explain}>
              <span>{BUCKET_INFO[r.bucket].label}</span>
              <div className="bar-track">
                <div className="bar-mid" />
                <div className="bar phys" style={{ left: left(r.physical), width: w(r.physical), top: 1, height: 6 }} />
                <div className="bar paper" style={{ left: left(r.paper), width: w(r.paper), top: 7, height: 6 }} />
              </div>
              <span className={`num ${cls(r.total)}`} style={{ textAlign: "right" }}>
                {money(r.total)}
              </span>
            </div>
          );
        })}
      </div>
      <div className="legend">
        <span>
          <span className="dot" style={{ background: "var(--phys)" }} />
          physical
        </span>
        <span>
          <span className="dot" style={{ background: "var(--paper)" }} />
          paper (futures)
        </span>
        <span className="muted">hover a row for its meaning</span>
      </div>
      <h2 style={{ marginTop: 12 }}>Equity ($m)</h2>
      <LineChart labels={[shortDate(isoDate(game.state.startDay)), ...days.map((d) => shortDate(isoDate(d.day)))]} series={[{ name: "Equity", color: "#155e75", values: [start / 1e6, ...days.map((d) => d.equity / 1e6)] }]} height={100} />
      <table style={{ marginTop: 6 }}>
        <tbody>
          <tr>
            <td>Return on starting equity</td>
            <td className={`num ${cls(s.returnPct)}`}>{s.returnPct.toFixed(1)}%</td>
          </tr>
          <tr>
            <td>Max drawdown</td>
            <td className="num">{money(s.maxDrawdown)}</td>
          </tr>
          <tr>
            <td>1-day VaR 99% (limit {money(game.scenario.finance.varLimit.value, 0)})</td>
            <td className={`num ${game.var99() > game.scenario.finance.varLimit.value ? "neg" : ""}`}>{money(game.var99())}</td>
          </tr>
          <tr>
            <td>Days over VaR limit / credit breaches</td>
            <td className="num">
              {s.varBreachDays} / {s.liquidityBreachDays}
            </td>
          </tr>
          <tr>
            <td>Accounting check (max daily residual)</td>
            <td className="num">{game.state.maxResidual < 1e-4 ? "exact" : money(game.state.maxResidual)}</td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}
