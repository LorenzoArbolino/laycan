import { Tips } from "./Tips";
import { ROSTER, defaultProbability, type Game } from "@laycan/engine";

export function CounterpartiesPanel({ game }: { game: Game }) {
  return (
    <div>
      <Tips
        id="cpty"
        tips={[
          <>
            Who you trade with. Ratings drive default risk on open-account sales (higher in stressed markets); reliability drives late and off-spec deliveries. Relationships improve when deals settle and suffer when you
            fail to lift or deliver: good relationships bring more offers and better prices, bad ones close the door.
          </>,
          <>A sale on open account carries the buyer's default risk; a sale paid by letter of credit does not. Weaker names often bid a better premium: that is the price of the risk you take.</>,
        ]}
      />
      <div className="table-wrap">
        <table aria-label="Counterparties">
          <thead>
            <tr>
              <th>Counterparty</th>
              <th>Rating</th>
              <th>Default</th>
              <th>Reliability</th>
              <th>Relationship</th>
              <th>Deals / fails</th>
            </tr>
          </thead>
          <tbody>
            {ROSTER.map((c) => {
              const r = game.state.relations[c.id] ?? { score: 0, deals: 0, fails: 0 };
              return (
                <tr key={c.id} title={c.blurb}>
                  <td style={{ whiteSpace: "normal" }}>
                    <b>{c.name}</b>
                    <div className="muted" style={{ fontSize: 11 }}>
                      {c.kind} · {c.hubs.join(", ")} · {c.sells && c.buys ? "buys and sells" : c.sells ? "sells" : "buys"}
                      {c.tenders ? " · tenders" : ""}
                    </div>
                  </td>
                  <td>
                    <span className={`badge ${c.rating === "A" ? "data" : c.rating === "BBB" ? "derived" : "estimate"}`}>{c.rating}</span>
                  </td>
                  <td className="num">{(defaultProbability(c, game.market.regime) * 100).toFixed(1)}%</td>
                  <td className="num">{Math.round(c.reliability * 100)}%</td>
                  <td>
                    <div className="bar-track" style={{ width: 90 }}>
                      <div className="bar-mid" />
                      <div className={`bar ${r.score >= 0 ? "phys" : "paper"}`} style={{ left: r.score >= 0 ? "50%" : `${50 + r.score * 50}%`, width: `${Math.abs(r.score) * 50}%`, background: r.score < 0 ? "var(--neg)" : undefined }} />
                    </div>
                  </td>
                  <td className="num">
                    {r.deals} / {r.fails}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
