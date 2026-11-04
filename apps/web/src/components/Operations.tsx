import { Tips } from "./Tips";
import { useState } from "react";
import { BLEND_HUBS, COMPONENT_DATA, COMPONENTS, type Action, type ComponentId, type Game, type HubId, type Recipe, type Voyage } from "@laycan/engine";
import { money, signed } from "../format";

export function DivertControl({ game, v, act }: { game: Game; v: Voyage; act: (a: Action) => void }) {
  const [open, setOpen] = useState(false);
  const opts = game.diversionOptions(v.id);
  if (!opts.length) return null;
  return (
    <div style={{ marginTop: 4 }}>
      <button className="btn small" onClick={() => setOpen(!open)} data-testid={`divert-${v.id}`}>
        {open ? "Hide diversion options" : "Divert…"}
      </button>
      {open && (
        <table style={{ marginTop: 4 }} aria-label={`Diversion options for ${v.id}`}>
          <thead>
            <tr>
              <th>To</th>
              <th>Price vs {v.to}</th>
              <th>Extra days</th>
              <th>Cost</th>
              <th>Net $/bbl</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {opts.map((o) => (
              <tr key={o.to}>
                <td>
                  <b>{o.to}</b>
                </td>
                <td className={`num ${o.priceGainPerBbl >= 0 ? "pos" : "neg"}`}>{signed(o.priceGainPerBbl)}</td>
                <td className="num">{signed(o.extraDays, 1)}</td>
                <td className="num">{money(o.costUsd)}</td>
                <td className={`num ${o.netPerBbl >= 0 ? "pos" : "neg"}`}>{signed(o.netPerBbl)}</td>
                <td>
                  <button className="btn small primary" disabled={!o.feasible} title={o.feasible ? (o.breaksSale ? `Breaks the link to sale ${o.breaksSale}` : "") : `Blocked: ${o.blockedBy.join(", ")}`} onClick={() => act({ type: "divert", voyageId: v.id, to: o.to })}>
                    {o.feasible ? "Divert" : "Blocked"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {open && v.saleId && <small className="neg">Diverting breaks the link to sale {v.saleId}: you will need another cargo for it.</small>}
    </div>
  );
}

export function BlendPanel({ game, act }: { game: Game; act: (a: Action) => void }) {
  const [hub, setHub] = useState<HubId>("ARA");
  const [kbbl, setKbbl] = useState(200);
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const q = game.blendQuote(hub, recipe ?? undefined);
  const data = COMPONENT_DATA.value;
  const pct = (c: ComponentId) => Math.round(((q.recipe as Recipe)[c] ?? 0) * 1000) / 10;
  const setPct = (c: ComponentId, v: number) => {
    const base: Recipe = { ...(q.recipe as Recipe) };
    base[c] = Math.max(0, v) / 100;
    setRecipe(base);
  };
  const total = COMPONENTS.reduce((s, c) => s + ((q.recipe as Recipe)[c] ?? 0), 0);
  const optimalCost = q.optimal ? game.blendQuote(hub).cost : null;
  return (
    <>
      <Tips
        id="blend"
        tips={[
          <>
            Mix refinery components in your leased tank to make finished gasoline. Octane, vapour pressure, sulphur, aromatics, olefins, benzene and oxygen must all meet the grade. Cheap components (butane, naphtha) are
            volatile or low in octane; octane carriers are expensive. Press <b>Optimise</b> to see what the linear program would do, then try to beat it.
          </>,
          <>Winter grades allow more vapour pressure, so cheap butane fits in: the blending margin is usually best from October to March.</>,
        ]}
      />
      <div className="form-row">
        <label className="field">
          Hub
          <select
            value={hub}
            onChange={(e) => {
              setHub(e.target.value as HubId);
              setRecipe(null);
            }}
          >
            {BLEND_HUBS.map((h) => (
              <option key={h}>{h}</option>
            ))}
          </select>
        </label>
        <label className="field">
          Volume, kbbl
          <input type="number" min={50} step={50} value={kbbl} onChange={(e) => setKbbl(Number(e.target.value))} style={{ width: 80 }} />
        </label>
        <button className="btn" onClick={() => setRecipe(null)} data-testid="blend-optimise">
          Optimise
        </button>
        <button className="btn primary" onClick={() => act({ type: "blend", hub, volumeBbl: kbbl * 1000, recipe: recipe ?? undefined })} data-testid="blend">
          Blend
        </button>
      </div>
      <small>
        Grade: <b>{q.grade.name}</b> · free tank at {hub}: {(q.freeTank / 1000).toFixed(0)} kbbl
      </small>
      <div className="table-wrap">
        <table aria-label="Blend recipe">
          <thead>
            <tr>
              <th>Component</th>
              <th>$/bbl</th>
              <th>RON</th>
              <th>RVP kPa</th>
              <th>Share %</th>
            </tr>
          </thead>
          <tbody>
            {COMPONENTS.map((c) => (
              <tr key={c} title={data[c].note}>
                <td>{data[c].name}</td>
                <td className="num">{q.prices[c].toFixed(2)}</td>
                <td className="num">{data[c].ron}</td>
                <td className="num">{data[c].rvp}</td>
                <td>
                  <input type="number" min={0} max={100} step={0.5} value={pct(c)} onChange={(e) => setPct(c, Number(e.target.value))} style={{ width: 70 }} aria-label={`${data[c].name} share`} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {Math.abs(total - 1) > 0.001 && <small>Shares are normalised to 100% (now {(total * 100).toFixed(1)}%).</small>}
      <div className="table-wrap">
        <table aria-label="Specification check">
          <tbody>
            {q.checks.map((c) => (
              <tr key={c.label + c.limit}>
                <td>{c.label}</td>
                <td className="num">{c.value.toFixed(c.value < 10 ? 2 : 1)}</td>
                <td className="num">{c.limit}</td>
                <td className={c.ok ? "pos" : "neg"}>{c.ok ? "✓" : "✗"}</td>
              </tr>
            ))}
            <tr>
              <td>
                <b>Blend cost (incl. fee)</b>
              </td>
              <td className="num">{q.cost.toFixed(2)}</td>
              <td className="num">vs finished {q.finished.toFixed(2)}</td>
              <td className={`num ${q.margin >= 0 ? "pos" : "neg"}`}>{signed(q.margin)}</td>
            </tr>
            {optimalCost !== null && recipe && (
              <tr>
                <td>Optimiser's cost</td>
                <td className="num">{optimalCost.toFixed(2)}</td>
                <td colSpan={2} className="muted">
                  {q.checks.every((c) => c.ok) && q.cost <= optimalCost + 0.005 ? "you matched the optimiser" : "the optimiser does better"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {q.discount > 0 && <small className="neg">Off-spec: the batch would be worth {q.discount.toFixed(2)} $/bbl less.</small>}
    </>
  );
}
