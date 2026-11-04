import { Tips } from "./Tips";
import { ROSTER, defaultProbability, type Game } from "@laycan/engine";
import { signed } from "../format";

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
                  <td className="wrap">
                    <span className="strong">{c.name}</span>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {c.kind} · {c.hubs.join(", ")} · {c.sells && c.buys ? "buys and sells" : c.sells ? "sells" : "buys"}
                      {c.tenders ? " · tenders" : ""}
                    </div>
                  </td>
                  <td>{c.rating}</td>
                  <td>{(defaultProbability(c, game.market.regime) * 100).toFixed(1)}%</td>
                  <td>{Math.round(c.reliability * 100)}%</td>
                  <td>
                    <div className="track" style={{ width: 90, marginLeft: "auto" }} title={signed(r.score)}>
                      <div className="mid" />
                      <div className="b" style={{ top: 4, left: r.score >= 0 ? "50%" : `${50 + r.score * 50}%`, width: `${Math.abs(r.score) * 50}%`, background: r.score < 0 ? "var(--bad)" : "var(--ok)" }} />
                    </div>
                  </td>
                  <td>
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
